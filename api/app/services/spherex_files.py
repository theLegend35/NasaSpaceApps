"""Download and open SPHEREx cutout FITS files.

Each file: IMAGE (MJy/sr, NOT zodi-subtracted), FLAGS, VARIANCE, ZODI, plus PSF
and the WCS-WAVE lookup table used by the spectral WCS (key 'W').
"""
from __future__ import annotations

import hashlib
import io
import logging
import warnings
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS, FITSFixedWarning

from ..core import cache as kv
from ..core.errors import ApiError
from ..core.http import request_with_retries
from ..core.settings import get_settings
from . import flags as fl

log = logging.getLogger("solarax.spherex")
MIN_VERSION = 7.0  # QR3 / DR1; QR2 is superseded


@dataclass
class Exposure:
    meta: dict                 # obsId, detector, mjd, pass, uri
    image: np.ndarray          # zodi-subtracted, MJy/sr
    variance: np.ndarray
    flags: np.ndarray
    wcs: WCS                   # celestial (RA---TAN-SIP)
    header: fits.Header        # IMAGE header
    hdul_bytes: bytes          # kept for the spectral WCS (needs fobj)
    bits: dict[str, int]
    version: str


def _version(hdul: fits.HDUList) -> tuple[float | None, str]:
    for h in hdul:
        v = h.header.get("VERSION")
        if v is not None:
            s = str(v).strip()
            try:
                return float(s.split()[0].lstrip("vV")), s
            except ValueError:
                return None, s
    return None, "unknown"


def _download(url: str) -> bytes:
    d = kv.files_dir() / "fits"
    d.mkdir(exist_ok=True)
    p = d / (hashlib.sha1(url.encode()).hexdigest() + ".fits")
    if p.exists():
        return p.read_bytes()
    r = request_with_retries("GET", url, service="IRSA cutouts", timeout=get_settings().http_timeout_s)
    p.write_bytes(r.content)
    return r.content


def open_exposure(raw: bytes, meta: dict) -> Exposure:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", FITSFixedWarning)
        hdul = fits.open(io.BytesIO(raw), memmap=False)
        ver, ver_s = _version(hdul)
        if ver is None or ver < MIN_VERSION:
            raise ApiError("old_file_version", f"File version {ver_s} is older than QR3/DR1 (7.0); skipped.",
                           status=422)
        img_h = hdul["IMAGE"]
        image = img_h.data.astype(np.float64)
        zodi = hdul["ZODI"].data.astype(np.float64) if "ZODI" in hdul else 0.0
        image = image - zodi  # IRSA: IMAGE is not zodi-subtracted
        variance = hdul["VARIANCE"].data.astype(np.float64)
        flags = hdul["FLAGS"].data.astype(np.int64)
        wcs = WCS(img_h.header)
        bits = fl.bit_map(hdul["FLAGS"].header) or fl.bit_map(img_h.header)
        return Exposure(meta=meta, image=image, variance=variance, flags=flags, wcs=wcs,
                        header=img_h.header.copy(), hdul_bytes=raw, bits=bits, version=ver_s)


def wavelength_at(exp: Exposure, x_cut: float, y_cut: float) -> tuple[float | None, float | None]:
    """Central wavelength and bandwidth (um) at a cutout pixel (0-based).

    Converts to parent-detector pixels first: x_parent = 1 + x_cutout - CRPIX1A
    (design doc Feature 4), then uses WCS(header, fobj=hdul, key='W') with .sip = None.
    To verify on day 1 against the IRSA spectrophotometry notebook.
    """
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            hdul = fits.open(io.BytesIO(exp.hdul_bytes), memmap=False)
            h = hdul["IMAGE"].header
            xp = 1 + x_cut - float(h.get("CRPIX1A", 0.0))
            yp = 1 + y_cut - float(h.get("CRPIX2A", 0.0))
            w = WCS(h, fobj=hdul, key="W")
            w.sip = None
            lam, bw = w.pixel_to_world(xp, yp)
            lam_v = float(getattr(lam, "value", lam))
            bw_v = float(getattr(bw, "value", bw))
            return lam_v, bw_v
    except Exception as e:  # spectral WCS problems shouldn't sink the frame
        log.info("wavelength lookup failed for %s: %s", exp.meta.get("obsId"), e)
        return None, None


def fetch_many(items: list[tuple[str, dict]]) -> tuple[list[Exposure], list[dict]]:
    """Download in a thread pool; failures go in `skipped`, never crash the request."""
    exps: list[Exposure] = []
    skipped: list[dict] = []

    def one(item: tuple[str, dict]):
        url, meta = item
        try:
            return open_exposure(_download(url), meta), None
        except ApiError as e:
            return None, {**meta, "reason": e.message}
        except Exception as e:  # noqa: BLE001 - report every failure as skipped
            return None, {**meta, "reason": f"{type(e).__name__}: {e}"}

    with ThreadPoolExecutor(max_workers=get_settings().download_workers) as pool:
        for exp, skip in pool.map(one, items):
            if exp is not None:
                exps.append(exp)
            else:
                skipped.append(skip)
    exps.sort(key=lambda e: e.meta["mjd"])
    return exps, skipped
