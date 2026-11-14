"""Weighted straight-line fit of position vs time (AllWISE 2010.5 + SPHEREx passes)."""
from __future__ import annotations

import math

import numpy as np

from .align import PIXEL_ARCSEC


def fit(points: list[dict], ref_ra: float, ref_dec: float) -> dict | None:
    """points: [{t (Julian year), ra, dec, err (arcsec)}]. Needs >= 2 epochs.

    Fits x = x0 + mu_x t and y = y0 + mu_y t on the tangent plane (arcsec,
    x = east), weights 1/err^2. Returns motion in arcsec/yr, its 1-sigma error,
    significance = motion / error, baseline years and shift in 6.15" pixels.
    """
    pts = [p for p in points if p.get("ra") is not None and p.get("err")]
    if len({round(p["t"], 3) for p in pts}) < 2:
        return None
    cosd = math.cos(math.radians(ref_dec))
    t = np.array([p["t"] for p in pts])
    x = np.array([((p["ra"] - ref_ra + 180) % 360 - 180) * cosd * 3600 for p in pts])
    y = np.array([(p["dec"] - ref_dec) * 3600 for p in pts])
    w = 1.0 / np.array([p["err"] for p in pts]) ** 2
    t0 = float(np.sum(w * t) / np.sum(w))
    tt = t - t0
    s_tt = float(np.sum(w * tt * tt))
    if s_tt <= 0:
        return None
    mux = float(np.sum(w * tt * x) / s_tt)
    muy = float(np.sum(w * tt * y) / s_tt)
    err_axis = math.sqrt(1.0 / s_tt)  # same for both axes with shared weights
    # Inflate by reduced chi-square when the fit is worse than the errors say (>2 dof only).
    n = len(pts)
    if n > 2:
        xm = float(np.sum(w * x) / np.sum(w))
        ym = float(np.sum(w * y) / np.sum(w))
        chi2 = float(np.sum(w * ((x - xm - mux * tt) ** 2 + (y - ym - muy * tt) ** 2)))
        red = chi2 / (2 * n - 4)
        if red > 1:
            err_axis *= math.sqrt(red)
    mu = math.hypot(mux, muy)
    err = err_axis  # error on |mu| for equal per-axis errors
    baseline = float(t.max() - t.min())
    return {
        "pmRaArcsecYr": mux, "pmDecArcsecYr": muy, "pmArcsecYr": mu, "errArcsecYr": err,
        "significance": mu / err if err > 0 else None, "baselineYears": baseline,
        "shiftPx": mu * baseline / PIXEL_ARCSEC, "nEpochs": n,
        "pa_deg": (math.degrees(math.atan2(mux, muy)) + 360) % 360,
    }


def predicted_shift_px(pm_mas_yr: float, dt_years: float) -> float:
    """shift (px) = mu * dt / 6.15" per px (design doc Feature 3)."""
    return abs(pm_mas_yr) / 1000.0 * dt_years / PIXEL_ARCSEC
