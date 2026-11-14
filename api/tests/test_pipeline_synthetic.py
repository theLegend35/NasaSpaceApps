"""Run the real pipeline code on synthetic SPHEREx-shaped files.

These test our code paths (open, version check, zodi, flags, align, detect,
measure, clean), not SPHEREx itself. No number from here is shown in the app.
"""
import io

import numpy as np
import pytest
from astropy.io import fits
from astropy.wcs import WCS

from app.core.errors import ApiError
from app.services import align, clean, detect, flags, render, spherex_files


def _wcs(ra, dec, n, scale_arcsec=6.15):
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [ra, dec]
    w.wcs.crpix = [(n + 1) / 2, (n + 1) / 2]
    w.wcs.cdelt = [-scale_arcsec / 3600, scale_arcsec / 3600]
    return w


def _star(img, x, y, amp, sigma=0.7):
    yy, xx = np.mgrid[: img.shape[0], : img.shape[1]]
    img += amp * np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * sigma**2))


def make_file(ra=133.795, dec=-7.245, n=81, version="7.0", ghost_at=None, seed=0):
    rng = np.random.default_rng(seed)
    w = _wcs(ra, dec, n)
    img = rng.normal(0.0, 0.05, (n, n)) + 1.0  # 1.0 = zodi level
    _star(img, 40, 40, 5.0)
    _star(img, 20, 60, 3.0)
    fl = np.zeros((n, n), np.int32)
    if ghost_at:
        fl[ghost_at[1] - 2: ghost_at[1] + 3, ghost_at[0] - 2: ghost_at[0] + 3] |= 1 << 6
    hdr = w.to_header()
    prim = fits.PrimaryHDU()
    prim.header["VERSION"] = version
    fh = fits.Header()
    fh["MSKN0006"] = "GHOST"
    hdul = fits.HDUList([
        prim,
        fits.ImageHDU(img.astype(np.float32), hdr, name="IMAGE"),
        fits.ImageHDU(fl, fh, name="FLAGS"),
        fits.ImageHDU(np.full((n, n), 0.0025, np.float32), hdr, name="VARIANCE"),
        fits.ImageHDU(np.full((n, n), 1.0, np.float32), hdr, name="ZODI"),
    ])
    buf = io.BytesIO()
    hdul.writeto(buf)
    return buf.getvalue()


def test_open_subtracts_zodi_and_reads_flags():
    ex = spherex_files.open_exposure(make_file(), {"obsId": "x", "mjd": 60800.0, "pass": 0, "detector": "D1"})
    assert abs(float(np.median(ex.image))) < 0.05  # zodi removed
    assert ex.bits == {"GHOST": 6}


def test_rejects_old_versions():
    with pytest.raises(ApiError) as e:
        spherex_files.open_exposure(make_file(version="6.5"), {"obsId": "x"})
    assert e.value.code == "old_file_version"


def test_align_detect_measure_clean_end_to_end():
    raw = make_file(ghost_at=(20, 60))
    ex = spherex_files.open_exposure(raw, {"obsId": "x", "mjd": 60800.0, "pass": 0, "detector": "D1"})
    w_out, shape = align.target_grid(133.795, -7.245, 6.0)
    img = align.reproject_image(ex.image, ex.wcs, w_out, shape)
    fl_out, covered = align.reproject_flags(ex.flags, ex.wcs, w_out, shape)
    bad = flags.bad_pixels(fl_out, flags.hide_mask_bits(ex.bits, ["GHOST"]))
    assert set(np.unique(fl_out)) <= {0, 64}  # nearest-neighbour: bits never blur

    srcs = detect.find_sources(img)
    assert len(srcs) >= 2
    var = align.reproject_image(ex.variance, ex.wcs, w_out, shape)
    for s in srcs:
        m = detect.measure(img, var, s["x"], s["y"])
        assert m["snr"] > 5
        s["flaggedFraction"] = flags.fraction_in_aperture(bad, s["x"], s["y"], 2.5)
        s["topFlag"] = "GHOST"
    verdicts = [clean.judge(s, covered, []) for s in srcs]
    reasons = {v["reason"] for v in verdicts}
    assert "flags" in reasons          # the star sitting on the ghost flags is rejected
    assert any(not v["rejected"] for v in verdicts)

    png = render.to_png(img, *render.shared_limits([img]))
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
