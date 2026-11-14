"""Build the demo pack: run the real pipeline for every test target and save the results.

    cd api && .venv/Scripts/python -m scripts.precache            # all targets
    cd api && .venv/Scripts/python -m scripts.precache wise0855   # one target

Writes demo_pack/manifest.json plus one JSON per request and the PNGs it uses.
Every number in the pack comes from this run. Never hand-edit the output.
"""
from __future__ import annotations

import logging
import sys
import time

from app.core import demo
from app.core.errors import ApiError
from app.services import cutouts as cut
from app.services import sources as src
from app.services import spectrum as spec
from app.services import targets

log = logging.getLogger("precache")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

FOV = 12.0


def run(t: dict) -> None:
    r = targets.resolve(t["name"])
    ra, dec = r["pos"]["ra"], r["pos"]["dec"]
    det = t.get("detector") or "D1"
    log.info("%s at %.5f %.5f (%s), detector %s", t["name"], ra, dec, r["source"], det)

    combos = [dict(mode="single", diff="none", baseline="none"),
              dict(mode="coadd", diff="none", baseline="none"),
              dict(mode="coadd", diff="median", baseline="none")]
    if t.get("fast_mover"):
        combos.append(dict(mode="coadd", diff="none", baseline="allwise"))
    for c in combos:
        params = dict(ra=ra, dec=dec, fov=FOV, detector=det, mode=c["mode"], diff=c["diff"], stack=False,
                      baseline=c["baseline"], mask=False, obsIds="")
        t0 = time.time()
        payload = cut.cutouts(ra, dec, FOV, det, c["mode"], c["diff"], False, c["baseline"], False, None)
        demo.save("/cutouts", params, payload)
        log.info("  cutouts %s: %d frames, %d skipped (%.0fs)", c, len(payload["frames"]), len(payload["skipped"]), time.time() - t0)

    sb = r.get("simbad") or {}
    hint = None
    if sb.get("pmRa") is not None:
        hint = {"ra": sb["ra"], "dec": sb["dec"], "pmRa": sb["pmRa"], "pmDec": sb["pmDec"], "epoch": sb.get("epoch", 2000.0)}
    s = src.sources(ra, dec, FOV, det, hint)
    demo.save("/sources", dict(ra=ra, dec=dec, fov=FOV, detector=det, **{f"h{k}": v for k, v in (hint or {}).items()}), s)
    log.info("  sources: %d (top: %s)", len(s["sources"]), s["sources"][0]["id"] if s["sources"] else "-")

    if not t.get("solar_system"):
        sp = spec.spectrum(ra, dec, sb.get("pmRa"), sb.get("pmDec"), 2000.0 if sb.get("pmRa") is not None else None)
        demo.save("/spectrum", dict(ra=ra, dec=dec, pmRa=sb.get("pmRa"), pmDec=sb.get("pmDec"),
                                    epoch=2000.0 if sb.get("pmRa") is not None else None, window="survey", horizonsId=None), sp)
        log.info("  spectrum: %s", sp["summary"])


def main(ids: list[str]) -> None:
    demo.save("/targets", {}, {"targets": targets.target_list()})
    for t in targets.load_targets():
        if ids and t["id"] not in ids:
            continue
        try:
            run(t)
        except ApiError as e:
            log.error("%s failed: %s", t["name"], e.message)


if __name__ == "__main__":
    main(sys.argv[1:])
