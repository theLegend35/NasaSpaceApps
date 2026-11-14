"""GET /cutouts: blink frames, difference, stack, co-add, RGB and the AllWISE deep-time frame."""
from __future__ import annotations

import logging

import numpy as np

from ..core import cache as kv
from ..core.errors import ApiError
from . import align, allwise, render
from .field import AlignedField, AlignedFrame, build, field_key, mjd_iso

log = logging.getLogger("solarax.cutouts")


def _save(png: bytes, *parts) -> str:
    name = kv.key("png", *parts) + ".png"
    p = kv.files_dir() / name
    if not p.exists():
        p.write_bytes(png)
    return kv.file_url(name)


def _frame_meta(f: AlignedFrame) -> dict:
    m = f.meta
    return {
        "kind": "spherex", "obsId": m["obsId"], "dateIso": mjd_iso(m["mjd"]), "mjd": m["mjd"], "pass": m["pass"],
        "detector": m["detector"], "wavelengthUm": f.wavelength_um, "bandwidthUm": f.bandwidth_um,
        "release": f.version, "flaggedFraction": round(f.flagged_fraction, 4), "nExposures": 1,
    }


def _coadd_pass(frames: list[AlignedFrame]) -> tuple[np.ndarray, np.ndarray, dict]:
    img, var = align.coadd([f.image for f in frames], [f.variance for f in frames], [f.bad for f in frames])
    mjds = [f.meta["mjd"] for f in frames]
    lams = [f.wavelength_um for f in frames if f.wavelength_um is not None]
    meta = {
        "kind": "coadd", "obsId": None, "dateIso": mjd_iso(float(np.mean(mjds))), "mjd": float(np.mean(mjds)),
        "mjdRange": [min(mjds), max(mjds)], "pass": frames[0].meta["pass"], "detector": frames[0].meta["detector"],
        "wavelengthUm": None, "wavelengthRangeUm": [min(lams), max(lams)] if lams else None,
        "release": frames[0].version, "flaggedFraction": round(float(np.mean(~np.isfinite(img))), 4),
        "nExposures": len(frames),
    }
    return img, var, meta


def _deep_time_frame(fld: AlignedField, band: int = 2) -> dict | None:
    """AllWISE Atlas cutout on the same grid, stretched on its own."""
    try:
        res = allwise.cutout(fld.ra, fld.dec, fld.fov_arcmin * 1.2, band=band)
    except ApiError as e:
        log.info("AllWISE cutout failed: %s", e.message)
        return None
    if res is None:
        return None
    data, wcs, coadd_id = res
    img = align.reproject_image(data, wcs, fld.wcs, fld.shape)
    lo, hi = render.shared_limits([img])
    url = _save(render.to_png(img, lo, hi), "allwise", fld.ra, fld.dec, fld.fov_arcmin, band, coadd_id)
    return {
        "kind": "allwise", "obsId": coadd_id, "dateIso": "2010-07-01T00:00:00Z", "mjd": 55378.0,
        "epochLabel": "AllWISE (2010)", "pass": -1, "detector": f"AllWISE-W{band}", "wavelengthUm": None,
        "release": "AllWISE", "flaggedFraction": None, "nExposures": None, "pngUrl": url,
        "stretch": {"vmin": lo, "vmax": hi, "separate": True},
    }


def cutouts(ra: float, dec: float, fov: float = 12.0, detector: str | None = "D1", mode: str = "single",
            diff: str = "none", stack: bool = False, baseline: str = "none", mask: bool = False,
            obs_ids: list[str] | None = None) -> dict:
    if not 2.0 <= fov <= 30.0:
        raise ApiError("bad_fov", "Field of view must be between 2 and 30 arcmin.", status=422)
    if mode not in ("single", "coadd", "rgb"):
        raise ApiError("bad_mode", "mode must be single, coadd or rgb.", status=422)
    if diff not in ("none", "first", "median"):
        raise ApiError("bad_diff", "diff must be none, first or median.", status=422)

    ck = field_key(ra, dec, fov, detector, (mode, diff, stack, baseline, mask, tuple(obs_ids or [])))
    hit = kv.cache().get(ck)
    if hit is not None:
        return hit

    if mode == "rgb":
        out = _rgb(ra, dec, fov)
        kv.cache().set(ck, out, expire=86400)
        return out

    fld = build(ra, dec, fov, detector, obs_ids)

    # Images and their metadata for the requested mode.
    imgs: list[np.ndarray] = []
    metas: list[dict] = []
    bads: list[np.ndarray | None] = []
    if mode == "coadd":
        for p, frames in sorted(fld.passes().items()):
            img, _, meta = _coadd_pass(frames)
            imgs.append(img), metas.append(meta), bads.append(None)
    else:
        for f in fld.frames:
            imgs.append(f.image), metas.append(_frame_meta(f)), bads.append(f.bad if mask else None)

    if stack:
        with np.errstate(invalid="ignore"):
            masked = [np.where(b, np.nan, i) if b is not None else i for i, b in zip(imgs, bads)]
            stacked = np.nanmean(np.stack(masked), axis=0)
        metas = [{**metas[0], "kind": "stack", "nExposures": len(imgs), "dateIso": metas[0]["dateIso"],
                  "mjdRange": [metas[0]["mjd"], metas[-1]["mjd"]]}]
        imgs, bads = [stacked], [None]

    vmin, vmax = render.shared_limits(imgs)
    stretch = {"method": "asinh", "vmin": vmin, "vmax": vmax, "percentiles": [0.5, 99.5], "shared": True}

    ref = None
    if diff != "none" and len(imgs) > 1:
        ref = imgs[0] if diff == "first" else align.median_reference(imgs)
        stretch["difference"] = {"reference": diff}

    frames_out = []
    for i, (img, meta) in enumerate(zip(imgs, metas)):
        parts = (meta.get("obsId") or meta["mjd"], ra, dec, fov, meta["release"], mode, diff, stack)
        if ref is not None:
            png, lim = render.diff_png(img - ref, stretch.get("difference", {}).get("limit"))
            stretch["difference"]["limit"] = lim
        else:
            png = render.to_png(img, vmin, vmax)
        fr = {**meta, "id": f"f{i}", "pngUrl": _save(png, *parts)}
        if mask and mode == "single":
            f = fld.frames[i] if not stack else None
            if f is not None:
                fr["maskPngUrl"] = _save(render.mask_png(f.bad & f.covered, ~f.covered), "mask", *parts)
        frames_out.append(fr)

    if baseline == "allwise":
        deep = _deep_time_frame(fld)
        if deep:
            frames_out.insert(0, {**deep, "id": "allwise"})

    out = {
        "field": {"ra": ra, "dec": dec, "fovArcmin": fov, "n": fld.n, "pixelArcsec": align.PIXEL_ARCSEC,
                  "orientation": "north up, east left", "detector": detector},
        "mode": mode, "diff": diff, "stack": stack, "baseline": baseline,
        "frames": frames_out,
        "skipped": [{"obsId": s.get("obsId"), "detector": s.get("detector"), "dateIso": mjd_iso(s["mjd"]),
                     "reason": s.get("reason")} for s in fld.skipped],
        "stretch": stretch,
        "counts": fld.counts,
    }
    kv.cache().set(ck, out, expire=86400)
    return out


def _rgb(ra: float, dec: float, fov: float) -> dict:
    """D1 co-add as blue, D3 as green, D6 as red (PROPOSAL), latest pass of each."""
    chans = {}
    for det in ("D6", "D3", "D1"):
        fld = build(ra, dec, fov, det)
        last = max(fld.passes())
        img, _, meta = _coadd_pass(fld.passes()[last])
        chans[det] = (img, meta)
    png = render.rgb_png(chans["D6"][0], chans["D3"][0], chans["D1"][0])
    url = _save(png, "rgb", ra, dec, fov)
    return {
        "field": {"ra": ra, "dec": dec, "fovArcmin": fov, "pixelArcsec": align.PIXEL_ARCSEC,
                  "orientation": "north up, east left"},
        "mode": "rgb",
        "frames": [{"id": "rgb", "kind": "rgb", "pngUrl": url, "channels": {"red": "D6", "green": "D3", "blue": "D1"},
                    "dateIso": chans["D1"][1]["dateIso"], "detector": "D1/D3/D6"}],
        "skipped": [], "stretch": {"method": "asinh", "perChannel": True},
    }
