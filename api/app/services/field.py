"""One field = one (ra, dec, fov, detector) request: exposures downloaded, aligned and masked.

Everything downstream (cutouts PNGs, sources, motion) works from an AlignedField
so we download and reproject once per request.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from astropy.time import Time
from astropy.wcs import WCS

from ..core import cache as kv
from ..core.errors import ApiError
from . import align, flags as fl, irsa_tap, spherex_files

MAX_PER_PASS = 6  # PROPOSAL: R Draconis has 584 D1 visits; cap frames per pass


@dataclass
class AlignedFrame:
    meta: dict
    image: np.ndarray
    variance: np.ndarray
    flags: np.ndarray
    covered: np.ndarray
    bad: np.ndarray
    bits: dict[str, int]
    version: str
    wavelength_um: float | None
    bandwidth_um: float | None

    @property
    def flagged_fraction(self) -> float:
        cov = self.covered.sum()
        return float((self.bad & self.covered).sum() / cov) if cov else 1.0


@dataclass
class AlignedField:
    ra: float
    dec: float
    fov_arcmin: float
    detector: str | None
    wcs: WCS
    shape: tuple[int, int]
    frames: list[AlignedFrame]
    skipped: list[dict]
    counts: dict[str, int] = field(default_factory=dict)

    @property
    def n(self) -> int:
        return self.shape[0]

    def passes(self) -> dict[int, list[AlignedFrame]]:
        out: dict[int, list[AlignedFrame]] = {}
        for f in self.frames:
            out.setdefault(f.meta["pass"], []).append(f)
        return out

    def world_to_uv(self, ra: float, dec: float) -> tuple[float, float]:
        """Sky -> PNG fraction (0..1, origin top-left). PNGs are flipped so north is up."""
        x, y = self.wcs.world_to_pixel_values(ra, dec)
        n = self.n
        return float((x + 0.5) / n), float((n - 1 - y + 0.5) / n)

    def pix_to_world(self, x: float, y: float) -> tuple[float, float]:
        r, d = self.wcs.pixel_to_world_values(x, y)
        return float(r), float(d)


def mjd_iso(mjd: float) -> str:
    return Time(mjd, format="mjd").isot[:19] + "Z"


def select_exposures(exps: list[dict], max_per_pass: int = MAX_PER_PASS) -> list[dict]:
    """Spread at most max_per_pass exposures evenly across each pass."""
    by_pass: dict[int, list[dict]] = {}
    for e in exps:
        by_pass.setdefault(e["pass"], []).append(e)
    out = []
    for p in sorted(by_pass):
        items = by_pass[p]
        if len(items) > max_per_pass:
            idx = np.linspace(0, len(items) - 1, max_per_pass).round().astype(int)
            items = [items[i] for i in sorted(set(idx))]
        out += items
    return out


def build(ra: float, dec: float, fov_arcmin: float, detector: str | None,
          obs_ids: list[str] | None = None, max_per_pass: int = MAX_PER_PASS) -> AlignedField:
    all_exps = irsa_tap.find_exposures(ra, dec)
    counts = irsa_tap.counts_by_detector(all_exps)
    if not all_exps:
        raise ApiError("no_coverage", "No SPHEREx coverage here yet.", status=404)
    exps = [e for e in all_exps if not detector or e["detector"] == detector.upper()]
    if obs_ids:
        exps = [e for e in exps if e["obsId"] in set(obs_ids)]
    else:
        exps = select_exposures(exps, max_per_pass)
    if not exps:
        raise ApiError("no_coverage", f"No SPHEREx exposures from {detector} here. Try another detector.", status=404)

    size_deg = fov_arcmin / 60.0 * 1.15  # a little margin so reprojection has no empty corners
    items = [(irsa_tap.cutout_url(e["uri"], ra, dec, size_deg), e) for e in exps]
    raws, skipped = spherex_files.fetch_many(items)

    wcs_out, shape = align.target_grid(ra, dec, fov_arcmin)
    frames: list[AlignedFrame] = []
    for ex in raws:
        hide_bits = fl.hide_mask_bits(ex.bits)  # per file: bit numbers can differ between releases
        img = align.reproject_image(ex.image, ex.wcs, wcs_out, shape)
        var = align.reproject_image(ex.variance, ex.wcs, wcs_out, shape)
        fl_out, covered = align.reproject_flags(ex.flags, ex.wcs, wcs_out, shape)
        bad = fl.bad_pixels(fl_out, hide_bits)
        # Wavelength at the target: the cutout is centred on it.
        cy, cx = (np.array(ex.image.shape) - 1) / 2.0
        tx, ty = ex.wcs.world_to_pixel_values(ra, dec)
        lam, bw = spherex_files.wavelength_at(ex, float(tx if np.isfinite(tx) else cx), float(ty if np.isfinite(ty) else cy))
        frames.append(AlignedFrame(meta=ex.meta, image=img, variance=var, flags=fl_out, covered=covered, bad=bad,
                                   bits=ex.bits, version=ex.version, wavelength_um=lam, bandwidth_um=bw))
    if not frames:
        raise ApiError("download_failed", f"{len(skipped)} frames couldn't be downloaded.", status=503, retryable=True)
    return AlignedField(ra=ra, dec=dec, fov_arcmin=fov_arcmin, detector=detector, wcs=wcs_out, shape=shape,
                        frames=frames, skipped=skipped, counts=counts)


def field_key(ra: float, dec: float, fov: float, detector: str | None, extra: object = None) -> str:
    return kv.key("field", kv.round_pos(ra, dec), round(fov, 2), detector, extra, spherex_files.MIN_VERSION)
