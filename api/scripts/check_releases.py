"""Nightly cron: list SPHEREx collections and the latest observation time.

If something is new, record it and clear the cached exposure lists so the next
request picks up the new data. On failure, keep the last good state.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from app.core import cache as kv
from app.core.http import fnum, tap_query
from app.core.settings import get_settings

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("releases")


def main() -> None:
    s = get_settings()
    p = s.cache_dir / "releases.json"
    prev = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    try:
        rows = tap_query(f"{s.irsa_base}/TAP/sync",
                         "SELECT obs_collection, MAX(t_min) AS latest FROM spherex.obscore GROUP BY obs_collection",
                         service="IRSA TAP (releases)")
    except Exception as e:  # noqa: BLE001
        log.error("release check failed, keeping last good state: %s", e)
        return
    cols = [{"collection": r["obs_collection"], "latestMjd": fnum(r["latest"])} for r in rows]
    latest = max((c["latestMjd"] for c in cols if c["latestMjd"]), default=None)
    out = {"collections": cols, "latestMjd": latest, "checkedAt": datetime.now(timezone.utc).isoformat(timespec="minutes"),
           "isNew": bool(prev) and latest != prev.get("latestMjd")}
    if out["isNew"]:
        n = 0
        for k in list(kv.cache().iterkeys()):
            kv.cache().delete(k)
            n += 1
        log.info("new SPHEREx data (latest MJD %s); cleared %d cache entries", latest, n)
    p.write_text(json.dumps(out, indent=1), encoding="utf-8")
    log.info("checked: %s", out)


if __name__ == "__main__":
    main()
