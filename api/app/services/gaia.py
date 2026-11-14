"""Gaia DR3 cone search with proper-motion propagation before matching.

Without propagation every high-motion star looks like a 'new' plus a 'vanished'
source (design doc Feature 7). ESA archive first; if it fails we return
available=False and the UI says the match is missing.
"""
from __future__ import annotations

from ..core import cache as kv
from ..core.errors import ApiError
from ..core.http import fnum, tap_query
from ..core.settings import get_settings
from .coords import propagate_linear, separation_arcsec

GAIA_EPOCH = 2016.0
MATCH_ARCSEC = 2.0  # PROPOSAL


def cone(ra: float, dec: float, radius_arcsec: float) -> list[dict]:
    k = kv.key("gaia-dr3", kv.round_pos(ra, dec), round(radius_arcsec))
    hit = kv.cache().get(k)
    if hit is not None:
        return hit
    adql = f"""
SELECT source_id, ra, dec, pmra, pmdec, parallax, phot_g_mean_mag
FROM gaiadr3.gaia_source
WHERE 1 = CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra:.6f}, {dec:.6f}, {radius_arcsec / 3600.0:.6f}))
""".strip()
    rows = tap_query(get_settings().gaia_tap, adql, service="ESA Gaia archive", timeout=90)
    out = [{
        "sourceId": r.get("source_id"), "ra": fnum(r.get("ra")), "dec": fnum(r.get("dec")),
        "pmRa": fnum(r.get("pmra")), "pmDec": fnum(r.get("pmdec")), "plx": fnum(r.get("parallax")),
        "g": fnum(r.get("phot_g_mean_mag")),
    } for r in rows]
    kv.cache().set(k, out, expire=30 * 86400)
    return out


def safe_cone(ra: float, dec: float, radius_arcsec: float) -> tuple[list[dict], bool]:
    try:
        return cone(ra, dec, radius_arcsec), True
    except ApiError:
        return [], False


def at_epoch(star: dict, epoch: float) -> tuple[float, float]:
    if star.get("pmRa") is None or star.get("pmDec") is None:
        return star["ra"], star["dec"]
    return propagate_linear(star["ra"], star["dec"], star["pmRa"], star["pmDec"], GAIA_EPOCH, epoch)


def match(stars: list[dict], ra: float, dec: float, epoch: float, max_arcsec: float = MATCH_ARCSEC) -> dict | None:
    best, bd = None, max_arcsec
    for s in stars:
        if s["ra"] is None:
            continue
        pra, pdec = at_epoch(s, epoch)
        d = separation_arcsec(ra, dec, pra, pdec)
        if d <= bd:
            best, bd = {**s, "sepArcsec": d}, d
    return best
