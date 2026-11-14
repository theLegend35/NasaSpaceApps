"""AI vision engine step 1: Clean. Rule-based junk filter (the CNN plugs in later).

Rules (all thresholds PROPOSAL, in rules.yaml):
  A flags     - flagged fraction in the PSF footprint >= 0.5
  B one-shot  - seen in one exposure only when others cover it (needs per-exposure
                detections; until then we only report it, never reject on it)
  C too sharp - narrower than the PSF (DAOStarFinder sharpness as the proxy)
  D edges     - within a few pixels of uncovered area; streaks via Canny + Hough
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np
import yaml

from ..core.settings import get_settings

# DAOStarFinder sharpness is ~0.2-1.0 for point sources; values above ~1 mean
# narrower than the PSF (hot pixel, cosmic ray). PROPOSAL: check on real data.
SHARPNESS_MAX = 1.0


@lru_cache
def cfg() -> dict:
    with open(get_settings().config_dir / "rules.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)["clean"]


def near_edge(covered: np.ndarray, x: float, y: float, edge_px: int | None = None) -> bool:
    e = edge_px if edge_px is not None else cfg()["edge_px"]
    h, w = covered.shape
    x0, y0 = int(round(x)), int(round(y))
    ys, xs = slice(max(0, y0 - e), min(h, y0 + e + 1)), slice(max(0, x0 - e), min(w, x0 + e + 1))
    win = covered[ys, xs]
    return win.size == 0 or not bool(win.all()) or x0 < e or y0 < e or x0 >= w - e or y0 >= h - e


def streak_segments(img: np.ndarray, min_len_px: int = 15) -> list[tuple[tuple[int, int], tuple[int, int]]]:
    """Long straight features (satellite trails), same approach as the CSA NEOSSat tutorial."""
    from skimage.feature import canny
    from skimage.transform import probabilistic_hough_line

    f = np.nan_to_num(img - np.nanmedian(img))
    s = np.nanstd(f) or 1.0
    edges = canny(f / s, sigma=1.5, low_threshold=2.0, high_threshold=4.0)
    return probabilistic_hough_line(edges, threshold=10, line_length=min_len_px, line_gap=2)


def _dist_to_segment(px: float, py: float, seg) -> float:
    (x1, y1), (x2, y2) = seg
    vx, vy = x2 - x1, y2 - y1
    L2 = vx * vx + vy * vy or 1.0
    t = max(0.0, min(1.0, ((px - x1) * vx + (py - y1) * vy) / L2))
    return float(np.hypot(px - (x1 + t * vx), py - (y1 + t * vy)))


def judge(src: dict, covered: np.ndarray, streaks: list, p_real: float | None = None) -> dict:
    """Returns {rejected, reason, confidence, detail, pReal}. Reasons match the UI chips."""
    c = cfg()
    ff = src.get("flaggedFraction") or 0.0
    if ff >= c["flagged_fraction_reject"]:
        top = src.get("topFlag") or "flagged"
        return {"rejected": True, "reason": "flags", "confidence": round(ff, 2),
                "detail": f"{ff * 100:.0f}% of its pixels are flagged {top}", "pReal": p_real}
    if src.get("sharpness") is not None and src["sharpness"] > SHARPNESS_MAX:
        return {"rejected": True, "reason": "hot pixel", "confidence": None,
                "detail": f"sharper than the PSF (sharpness {src['sharpness']:.2f})", "pReal": p_real}
    if near_edge(covered, src["x"], src["y"]):
        return {"rejected": True, "reason": "edge", "confidence": None,
                "detail": "within a few pixels of the frame edge", "pReal": p_real}
    for seg in streaks:
        if _dist_to_segment(src["x"], src["y"], seg) < 1.5:
            return {"rejected": True, "reason": "streak", "confidence": None,
                    "detail": "lies on a long straight streak", "pReal": p_real}
    if p_real is not None and p_real < c["cnn_min_p_real"]:
        return {"rejected": True, "reason": "model", "confidence": round(1 - p_real, 2),
                "detail": f"real/bogus model gives {p_real:.2f} real", "pReal": p_real}
    return {"rejected": False, "reason": None, "confidence": None, "detail": None, "pReal": p_real}
