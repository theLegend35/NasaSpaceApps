import math

import numpy as np
import pytest
from astropy.io import fits

from app.services import align, flags, irsa_tap, motion, render, rules
from app.services.coords import parse_coords, propagate_linear, separation_arcsec


# --- coordinates -----------------------------------------------------------

@pytest.mark.parametrize("q", ["133.795 -7.2451", "133.795, -7.2451"])
def test_parse_decimal(q):
    assert parse_coords(q) == pytest.approx((133.795, -7.2451))


@pytest.mark.parametrize("q", ["08h55m10.831s -07d14m42.53s", "8:55:10.83 -7:14:42.5", "08 55 10.831 -07 14 42.53"])
def test_parse_sexagesimal(q):
    ra, dec = parse_coords(q)
    assert ra == pytest.approx(133.79513, abs=2e-4)
    assert dec == pytest.approx(-7.24515, abs=2e-4)


@pytest.mark.parametrize("q", ["WISE 0855", "R Dra", "Barnard's Star", "400 10", "10 95", ""])
def test_parse_rejects_names_and_out_of_range(q):
    assert parse_coords(q) is None


def test_propagate_dec_only():
    ra, dec = propagate_linear(10.0, 0.0, 0.0, 3600.0, 2000.0, 2001.0)  # 3.6"/yr north
    assert ra == pytest.approx(10.0)
    assert separation_arcsec(10.0, 0.0, ra, dec) == pytest.approx(3.6, rel=1e-6)


def test_design_doc_shift_numbers():
    # Design doc Feature 3: WISE 0855 8.15"/yr over 15.3 yr is 20.3 px; 6 months is 0.66 px.
    pm = math.hypot(-8123.7, 673.2)
    assert motion.predicted_shift_px(pm, 15.3) == pytest.approx(20.3, abs=0.05)
    assert motion.predicted_shift_px(pm, 0.5) == pytest.approx(0.66, abs=0.01)


# --- passes ----------------------------------------------------------------

def test_group_passes():
    mjds = [60800, 60801, 60805, 60980, 60982, 61170]
    assert irsa_tap.group_passes(mjds) == [0, 0, 0, 1, 1, 2]


def test_cutout_url_has_trailing_d():
    url = irsa_tap.cutout_url("ibe/data/spherex/x.fits", 133.795, -7.2451, 0.2)
    assert "?center=133.7950000,-7.2451000d&size=0.20000" in url


# --- flags -----------------------------------------------------------------

def test_bit_map_reads_header_not_hardcoded():
    h = fits.Header()
    h["MSKN0000"] = "TRANSIENT"
    h["MSKN0006"] = "GHOST"
    h["MSKD0006"] = "ghost of a bright star"
    bits = flags.bit_map(h)
    assert bits == {"TRANSIENT": 0, "GHOST": 6}
    assert flags.hide_mask_bits(bits, ["GHOST", "NOT_IN_FILE"]) == 1 << 6


def test_bit_map_qr2_style():
    h = fits.Header()
    h["MP_HOT"] = 3
    assert flags.bit_map(h) == {"HOT": 3}


def test_names_at_unknown_bit():
    assert flags.names_at((1 << 2) | (1 << 9), {"HOT": 2}) == ["HOT", "unknown flag bit 9"]


# --- co-add and stretch ----------------------------------------------------

def test_coadd_inverse_variance_and_flags():
    a = np.full((3, 3), 10.0)
    b = np.full((3, 3), 20.0)
    va = np.full((3, 3), 1.0)
    vb = np.full((3, 3), 4.0)
    bad_b = np.zeros((3, 3), bool)
    bad_b[0, 0] = True
    out, var = align.coadd([a, b], [va, vb], [np.zeros((3, 3), bool), bad_b])
    assert out[1, 1] == pytest.approx((10 * 1 + 20 * 0.25) / 1.25)
    assert out[0, 0] == pytest.approx(10.0)  # flagged input gets weight 0
    all_bad = np.ones((3, 3), bool)
    out2, _ = align.coadd([a], [va], [all_bad])
    assert np.isnan(out2).all()


def test_shared_stretch_is_shared():
    f1 = np.linspace(0, 1, 100).reshape(10, 10)
    f2 = f1 * 2
    lo, hi = render.shared_limits([f1, f2])
    assert lo < 0.1 and hi > 1.9


def test_target_grid_odd_and_centred():
    w, shape = align.target_grid(133.795, -7.2451, 12.0)
    assert shape[0] % 2 == 1
    x, y = w.world_to_pixel_values(133.795, -7.2451)
    assert x == pytest.approx((shape[0] - 1) / 2) and y == pytest.approx((shape[0] - 1) / 2)


# --- motion ----------------------------------------------------------------

def test_motion_fit_recovers_pm():
    ra0, dec0, pmra, pmdec = 133.79476, -7.24515, -8123.7, 673.2
    pts = []
    for t in (2010.5, 2025.4, 2025.85, 2026.37):
        r, d = propagate_linear(ra0, dec0, pmra, pmdec, 2010.5, t)
        pts.append({"t": t, "ra": r, "dec": d, "err": 0.5})
    m = motion.fit(pts, ra0, dec0)
    assert m["pmRaArcsecYr"] == pytest.approx(pmra / 1000, rel=1e-3)
    assert m["pmDecArcsecYr"] == pytest.approx(pmdec / 1000, rel=1e-3)
    assert m["significance"] > 50
    assert m["shiftPx"] == pytest.approx(motion.predicted_shift_px(math.hypot(pmra, pmdec), 2026.37 - 2010.5), rel=1e-3)


def test_motion_needs_two_epochs():
    assert motion.fit([{"t": 2025.0, "ra": 1, "dec": 1, "err": 1}], 1, 1) is None


# --- rules -----------------------------------------------------------------

def test_ramp_rising_falling_clamped():
    assert rules.ramp(0.4, 0.4, 2.0) == 0.0
    assert rules.ramp(2.53, 0.4, 2.0) == 1.0  # WISE 0855 W1-W2 maxes the red input
    assert rules.ramp(0.7, 0.9, 0.5) == pytest.approx(0.5)


def test_missing_inputs_score_zero_and_say_not_measured():
    r = rules.classify({"pm_arcsec_yr": None, "gaia": None})
    bd = next(s for s in r["scores"] if s["class"] == "brown_dwarf")
    assert bd["score"] == 0
    assert all(p["text"] in ("not measured", "motion not measured") for p in bd["parts"])


def test_motion_needs_significance():
    feats = {"pm_arcsec_yr": 8.0, "pm_significance": 2.0, "gaia": {}, "w1_w2": 2.53}
    bd = next(s for s in rules.classify(feats)["scores"] if s["class"] == "brown_dwarf")
    motion_part = next(p for p in bd["parts"] if p["name"] == "motion")
    assert motion_part["points"] == 0


def test_brown_dwarf_like_features_rank_brown_dwarf_first():
    feats = {"pm_arcsec_yr": 8.15, "pm_significance": 30, "gaia": {}, "w1_w2": 2.53,
             "ch4_index": 0.4, "water_index_mean": 0.5, "flagged_fraction": 0.0}
    d = rules.classify(feats)["decision"]
    assert d["class"] == "brown_dwarf" and d["score"] == 100 and "candidate" in d["wording"]


def test_fast_star_seen_by_gaia_is_not_brown_dwarf():
    feats = {"pm_arcsec_yr": 10.4, "pm_significance": 40, "gaia": {"g": 8.2}, "w1_w2": 0.2,
             "ch4_index": 1.0, "water_index_mean": 1.0, "flagged_fraction": 0.1}
    assert rules.classify(feats)["decision"]["class"] == "high_motion_star"
