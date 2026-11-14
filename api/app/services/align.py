"""Put every frame on one tangent-plane grid centred on the search position."""
from __future__ import annotations

import warnings

import numpy as np
from astropy.wcs import WCS
from reproject import reproject_interp

PIXEL_ARCSEC = 6.15  # SPHEREx native pixel (often quoted 6.2)


def target_grid(ra: float, dec: float, fov_arcmin: float, pixel_arcsec: float = PIXEL_ARCSEC) -> tuple[WCS, tuple[int, int]]:
    n = max(8, int(round(fov_arcmin * 60.0 / pixel_arcsec)))
    if n % 2 == 0:
        n += 1  # odd size: the target sits on the centre pixel
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [ra, dec]
    w.wcs.crpix = [(n + 1) / 2.0, (n + 1) / 2.0]
    w.wcs.cdelt = [-pixel_arcsec / 3600.0, pixel_arcsec / 3600.0]
    w.wcs.cunit = ["deg", "deg"]
    return w, (n, n)


def reproject_image(data: np.ndarray, wcs_in: WCS, wcs_out: WCS, shape: tuple[int, int]) -> np.ndarray:
    """Bilinear reprojection for display. Measurements use native pixels instead."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        out, foot = reproject_interp((data, wcs_in), wcs_out, shape_out=shape, order="bilinear")
    out[foot == 0] = np.nan
    return out


def reproject_flags(flags: np.ndarray, wcs_in: WCS, wcs_out: WCS, shape: tuple[int, int]) -> tuple[np.ndarray, np.ndarray]:
    """Nearest-neighbour so bits never blur into fractions. Returns (flags, covered)."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        out, foot = reproject_interp((flags.astype(np.float64), wcs_in), wcs_out, shape_out=shape,
                                     order="nearest-neighbor")
    covered = (foot > 0) & np.isfinite(out)
    res = np.zeros(shape, dtype=np.int64)
    res[covered] = out[covered].astype(np.int64)
    return res, covered


def coadd(images: list[np.ndarray], variances: list[np.ndarray], bad: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """Inverse-variance weighted mean; weight 0 on flagged pixels.

    coadd = sum(w_i I_i) / sum(w_i), w_i = 1 / VARIANCE_i. All-flagged pixels -> NaN.
    Returns (coadd, coadd_variance).
    """
    num = np.zeros_like(images[0], dtype=np.float64)
    den = np.zeros_like(images[0], dtype=np.float64)
    for img, var, b in zip(images, variances, bad):
        with np.errstate(divide="ignore", invalid="ignore"):
            w = np.where((var > 0) & np.isfinite(var) & np.isfinite(img) & ~b, 1.0 / var, 0.0)
        num += np.where(w > 0, w * np.nan_to_num(img), 0.0)
        den += w
    with np.errstate(divide="ignore", invalid="ignore"):
        out = np.where(den > 0, num / den, np.nan)
        out_var = np.where(den > 0, 1.0 / den, np.nan)
    return out, out_var


def median_reference(images: list[np.ndarray]) -> np.ndarray:
    """Median of all frames: a moving source doesn't survive the median."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanmedian(np.stack(images), axis=0)
