"""JPL Horizons ephemerides for solar-system targets (asteroids, comets)."""
from __future__ import annotations

from datetime import datetime, timezone

from ..core import cache as kv
from ..core.errors import ApiError


def _query(target_id: str, epochs: dict | list) -> list[dict]:
    from astroquery.jplhorizons import Horizons  # slow import; keep it local

    try:
        # '500' = geocentric. SPHEREx is in low Earth orbit, so the parallax
        # between Earth's centre and SPHEREx matters for close asteroids: to verify.
        eph = Horizons(id=target_id, location="500", epochs=epochs).ephemerides()
    except Exception as e:  # astroquery raises several types here
        raise ApiError("horizons_error", f"JPL Horizons failed: {e}", status=503, retryable=True) from e
    return [
        {"ra": float(r["RA"]), "dec": float(r["DEC"]), "jd": float(r["datetime_jd"]),
         "rateRa": float(r["RA_rate"]), "rateDec": float(r["DEC_rate"])}
        for r in eph
    ]


def position_now(target_id: str) -> dict:
    now = datetime.now(timezone.utc)
    jd = now.timestamp() / 86400.0 + 2440587.5
    k = kv.key("horizons-now", target_id, round(jd, 1))
    hit = kv.cache().get(k)
    if hit:
        return hit
    row = _query(target_id, [jd])[0]
    row["epochIso"] = now.isoformat(timespec="minutes")
    kv.cache().set(k, row, expire=3600)
    return row


def positions_at(target_id: str, mjds: list[float]) -> list[dict]:
    """Positions at each exposure time (never one date for all: design doc §5)."""
    if not mjds:
        return []
    jds = [m + 2400000.5 for m in mjds]
    k = kv.key("horizons-at", target_id, [round(j, 5) for j in jds])
    hit = kv.cache().get(k)
    if hit:
        return hit
    rows: list[dict] = []
    for i in range(0, len(jds), 50):  # Horizons caps the epoch list length
        rows += _query(target_id, jds[i:i + 50])
    kv.cache().set(k, rows, expire=30 * 86400)
    return rows
