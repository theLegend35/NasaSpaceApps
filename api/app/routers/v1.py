"""REST API /api/v1 (design doc §6). Routes are sync so FastAPI runs them in a thread pool."""
from __future__ import annotations

import json
import re
from typing import Literal

import httpx
from fastapi import APIRouter, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ..core import cache as kv
from ..core import demo
from ..core.errors import ApiError
from ..core.settings import get_settings
from ..services import cutouts as cut
from ..services import irsa_tap, render, rules, spectrum as spec, targets, tutor
from ..services import sources as src

router = APIRouter(prefix="/api/v1")
_NAME = re.compile(r"^[0-9a-f]{40}\.(png|gif)$")


def _demo_or(endpoint: str, params: dict, fn):
    hit = demo.lookup(endpoint, params)
    return hit if hit is not None else fn()


@router.get("/health")
def health():
    return {"ok": True, "version": get_settings().version}


@router.get("/resolve")
def resolve(q: str = Query(..., min_length=1, max_length=120)):
    return targets.resolve(q)


@router.get("/targets")
def target_list():
    return _demo_or("/targets", {}, lambda: {"targets": targets.target_list()})


@router.get("/coverage")
def coverage(ra: float, dec: float, radius: float = Query(0.5, gt=0, le=5)):
    return irsa_tap.coverage(ra, dec, radius)


@router.get("/images")
def images(ra: float, dec: float, detector: str | None = None, start: float | None = None, end: float | None = None):
    exps = irsa_tap.find_exposures(ra, dec, detector, start, end)
    return {"exposures": [{k: e[k] for k in ("obsId", "detector", "mjd", "pass", "uri")} for e in exps],
            "counts": irsa_tap.counts_by_detector(irsa_tap.find_exposures(ra, dec))}


@router.get("/cutouts")
def cutouts(ra: float, dec: float, fov: float = 12.0, detector: str | None = "D1",
            mode: Literal["single", "coadd", "rgb"] = "single", diff: Literal["none", "first", "median"] = "none",
            stack: bool = False, baseline: Literal["none", "allwise"] = "none", mask: bool = False,
            obsIds: str | None = None):
    ids = [x for x in obsIds.split(",") if x] if obsIds else None
    params = dict(ra=ra, dec=dec, fov=fov, detector=detector, mode=mode, diff=diff, stack=stack,
                  baseline=baseline, mask=mask, obsIds=",".join(ids or []))
    return _demo_or("/cutouts", params, lambda: cut.cutouts(ra, dec, fov, detector, mode, diff, stack, baseline, mask, ids))


@router.get("/baseline")
def baseline(ra: float, dec: float, fov: float = 12.0, band: int = Query(2, ge=1, le=2)):
    from ..services.align import target_grid
    from ..services.field import AlignedField
    w, shape = target_grid(ra, dec, fov)
    fld = AlignedField(ra=ra, dec=dec, fov_arcmin=fov, detector=None, wcs=w, shape=shape, frames=[], skipped=[])
    fr = cut._deep_time_frame(fld, band)
    if fr is None:
        raise ApiError("no_allwise", "No AllWISE Atlas image covers this spot.", status=404)
    return fr


class Hint(BaseModel):
    ra: float
    dec: float
    pmRa: float
    pmDec: float
    epoch: float = 2000.0


@router.get("/sources")
def sources(ra: float, dec: float, fov: float = 12.0, detector: str | None = "D1",
            hintRa: float | None = None, hintDec: float | None = None, hintPmRa: float | None = None,
            hintPmDec: float | None = None, hintEpoch: float | None = None):
    hint = None
    if None not in (hintRa, hintDec, hintPmRa, hintPmDec):
        hint = {"ra": hintRa, "dec": hintDec, "pmRa": hintPmRa, "pmDec": hintPmDec, "epoch": hintEpoch or 2000.0}
    params = dict(ra=ra, dec=dec, fov=fov, detector=detector, **{f"h{k}": v for k, v in (hint or {}).items()})
    return _demo_or("/sources", params, lambda: src.sources(ra, dec, fov, detector, hint))


@router.get("/spectrum")
def spectrum(ra: float, dec: float, pmRa: float | None = None, pmDec: float | None = None,
             epoch: float | None = None, window: Literal["survey", "all"] = "survey", horizonsId: str | None = None):
    params = dict(ra=ra, dec=dec, pmRa=pmRa, pmDec=pmDec, epoch=epoch, window=window, horizonsId=horizonsId)
    return _demo_or("/spectrum", params, lambda: spec.spectrum(ra, dec, pmRa, pmDec, epoch, window, horizonsId))


@router.get("/classify")
def classify(ra: float, dec: float, fov: float = 12.0, detector: str | None = "D1", sourceId: str | None = None,
             withSpectrum: bool = True, pmRa: float | None = None, pmDec: float | None = None, epoch: float | None = None):
    """Rule scores for one source. Spectral indices are added when the spectrum is measured."""
    params = dict(ra=ra, dec=dec, fov=fov, detector=detector, sourceId=sourceId, withSpectrum=withSpectrum)

    def run():
        field_src = src.sources(ra, dec, fov, detector)["sources"]
        pick = next((s for s in field_src if s["id"] == sourceId), None) if sourceId else None
        if pick is None:
            raise ApiError("source_not_found", "That source isn't in this field. Open Sources and pick one.", status=404)
        feats = dict(pick["features"], gaia=({} if pick["gaiaStatus"] == "dark" else pick["gaia"]
                                             if pick["gaiaStatus"] == "match" else None))
        spectrum_used = None
        if withSpectrum:
            try:
                sp = spec.spectrum(pick["ra"], pick["dec"], pmRa, pmDec, epoch)
                feats["ch4_index"] = sp["indices"].get("ch4_index")
                feats["water_index_mean"] = sp["indices"].get("water_index_mean")
                spectrum_used = sp["summary"]
            except ApiError as e:
                spectrum_used = {"error": e.message}
        res = rules.classify(feats)
        return {**res, "source": pick, "features": {k: v for k, v in feats.items() if k != "gaia"},
                "spectrum": spectrum_used, "model": None, "modelNote": "Neural classifier not shipped: rules decide."}

    return _demo_or("/classify", params, run)


@router.get("/candidates")
def candidates(ra: float, dec: float, radius: float = 5.0, cls: str | None = None, minPm: float | None = None):
    s = get_settings()
    if not (s.supabase_url and s.supabase_service_key):
        return {"candidates": [], "note": "Candidate store not connected."}
    # Bounding box in SQL; the true angular cut happens in the client (design doc Feature 10).
    params = [("select", "id,ra,dec,top_class,score,parts,status"),
              ("dec", f"gte.{dec - radius}"), ("dec", f"lte.{dec + radius}")]
    if cls:
        params.append(("top_class", f"eq.{cls}"))
    if minPm is not None:
        params.append(("pm_arcsec_yr", f"gte.{minPm}"))
    r = httpx.get(f"{s.supabase_url}/rest/v1/candidates", params=params, timeout=15,
                  headers={"apikey": s.supabase_service_key, "Authorization": f"Bearer {s.supabase_service_key}"})
    r.raise_for_status()
    return {"candidates": r.json()}


class TutorIn(BaseModel):
    question: str = Field(..., min_length=1, max_length=500)
    level: Literal["student", "volunteer", "astronomer"] = "student"
    # The panel sends what it already fetched; the API never takes free-text facts.
    targetQuery: str | None = None
    ra: float | None = None
    dec: float | None = None
    fov: float = 12.0
    detector: str | None = "D1"
    sourceId: str | None = None


@router.post("/tutor")
def ask_tutor(body: TutorIn):
    obj: dict = {}
    if body.targetQuery:
        try:
            obj["simbad"] = targets.resolve(body.targetQuery).get("simbad")
        except ApiError:
            pass
    if body.sourceId and body.ra is not None and body.dec is not None:
        res = src.sources(body.ra, body.dec, body.fov, body.detector)
        obj["source"] = next((s for s in res["sources"] if s["id"] == body.sourceId), None)
        if obj["source"]:
            feats = dict(obj["source"]["features"], gaia={} if obj["source"]["gaiaStatus"] == "dark" else obj["source"]["gaia"])
            obj["classify"] = rules.classify(feats)
    try:
        return tutor.ask(obj, body.question, body.level)
    except ApiError as e:
        if e.code in ("tutor_offline", "tutor_timeout", "tutor_error"):
            # Show the fact list without prose (design doc edge case).
            return {"answer": None, "facts": tutor.fact_sheet(obj), "citations": [], "droppedSentences": 0,
                    "model": None, "offline": e.message}
        raise


@router.get("/releases")
def releases():
    p = get_settings().cache_dir / "releases.json"
    if not p.exists():
        return {"collections": [], "latestMjd": None, "checkedAt": None, "note": "Release check hasn't run yet."}
    return json.loads(p.read_text(encoding="utf-8"))


class GifIn(BaseModel):
    ra: float
    dec: float
    fov: float = 12.0
    detector: str | None = "D1"
    mode: Literal["single", "coadd"] = "single"
    diff: Literal["none", "first", "median"] = "none"
    baseline: Literal["none", "allwise"] = "none"
    fps: float = Field(2.0, ge=0.25, le=4)


@router.post("/export/gif")
def export_gif(v: GifIn):
    res = cut.cutouts(v.ra, v.dec, v.fov, v.detector, v.mode, v.diff, False, v.baseline, False, None)
    pngs, caps = [], []
    for fr in res["frames"]:
        name = fr["pngUrl"].rsplit("/", 1)[-1]
        p = demo.file_path(name)
        if p is None:
            continue
        pngs.append(p.read_bytes())
        caps.append(f"{fr['dateIso'][:10]}  {fr['detector']}")
    if not pngs:
        raise ApiError("no_frames", "No frames to export.", status=404)
    data = render.gif(pngs, caps, v.fps)
    name = kv.key("gif", v.model_dump()) + ".gif"
    (kv.files_dir() / name).write_bytes(data)
    return {"gifUrl": kv.file_url(name)}


@router.get("/files/{name}")
def files(name: str):
    if not _NAME.match(name):
        raise ApiError("bad_name", "Unknown file.", status=404)
    p = demo.file_path(name)
    if p is None:
        raise ApiError("not_found", "That file has expired from the cache. Reload the view.", status=404)
    media = "image/gif" if name.endswith(".gif") else "image/png"
    return FileResponse(p, media_type=media, headers={"Cache-Control": "public, max-age=86400"})
