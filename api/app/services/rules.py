"""AI vision engine step 3: transparent rule scores (design doc Feature 8).

score(class) = sum(w_i * v_i), v_i = ramp(x_i, a, b). Missing inputs score 0 and
are reported as 'not measured' - never guessed.
"""
from __future__ import annotations

from functools import lru_cache

import yaml

from ..core.settings import get_settings


@lru_cache
def config() -> dict:
    with open(get_settings().config_dir / "rules.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)


def ramp(x: float, a: float, b: float) -> float:
    """0 at a, 1 at b, linear between, clamped. Works for a > b (falling ramp)."""
    if a == b:
        return 1.0 if x >= b else 0.0
    t = (x - a) / (b - a)
    return max(0.0, min(1.0, t))


def derived(features: dict) -> dict:
    """Add helper values the YAML refers to (gaia_dark_value, gaia_text, ...)."""
    f = dict(features)
    g = f.get("gaia")  # None = not queried, {} = no match, dict = match
    if g is None:
        f["gaia_dark_value"] = f["gaia_seen_value"] = None
        f["gaia_text"] = "not measured"
    elif not g:
        f["gaia_dark_value"], f["gaia_seen_value"], f["gaia_text"] = 1.0, 0.0, "no source within 2″"
    else:
        gmag = g.get("g")
        faint = gmag is not None and gmag >= 19
        f["gaia_dark_value"] = 0.5 if faint else 0.0
        f["gaia_seen_value"] = 1.0
        f["gaia_text"] = f"G = {gmag:.2f}" if gmag is not None else "matched"
    if f.get("known_ss") is None:
        f["known_ss_value"], f["known_ss_text"] = None, "not checked"
    else:
        f["known_ss_value"] = 1.0 if f["known_ss"] else 0.0
        f["known_ss_text"] = f["known_ss"] or "none"
    ff = f.get("flagged_fraction")
    f["flagged_pct"] = ff * 100 if ff is not None else None
    if f.get("single_exposure") is not None:
        f["single_exposure_value"] = 1.0 if f["single_exposure"] else 0.0
    return f


def score_class(spec: dict, f: dict, sig_min: float) -> dict:
    total, parts, missing = 0.0, [], []
    for inp in spec["inputs"]:
        x = f.get(inp["feature"])
        if inp.get("requires_significance") and x is not None:
            sig = f.get("pm_significance")
            if sig is None or sig < sig_min:
                parts.append({"name": inp["name"], "weight": inp["weight"], "value": 0.0, "points": 0.0,
                              "text": f"motion not significant ({sig:.1f}σ)" if sig is not None else "motion not measured"})
                continue
        if x is None:
            missing.append(inp["name"])
            parts.append({"name": inp["name"], "weight": inp["weight"], "value": None, "points": 0.0, "text": "not measured"})
            continue
        v = ramp(float(x), *inp["ramp"])
        pts = inp["weight"] * v
        total += pts
        try:
            text = inp.get("explain", "").format(**f)
        except (KeyError, ValueError, TypeError):
            text = inp["name"]
        parts.append({"name": inp["name"], "weight": inp["weight"], "value": round(v, 3), "points": round(pts, 1), "text": text})
    return {"score": round(total, 1), "parts": parts, "missing": missing}


def classify(features: dict) -> dict:
    cfg = config()
    th = cfg["thresholds"]
    f = derived(features)
    scores = {name: {"label": spec["label"], **score_class(spec, f, th["motion_significance_min"])}
              for name, spec in cfg["classes"].items()}
    ranked = sorted(scores.items(), key=lambda kv: kv[1]["score"], reverse=True)

    # Gates first: a Horizons/MOST match decides the solar-system classes.
    if f.get("known_ss"):
        top = "asteroid"
    elif scores["artifact"]["score"] >= th["artifact_wins"]:
        top = "artifact"
    else:
        top = ranked[0][0]
    top_score = scores[top]["score"]
    second = next((s["score"] for n, s in ranked if n != top), 0.0)
    uncertain = top_score < th["possible"] or (top_score - second) < th["uncertain_margin"]
    level = "likely" if top_score >= th["likely"] else "possible" if top_score >= th["possible"] else "unlikely"
    return {
        "decision": {"class": top, "label": scores[top]["label"], "score": top_score, "level": level,
                     "uncertain": uncertain, "wording": f"{scores[top]['label']}, {level} candidate"},
        "scores": [{"class": n, **s} for n, s in ranked],
        "rulesVersion": "PROPOSAL",
    }
