"""The brief's test targets (config/targets.yaml) plus name/coordinate resolution."""
from __future__ import annotations

from datetime import datetime, timezone
from functools import lru_cache

import yaml

from ..core.errors import ApiError
from ..core.settings import get_settings
from . import simbad
from .coords import mjd_to_jyear, parse_coords, propagate_linear


@lru_cache
def load_targets() -> list[dict]:
    with open(get_settings().config_dir / "targets.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)["targets"]


def find_target(q: str) -> dict | None:
    ql = q.strip().lower()
    for t in load_targets():
        if ql == t["id"] or ql == t["name"].lower() or ql in t.get("aliases", []):
            return t
    return None


def now_jyear() -> float:
    now = datetime.now(timezone.utc)
    mjd = now.timestamp() / 86400.0 + 40587.0
    return mjd_to_jyear(mjd)


def _with_pm(info: dict, t: dict | None) -> dict:
    """Fill proper motion from targets.yaml if SIMBAD didn't give one."""
    if t and t.get("pm_mas_yr") and info.get("pmRa") is None:
        info["pmRa"] = t["pm_mas_yr"]["ra"]
        info["pmDec"] = t["pm_mas_yr"]["dec"]
    return info


def resolve(q: str) -> dict:
    """GET /resolve: coordinates are parsed; names go to SIMBAD.

    Returns {pos: {ra, dec}, posNow?: {ra, dec, epoch}, name, source, target?, simbad?}
    """
    pos = parse_coords(q)
    if pos:
        return {"pos": {"ra": pos[0], "dec": pos[1]}, "name": None, "source": "coordinates"}

    t = find_target(q)
    if t and t.get("solar_system"):
        from . import horizons
        eph = horizons.position_now(t["horizons_id"])
        return {"pos": {"ra": eph["ra"], "dec": eph["dec"]}, "name": t["name"], "source": "JPL Horizons",
                "target": t["id"], "epochIso": eph["epochIso"]}

    info = simbad.lookup(t["simbad"] if t else q)
    if info is None:
        raise ApiError("not_found", "Couldn't find that name. Try RA/Dec, like 133.795 -7.2451 or 08h55m10.8s -07d14m42s.",
                       status=404)
    info = _with_pm(info, t)
    out = {"pos": {"ra": info["ra"], "dec": info["dec"]}, "name": info["name"], "source": "SIMBAD",
           "simbad": info, "target": t["id"] if t else None}
    if info.get("pmRa") is not None and info.get("pmDec") is not None:
        ep = now_jyear()
        ra, dec = propagate_linear(info["ra"], info["dec"], info["pmRa"], info["pmDec"], info["epoch"], ep)
        out["posNow"] = {"ra": ra, "dec": dec, "epoch": round(ep, 3)}
        # Fast movers: fly to where it is now, not where it was in 2000.
        out["pos"] = {"ra": ra, "dec": dec}
    return out


def target_list() -> list[dict]:
    """GET /targets: the brief's targets with live-resolved positions (cached)."""
    out = []
    for t in load_targets():
        item = {k: t.get(k) for k in ("id", "name", "kind", "expected_class", "fast_mover", "detector")}
        try:
            r = resolve(t["name"])
            item.update(pos=r["pos"], source=r["source"], simbad=r.get("simbad"))
        except ApiError as e:
            item.update(pos=None, error=e.message)
        out.append(item)
    return out
