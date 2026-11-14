"""GET /sources: find every source, measure it per pass, cross-match, fit motion, clean, rank.

AI vision engine steps 1-2 (design doc Features 6-7).
"""
from __future__ import annotations

import logging
import math
from collections import Counter

import numpy as np

from ..core import cache as kv
from . import align, allwise, clean, detect, gaia, motion, rules
from . import flags as fl
from .align import PIXEL_ARCSEC
from .coords import mjd_to_jyear, propagate_linear, separation_arcsec
from .field import AlignedField, build, field_key, mjd_iso

log = logging.getLogger("solarax.sources")

ALIGN_FLOOR_PX = 0.3     # design doc alignment target; actual accuracy to verify at Checkpoint 1
ALLWISE_MATCH_ARCSEC = 3.0
MAX_PAIR_ARCSEC = 150.0  # ~10"/yr over 15 years; anything faster is out of scope
MAX_SOURCES = 200        # crowded fields: cap the list and say so


def _pass_coadds(fld: AlignedField) -> dict[int, dict]:
    out = {}
    for p, frames in sorted(fld.passes().items()):
        img, var = align.coadd([f.image for f in frames], [f.variance for f in frames], [f.bad for f in frames])
        out[p] = {"img": img, "var": var, "mjd": float(np.mean([f.meta["mjd"] for f in frames])), "frames": frames}
    return out


def _flag_summary(frames, x: float, y: float) -> tuple[float, str | None]:
    fracs, names = [], Counter()
    r = detect.APER_R + 0.5
    for f in frames:
        fracs.append(fl.fraction_in_aperture(f.bad, x, y, r))
        h, w = f.flags.shape
        x0, y0 = int(round(x)), int(round(y))
        if 0 <= x0 < w and 0 <= y0 < h:
            for n in fl.names_at(int(f.flags[y0, x0]), f.bits):
                if n in fl.flag_config()["hide"]:
                    names[n] += 1
    return float(np.mean(fracs)) if fracs else 0.0, (names.most_common(1)[0][0] if names else None)


def _variability(fluxes: list[tuple[float, float]]) -> float | None:
    """Largest deviation from the weighted mean flux across passes, in sigma.

    Caveat (wavelength trap): pass co-adds mix wavelengths, so strongly coloured
    sources can look variable. Judge real variability from the spectrum per pass.
    """
    ok = [(f, e) for f, e in fluxes if e and e > 0 and np.isfinite(f)]
    if len(ok) < 2:
        return None
    f = np.array([a for a, _ in ok])
    e = np.array([b for _, b in ok])
    w = 1 / e**2
    m = float(np.sum(w * f) / np.sum(w))
    return float(np.max(np.abs(f - m) / e))


def sources(ra: float, dec: float, fov: float = 12.0, detector: str | None = "D1", hint: dict | None = None) -> dict:
    ck = field_key(ra, dec, fov, detector, ("sources-v1", tuple(sorted((hint or {}).items()))))
    hit = kv.cache().get(ck)
    if hit is not None:
        return hit

    fld = build(ra, dec, fov, detector)
    co = _pass_coadds(fld)
    latest = max(co)
    ref = detect.find_sources(co[latest]["img"])
    capped = len(ref) > MAX_SOURCES
    if capped:
        ref = sorted(ref, key=lambda s: s["peak"], reverse=True)[:MAX_SOURCES]
    per_pass_dets = {p: (ref if p == latest else detect.find_sources(c["img"])) for p, c in co.items()}
    assoc = {p: detect.associate(ref, d) for p, d in per_pass_dets.items() if p != latest}

    # Catalogs over the field plus a margin.
    radius = fov * 60 / 2 * math.sqrt(2) + 30
    gstars, gaia_ok = gaia.safe_cone(ra, dec, radius + MAX_PAIR_ARCSEC)
    try:
        wise = allwise.catalog(ra, dec, radius + MAX_PAIR_ARCSEC)
        wise_ok = True
    except Exception as e:  # noqa: BLE001
        log.info("AllWISE catalog unavailable: %s", e)
        wise, wise_ok = [], False

    covered = co[latest]["frames"][0].covered
    streaks = clean.streak_segments(co[latest]["img"])
    t_latest = mjd_to_jyear(co[latest]["mjd"])

    out_sources = []
    for i, s in enumerate(ref):
        epochs = []
        fluxes = []
        for p, c in co.items():
            if p == latest:
                pos = (s["x"], s["y"])
            elif i in assoc.get(p, {}):
                d = per_pass_dets[p][assoc[p][i]]
                pos = (d["x"], d["y"])
            else:
                pos = (s["x"], s["y"])  # forced measurement at the latest position
            m = detect.measure(c["img"], c["var"], *pos)
            fluxes.append((m["flux"], m["fluxErr"]))
            if m["snr"] < 3:
                continue
            sra, sdec = fld.pix_to_world(m["x"], m["y"])
            err = math.hypot(m["posErrPx"], ALIGN_FLOOR_PX) * PIXEL_ARCSEC
            epochs.append({"t": mjd_to_jyear(c["mjd"]), "ra": sra, "dec": sdec, "err": err, "source": f"SPHEREx pass {p + 1}",
                           "uv": fld.world_to_uv(sra, sdec), "snr": round(m["snr"], 1)})
        if not epochs:
            continue
        last = max(epochs, key=lambda e: e["t"])
        sra, sdec = last["ra"], last["dec"]

        g = gaia.match(gstars, sra, sdec, t_latest) if gaia_ok else None
        gaia_val = None if not gaia_ok else (g or {})

        # AllWISE association for the 2010.5 point.
        assoc_kind, w = None, None
        if wise_ok:
            if g and g.get("pmRa") is not None:
                pra, pdec = gaia.at_epoch(g, allwise.ALLWISE_EPOCH)
                w, assoc_kind = allwise.nearest(wise, pra, pdec, ALLWISE_MATCH_ARCSEC), "gaia-propagated"
            elif hint and hint.get("pmRa") is not None and separation_arcsec(
                    sra, sdec, *propagate_linear(hint["ra"], hint["dec"], hint["pmRa"], hint["pmDec"],
                                                 hint["epoch"], t_latest)) < 3 * PIXEL_ARCSEC:
                pra, pdec = propagate_linear(hint["ra"], hint["dec"], hint["pmRa"], hint["pmDec"], hint["epoch"],
                                             allwise.ALLWISE_EPOCH)
                w, assoc_kind = allwise.nearest(wise, pra, pdec, ALLWISE_MATCH_ARCSEC), "catalog-pm"
            if w is None:
                w = allwise.nearest(wise, sra, sdec, ALLWISE_MATCH_ARCSEC)
                assoc_kind = "same-position" if w else None
        pts = list(epochs)
        if w is not None:
            pts.append({"t": allwise.ALLWISE_EPOCH, "ra": w["ra"], "dec": w["dec"], "err": w["posErrArcsec"],
                        "source": f"AllWISE {w['designation']}", "uv": fld.world_to_uv(w["ra"], w["dec"])})
        pts.sort(key=lambda e: e["t"])
        mot = motion.fit(pts, sra, sdec)

        ff, top_flag = _flag_summary(co[latest]["frames"], s["x"], s["y"])
        var_sigma = _variability(fluxes)
        src = {"x": s["x"], "y": s["y"], "sharpness": s["sharpness"], "flaggedFraction": ff, "topFlag": top_flag}
        verdict = clean.judge(src, covered, streaks)

        tags = []
        if g:
            tags.append("gaia_match")
        elif gaia_ok:
            tags.append("gaia_dark")
        if ff >= 0.2:
            tags.append("artifact_risk")
        if wise_ok and w is None and len(epochs) < len(co):
            tags.append("new")
        if var_sigma is not None and var_sigma >= 10:
            tags.append("variable")

        features = {
            "pm_arcsec_yr": mot["pmArcsecYr"] if mot else None,
            "pm_significance": mot["significance"] if mot else None,
            "w1_w2": w["w1_w2"] if w else None,
            "gaia": gaia_val,
            "flagged_fraction": ff,
            "variability_sigma": var_sigma,
            "extent_ratio": None,          # needs the ePSF: not measured yet
            "single_exposure": None,       # needs per-exposure detections: not measured yet
            "known_ss": None,
            "ch4_index": None, "water_index_mean": None,  # from /spectrum
            "same_day_rate_arcsec_hr": None,
        }
        cls = rules.classify(features)
        out_sources.append({
            "id": f"SX{sra:09.5f}{sdec:+09.5f}",
            "ra": sra, "dec": sdec, "uv": fld.world_to_uv(sra, sdec),
            "gaia": ({"sourceId": g["sourceId"], "g": g.get("g"), "sepArcsec": round(g["sepArcsec"], 2),
                      "pmRa": g.get("pmRa"), "pmDec": g.get("pmDec")} if g else None),
            "gaiaStatus": "match" if g else ("dark" if gaia_ok else "unavailable"),
            "allwise": ({"designation": w["designation"], "w1": w["w1"], "w2": w["w2"], "w1_w2": w["w1_w2"],
                         "association": assoc_kind} if w else None),
            "motion": ({**mot, "track": [{"t": round(p["t"], 3), "uv": p["uv"], "source": p["source"]} for p in pts]}
                       if mot else None),
            "variabilitySigma": var_sigma,
            "flaggedFraction": round(ff, 3), "topFlag": top_flag,
            "clean": verdict,
            "tags": tags,
            "features": {k: v for k, v in features.items() if k != "gaia"},
            "topClass": cls["decision"],
        })

    def rank_key(s):
        sig = (s["motion"] or {}).get("significance") or 0.0
        return (s["clean"]["rejected"], -sig, -s["topClass"]["score"])

    out_sources.sort(key=rank_key)
    out = {
        "field": {"ra": ra, "dec": dec, "fovArcmin": fov, "detector": detector, "n": fld.n},
        "sources": out_sources,
        "capped": capped,
        "catalogs": {"gaia": gaia_ok, "allwise": wise_ok},
        "passes": [{"pass": p, "dateIso": mjd_iso(c["mjd"]), "nExposures": len(c["frames"])} for p, c in co.items()],
        "notes": [n for n in [
            None if gaia_ok else "Gaia archive didn't answer, so sources are shown without the Gaia match.",
            None if wise_ok else "AllWISE catalog didn't answer, so there is no 2010 baseline.",
            "List capped at the 200 brightest sources." if capped else None,
        ] if n],
    }
    kv.cache().set(ck, out, expire=86400)
    return out
