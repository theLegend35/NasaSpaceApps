"""Find SPHEREx exposures that cover a position (IRSA TAP, spherex.artifact + spherex.plane).

The query follows the IRSA SPHEREx cutout notebook. Column names to verify on
day 1 against TAP_SCHEMA if IRSA renames anything.
"""
from __future__ import annotations

from ..core import cache as kv
from ..core.http import fnum, tap_query
from ..core.settings import get_settings

PASS_GAP_DAYS = 30.0  # PROPOSAL: exposures more than 30 days apart are different passes


def images_query(ra: float, dec: float) -> str:
    return f"""
SELECT a.uri, p.planeid, p.energy_bandpassname, p.time_bounds_lower, p.time_bounds_upper, p.datarelease
FROM spherex.artifact a
JOIN spherex.plane p ON a.planeid = p.planeid
WHERE 1 = CONTAINS(POINT('ICRS', {ra:.7f}, {dec:.7f}), p.poly)
ORDER BY p.time_bounds_lower
""".strip()


def _detector(bandpass: str | None) -> str | None:
    """'SPHEREx-D3' -> 'D3'."""
    if not bandpass:
        return None
    tail = bandpass.split("-")[-1].strip().upper()
    return tail if tail.startswith("D") else bandpass


def cutout_url(uri: str, ra: float, dec: float, size_deg: float) -> str:
    base = get_settings().irsa_base.rstrip("/")
    path = uri if uri.startswith("http") else f"{base}/{uri.lstrip('/')}"
    # Note the trailing 'd' on the center (design doc Feature 2, verified Nov 13).
    return f"{path}?center={ra:.7f},{dec:.7f}d&size={size_deg:.5f}"


def group_passes(mjds: list[float], gap_days: float = PASS_GAP_DAYS) -> list[int]:
    """Cluster sorted times into passes by gaps; returns a pass index per time."""
    out, p, prev = [], 0, None
    for m in mjds:
        if prev is not None and m - prev > gap_days:
            p += 1
        out.append(p)
        prev = m
    return out


def find_exposures(ra: float, dec: float, detector: str | None = None,
                   start_mjd: float | None = None, end_mjd: float | None = None) -> list[dict]:
    """GET /images. Exposures sorted by time with pass index, detector and URI."""
    pr = kv.round_pos(ra, dec)
    k = kv.key("spherex-images", pr)
    rows = kv.cache().get(k)
    if rows is None:
        rows = tap_query(f"{get_settings().irsa_base}/TAP/sync", images_query(ra, dec),
                         service="IRSA TAP (SPHEREx)")
        kv.cache().set(k, rows, expire=6 * 3600)  # new data arrives; keep this short

    exps = []
    for r in rows:
        mjd = fnum(r.get("time_bounds_lower"))
        if mjd is None or not r.get("uri"):
            continue
        exps.append({
            "obsId": r.get("planeid") or r["uri"].rsplit("/", 1)[-1],
            "uri": r["uri"],
            "detector": _detector(r.get("energy_bandpassname")),
            "mjd": mjd,
            "mjdEnd": fnum(r.get("time_bounds_upper")),
            "release": r.get("datarelease") or None,
        })
    exps.sort(key=lambda e: e["mjd"])
    for e, p in zip(exps, group_passes([e["mjd"] for e in exps])):
        e["pass"] = p
    if detector:
        exps = [e for e in exps if e["detector"] == detector.upper()]
    if start_mjd is not None:
        exps = [e for e in exps if e["mjd"] >= start_mjd]
    if end_mjd is not None:
        exps = [e for e in exps if e["mjd"] <= end_mjd]
    return exps


def counts_by_detector(exps: list[dict]) -> dict[str, int]:
    out: dict[str, int] = {}
    for e in exps:
        out[e["detector"] or "?"] = out.get(e["detector"] or "?", 0) + 1
    return dict(sorted(out.items()))


def coverage_query(ra: float, dec: float, radius_deg: float) -> str:
    return f"""
SELECT obs_id, energy_bandpassname, t_min, s_region
FROM spherex.obscore
WHERE 1 = INTERSECTS(CIRCLE('ICRS', {ra:.6f}, {dec:.6f}, {radius_deg:.5f}), s_region)
""".strip()


def coverage(ra: float, dec: float, radius_deg: float) -> dict:
    """GET /coverage: footprints near the view (ObsCore s_region polygons)."""
    pr = kv.round_pos(ra, dec, 2)
    k = kv.key("spherex-coverage", pr, round(radius_deg, 2))
    hit = kv.cache().get(k)
    if hit is not None:
        return hit
    rows = tap_query(f"{get_settings().irsa_base}/TAP/sync", coverage_query(ra, dec, radius_deg),
                     service="IRSA TAP (SPHEREx coverage)")
    foots, counts = [], {}
    for r in rows:
        det = _detector(r.get("energy_bandpassname")) or "?"
        counts[det] = counts.get(det, 0) + 1
        poly = _parse_polygon(r.get("s_region", ""))
        if poly:
            foots.append({"obsId": r.get("obs_id"), "detector": det, "polygon": poly})
    out = {"counts": dict(sorted(counts.items())), "footprints": foots}
    kv.cache().set(k, out, expire=6 * 3600)
    return out


def _parse_polygon(s: str) -> list[list[float]] | None:
    """'POLYGON ICRS 1 2 3 4 ...' or 'POLYGON 1 2 3 4' -> [[ra, dec], ...]."""
    toks = s.replace("(", " ").replace(")", " ").replace(",", " ").split()
    nums = []
    for t in toks:
        try:
            nums.append(float(t))
        except ValueError:
            continue
    if len(nums) < 6 or len(nums) % 2:
        return None
    return [[nums[i], nums[i + 1]] for i in range(0, len(nums), 2)]
