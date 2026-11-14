"""AllWISE (2010) deep-time frame and catalog.

Atlas coadd search via IRSA IBE, cutout from the W1/W2 intensity image.
Never difference AllWISE against SPHEREx pixel by pixel: different telescope,
band and PSF. Deep time is blink plus centroids only (design doc Feature 3).
"""
from __future__ import annotations

import csv
import io
import warnings

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

from ..core import cache as kv
from ..core.http import fnum, request_with_retries, tap_query
from ..core.settings import get_settings
from .coords import separation_arcsec

ALLWISE_EPOCH = 2010.5  # mid-observation for the Atlas coadds (design doc: 2010-05-03 to 2010-11-13)


def find_coadd(ra: float, dec: float) -> str | None:
    """Coadd ID (e.g. '1342m076_ac51') whose footprint contains the position."""
    k = kv.key("allwise-coadd", kv.round_pos(ra, dec, 3))
    hit = kv.cache().get(k)
    if hit is not None:
        return hit or None
    base = get_settings().irsa_base
    url = f"{base}/ibe/search/wise/allwise/p3am_cdd?POS={ra:.6f},{dec:.6f}&ct=csv"
    r = request_with_retries("GET", url, service="IRSA IBE (AllWISE)")
    rows = list(csv.DictReader(io.StringIO(r.text)))
    ids = sorted({row.get("coadd_id", "").strip() for row in rows if row.get("coadd_id")})
    coadd = ids[0] if ids else ""
    kv.cache().set(k, coadd, expire=30 * 86400)
    return coadd or None


def cutout(ra: float, dec: float, size_arcmin: float, band: int = 2) -> tuple[np.ndarray, WCS, str] | None:
    coadd = find_coadd(ra, dec)
    if not coadd:
        return None
    base = get_settings().irsa_base
    url = (f"{base}/ibe/data/wise/allwise/p3am_cdd/{coadd[:2]}/{coadd[:4]}/{coadd}/"
           f"{coadd}-w{band}-int-3.fits?center={ra:.6f},{dec:.6f}&size={size_arcmin:.2f}arcmin")
    d = kv.files_dir() / "fits"
    d.mkdir(exist_ok=True)
    p = d / f"allwise-{kv.key(url)}.fits"
    if p.exists():
        raw = p.read_bytes()
    else:
        raw = request_with_retries("GET", url, service="IRSA IBE (AllWISE cutout)").content
        p.write_bytes(raw)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        hdul = fits.open(io.BytesIO(raw), memmap=False)
        return hdul[0].data.astype(np.float64), WCS(hdul[0].header), coadd


def catalog(ra: float, dec: float, radius_arcsec: float) -> list[dict]:
    """allwise_p3as_psd cone: designation, position, W1/W2."""
    k = kv.key("allwise-cat", kv.round_pos(ra, dec), round(radius_arcsec))
    hit = kv.cache().get(k)
    if hit is not None:
        return hit
    adql = f"""
SELECT designation, ra, dec, sigra, sigdec, w1mpro, w1sigmpro, w2mpro, w2sigmpro, cc_flags, ext_flg
FROM allwise_p3as_psd
WHERE 1 = CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra:.6f}, {dec:.6f}, {radius_arcsec / 3600.0:.6f}))
""".strip()
    rows = tap_query(f"{get_settings().irsa_base}/TAP/sync", adql, service="IRSA TAP (AllWISE)")
    out = []
    for r in rows:
        w1, w2 = fnum(r.get("w1mpro")), fnum(r.get("w2mpro"))
        sra, sdec = fnum(r.get("sigra")), fnum(r.get("sigdec"))
        out.append({
            # Catalog position error; 0.1" floor so one point can't dominate the fit.
            "posErrArcsec": max(0.1, (sra**2 + sdec**2) ** 0.5) if sra is not None and sdec is not None else 0.5,
            "designation": r.get("designation"), "ra": fnum(r.get("ra")), "dec": fnum(r.get("dec")),
            "w1": w1, "w2": w2, "w1err": fnum(r.get("w1sigmpro")), "w2err": fnum(r.get("w2sigmpro")),
            "w1_w2": (w1 - w2) if w1 is not None and w2 is not None else None,
            "ccFlags": r.get("cc_flags"), "epoch": ALLWISE_EPOCH,
        })
    kv.cache().set(k, out, expire=30 * 86400)
    return out


def nearest(cat: list[dict], ra: float, dec: float, max_arcsec: float) -> dict | None:
    best, bd = None, max_arcsec
    for c in cat:
        if c["ra"] is None:
            continue
        d = separation_arcsec(ra, dec, c["ra"], c["dec"])
        if d <= bd:
            best, bd = c, d
    return best
