"""Source detection and per-epoch measurement on aligned images (photutils)."""
from __future__ import annotations

import warnings

import numpy as np
from astropy.stats import SigmaClip
from photutils.aperture import CircularAnnulus, CircularAperture, aperture_photometry
from photutils.background import Background2D, MedianBackground
from photutils.centroids import centroid_com
from photutils.detection import DAOStarFinder

DETECT_SIGMA = 5.0      # PROPOSAL
FWHM_PX = 1.6           # SPHEREx PSF is about one to two 6.15" pixels; to verify on day 1
APER_R = 2.0
ANNULUS = (4.0, 6.0)


def background(img: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    n = img.shape[0]
    box = max(8, n // 6)
    finite = np.isfinite(img)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        bkg = Background2D(np.where(finite, img, np.nanmedian(img)), box, filter_size=3,
                           sigma_clip=SigmaClip(sigma=3.0), bkg_estimator=MedianBackground(),
                           coverage_mask=~finite, fill_value=0.0)
    return bkg.background, bkg.background_rms


def find_sources(img: np.ndarray, sigma: float = DETECT_SIGMA) -> list[dict]:
    """Sources above `sigma` x background RMS. Returns pixel x, y, peak, sharpness, roundness."""
    bkg, rms = background(img)
    sub = img - bkg
    thr = sigma * float(np.nanmedian(rms))
    finder = DAOStarFinder(fwhm=FWHM_PX, threshold=thr, exclude_border=True)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        tbl = finder(np.nan_to_num(sub), mask=~np.isfinite(img))
    if tbl is None:
        return []
    return [{
        "x": float(r["xcentroid"]), "y": float(r["ycentroid"]), "peak": float(r["peak"]),
        "sharpness": float(r["sharpness"]), "roundness": float(r["roundness1"]),
    } for r in tbl]


def measure(img: np.ndarray, var: np.ndarray, x: float, y: float, box: int = 5) -> dict:
    """Centroid near (x, y) and aperture flux with local background.

    Returns x, y, flux, fluxErr, snr, posErrPx. posErr is the usual
    FWHM / (2.35 * SNR) estimate with a 0.1 px floor; to replace with a PSF fit.
    """
    h, w = img.shape
    x0, y0 = int(round(x)), int(round(y))
    half = box // 2
    sl = (slice(max(0, y0 - half), min(h, y0 + half + 1)), slice(max(0, x0 - half), min(w, x0 + half + 1)))
    cut = np.nan_to_num(img[sl] - np.nanmedian(img[sl]))
    cut = np.clip(cut, 0, None)
    cx, cy = (x, y)
    if cut.sum() > 0:
        dx, dy = centroid_com(cut)
        cx, cy = sl[1].start + float(dx), sl[0].start + float(dy)
    ap = CircularAperture((cx, cy), r=APER_R)
    an = CircularAnnulus((cx, cy), r_in=ANNULUS[0], r_out=ANNULUS[1])
    data = np.nan_to_num(img)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        t = aperture_photometry(data, [ap, an], error=np.sqrt(np.clip(np.nan_to_num(var), 0, None)))
    bk_per_px = float(t["aperture_sum_1"][0]) / an.area
    flux = float(t["aperture_sum_0"][0]) - bk_per_px * ap.area
    err = float(t["aperture_sum_err_0"][0]) or 1e-30
    snr = flux / err
    pos_err = max(0.1, FWHM_PX / (2.35 * max(abs(snr), 1e-3)))
    return {"x": cx, "y": cy, "flux": flux, "fluxErr": err, "snr": snr, "posErrPx": pos_err}


def associate(ref: list[dict], other: list[dict], max_px: float = 2.5) -> dict[int, int]:
    """Greedy nearest-neighbour match: index in ref -> index in other."""
    pairs = []
    for i, a in enumerate(ref):
        for j, b in enumerate(other):
            d = np.hypot(a["x"] - b["x"], a["y"] - b["y"])
            if d <= max_px:
                pairs.append((d, i, j))
    pairs.sort()
    used_i, used_j, out = set(), set(), {}
    for _, i, j in pairs:
        if i in used_i or j in used_j:
            continue
        out[i] = j
        used_i.add(i)
        used_j.add(j)
    return out
