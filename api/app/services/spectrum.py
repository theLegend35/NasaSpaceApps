"""GET /spectrum: brightness of one source across SPHEREx wavelengths (design doc Feature 4).

Honest scope for v1 (say so in the UI):
- Quick APERTURE photometry on native pixels, not the ePSF fit yet. No aperture
  correction, so fluxes are low by a constant factor. Not science grade; IRSA's
  SPHEREx Spectrophotometry Tool is the reference (docs/validation.md).
- MJy/sr -> uJy uses the WCS pixel solid angle, not the SAPM calibration file yet.
- Points are per exposure. Binning to the 102 channels needs IRSA's published
  channel table in data/spherex_channels.csv; until that file exists we return
  unbinned points and say so. We never invent channel edges.
"""
from __future__ import annotations

import csv
import logging
import math
import warnings
from pathlib import Path

import numpy as np
from astropy.wcs.utils import proj_plane_pixel_area

from ..core import cache as kv
from ..core.errors import ApiError
from ..core.settings import get_settings
from . import detect, flags as fl, horizons, irsa_tap, rules, spherex_files
from .coords import mjd_to_jyear, propagate_linear
from .field import mjd_iso

SNR_LIMIT = 3.0          # PROPOSAL: S/N under 3 becomes an upper limit
CUTOUT_DEG = 0.02        # ~1.2 arcmin: enough for the aperture and annulus


def _channels() -> list[dict] | None:
    p: Path = get_settings().data_dir / "spherex_channels.csv"
    if not p.exists():
        return None
    with open(p, encoding="utf-8") as f:
        return [{"channel": int(r["channel"]), "lo": float(r["lambda_min_um"]), "hi": float(r["lambda_max_um"])}
                for r in csv.DictReader(f)]


def _templates() -> list[dict]:
    d = get_settings().data_dir / "templates"
    out = []
    for p in sorted(d.glob("*.csv")) if d.exists() else []:
        with open(p, encoding="utf-8") as f:
            rows = [(float(r["lambda_um"]), float(r["flux"])) for r in csv.DictReader(f)]
        if rows:
            out.append({"name": p.stem, "lam": np.array([a for a, _ in rows]), "flux": np.array([b for _, b in rows])})
    return out


def _measure_one(exp: spherex_files.Exposure, ra: float, dec: float) -> dict | None:
    x, y = exp.wcs.world_to_pixel_values(ra, dec)
    if not (np.isfinite(x) and np.isfinite(y)):
        return None
    h, w = exp.image.shape
    if not (detect.ANNULUS[1] <= x < w - detect.ANNULUS[1] and detect.ANNULUS[1] <= y < h - detect.ANNULUS[1]):
        return None
    hide = fl.hide_mask_bits(exp.bits)
    bad = fl.bad_pixels(exp.flags, hide)
    if fl.fraction_in_aperture(bad, float(x), float(y), detect.APER_R + 0.5) > 0:
        return {"dropped": "flagged pixels in the aperture"}  # drop it, don't patch it
    m = detect.measure(exp.image, exp.variance, float(x), float(y), box=1)  # forced: no re-centroid
    pix_sr = proj_plane_pixel_area(exp.wcs.celestial) * (math.pi / 180) ** 2
    to_ujy = pix_sr * 1e12  # MJy -> uJy
    lam, bw = spherex_files.wavelength_at(exp, float(x), float(y))
    if lam is None:
        return {"dropped": "no wavelength"}
    return {"lambdaUm": lam, "bandwidthUm": bw, "fluxUjy": m["flux"] * to_ujy, "errUjy": m["fluxErr"] * to_ujy,
            "snr": m["snr"]}


def _window_ratio(pts: list[dict], num: list[float], den: list[float]) -> float | None:
    def mean_in(lo, hi):
        v = [p["fluxUjy"] for p in pts if lo <= p["lambdaUm"] <= hi and not p["upperLimit"]]
        return float(np.mean(v)) if v else None
    a, b = mean_in(*num), mean_in(*den)
    if a is None or b is None or b <= 0:
        return None
    return a / b


def spectrum(ra: float, dec: float, pm_ra: float | None = None, pm_dec: float | None = None,
             epoch: float | None = None, window: str = "survey", horizons_id: str | None = None) -> dict:
    ck = kv.key("spectrum-v1", kv.round_pos(ra, dec), pm_ra, pm_dec, epoch, window, horizons_id)
    hit = kv.cache().get(ck)
    if hit is not None:
        return hit

    exps = irsa_tap.find_exposures(ra, dec)
    if not exps:
        raise ApiError("no_coverage", "No SPHEREx coverage here yet.", status=404)
    if window == "survey":
        last = max(e["pass"] for e in exps)
        exps = [e for e in exps if e["pass"] == last]

    # Where is the source at each exposure time?
    if horizons_id:
        eph = horizons.positions_at(horizons_id, [e["mjd"] for e in exps])
        positions = [(r["ra"], r["dec"]) for r in eph]
    elif pm_ra is not None and pm_dec is not None and epoch is not None:
        positions = [propagate_linear(ra, dec, pm_ra, pm_dec, epoch, mjd_to_jyear(e["mjd"])) for e in exps]
    else:
        positions = [(ra, dec)] * len(exps)

    items = [(irsa_tap.cutout_url(e["uri"], p[0], p[1], CUTOUT_DEG), {**e, "ra": p[0], "dec": p[1]})
             for e, p in zip(exps, positions)]
    loaded, skipped = spherex_files.fetch_many(items)

    pts, dropped = [], 0
    for ex in loaded:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            r = _measure_one(ex, ex.meta["ra"], ex.meta["dec"])
        if r is None or "dropped" in r:
            dropped += 1
            continue
        upper = r["snr"] < SNR_LIMIT
        pts.append({**r, "upperLimit": upper, "fluxUjy": (SNR_LIMIT * r["errUjy"]) if upper else r["fluxUjy"],
                    "detector": ex.meta["detector"], "dateIso": mjd_iso(ex.meta["mjd"]), "obsId": ex.meta["obsId"]})
    pts.sort(key=lambda p: p["lambdaUm"])

    chans = _channels()
    binned = None
    if chans:
        binned = []
        for c in chans:
            inside = [p for p in pts if c["lo"] <= p["lambdaUm"] < c["hi"] and not p["upperLimit"]]
            if not inside:
                continue
            w = np.array([1 / p["errUjy"] ** 2 for p in inside])
            f = np.array([p["fluxUjy"] for p in inside])
            mean, err = float(np.sum(w * f) / np.sum(w)), float(1 / math.sqrt(np.sum(w)))
            up = mean / err < SNR_LIMIT
            binned.append({"channel": c["channel"], "lambdaUm": (c["lo"] + c["hi"]) / 2, "fluxUjy": SNR_LIMIT * err if up else mean,
                           "errUjy": err, "upperLimit": up, "n": len(inside)})

    idx_cfg = rules.config()["indices"]
    indices = {name: _window_ratio(pts, spec["num"], spec["den"]) for name, spec in idx_cfg.items()}
    water = [v for k, v in indices.items() if k.startswith("water") and v is not None]
    indices["water_index_mean"] = float(np.mean(water)) if water else None

    fits = []
    for t in _templates():
        det = [p for p in pts if not p["upperLimit"]]
        if len(det) < 3:
            break
        lam = np.array([p["lambdaUm"] for p in det])
        f = np.array([p["fluxUjy"] for p in det])
        e = np.array([p["errUjy"] for p in det])
        model = np.interp(lam, t["lam"], t["flux"], left=np.nan, right=np.nan)
        ok = np.isfinite(model)
        if ok.sum() < 3:
            continue
        a = float(np.sum(f[ok] * model[ok] / e[ok] ** 2) / np.sum(model[ok] ** 2 / e[ok] ** 2))
        chi2 = float(np.sum(((f[ok] - a * model[ok]) / e[ok]) ** 2) / max(1, ok.sum() - 1))
        fits.append({"template": t["name"], "scale": a, "redChi2": chi2})
    fits.sort(key=lambda r: r["redChi2"])

    n_up = sum(p["upperLimit"] for p in pts)
    out = {
        "points": pts,
        "binned": binned,
        "binnedTo102": chans is not None,
        "summary": {"nExposures": len(exps), "nMeasured": len(pts) - n_up, "nUpperLimits": n_up,
                    "nDropped": dropped + len(skipped)},
        "indices": indices,
        "templateFits": fits,
        "window": window,
        "method": "aperture r=2px, local background, no aperture correction; WCS pixel area for units",
        "caveats": [c for c in [
            None if chans else "Not yet binned to the 102 channels: IRSA's channel table isn't loaded.",
            "Quick photometry, not science grade.",
        ] if c],
    }
    kv.cache().set(ck, out, expire=86400)
    return out
