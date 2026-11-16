"""FastAPI routes for SPHEREx point lookups and cached cutout previews."""
from contextlib import asynccontextmanager
from io import BytesIO
import logging
import threading
import uuid

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image, ImageOps
from pydantic import BaseModel

from .cache import (
    get_known_targets,
    get_preview,
    lookup_cache_key,
    read_cached_lookup,
    seed_known_targets,
)
from .catalogs import catalogs, resolve_name
from .explain import explain
from .horizons import path, predict
from .nets import classify_measurements, ensure_trained
from .seed import load_seed
from .service import lookup

logger = logging.getLogger(__name__)
jobs: dict[str, dict[str, object]] = {}
jobs_lock = threading.Lock()


@asynccontextmanager
async def lifespan(_app):
    ensure_trained()
    seed_known_targets()
    loaded = load_seed()
    if any(loaded.values()):
        logger.info("Loaded cache seed into Redis: %s", loaded)
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST"])


class ClassifyBody(BaseModel):
    measurements: list[dict]


class ExplainBody(BaseModel):
    facts: dict


@app.post("/explain")
def explain(body: ExplainBody):
    """Ask Gemini to put this target's measurements into plain words. The key stays in the server environment."""
    import json
    import os

    import requests

    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="No language model key is set on this server")
    model = os.getenv("GEMINI_MODEL", "gemini-flash-latest")
    prompt = (
        "You explain infrared sky measurements from NASA's SPHEREx telescope to a curious visitor. "
        "Use only the facts in the JSON below. Add no objects, numbers or discoveries that are missing from it. "
        "The two network reads are candidates from small networks trained on synthetic examples, so say that plainly. "
        "Write three short sentences in plain words.\n\n" + json.dumps(body.facts)[:6000]
    )
    try:
        response = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            headers={"x-goog-api-key": key},
            json={"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"temperature": 0.2}},
            timeout=30,
        )
        response.raise_for_status()
        text = response.json()["candidates"][0]["content"]["parts"][0]["text"]
    except Exception as error:
        logger.warning("Gemini summary failed: %s", type(error).__name__)
        raise HTTPException(status_code=502, detail="The language model did not answer") from None
    return {"text": text.strip(), "model": model}


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/targets")
def targets():
    return get_known_targets()


@app.get("/resolve")
def resolve(name: str):
    try:
        found = resolve_name(name)
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Name lookup failed: {error}") from error
    if found is None:
        raise HTTPException(status_code=404, detail=f"No sky position for {name}")
    return found


@app.get("/horizons/path")
def horizons_path(command: str, start: str, days: int = 30):
    try:
        return path(command, start, days)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Horizons lookup failed: {error}") from error


@app.get("/horizons")
def horizons(name: str, when: str):
    try:
        return predict(name, when)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Horizons lookup failed: {error}") from error


@app.get("/catalogs")
def catalog_search(ra: float, dec: float, radius: float = 0.05):
    return catalogs(ra, dec, radius)


@app.post("/classify")
def classify(body: ClassifyBody):
    previews = {}
    for item in body.measurements:
        url = item.get("cutout_url")
        if not url or url in previews:
            continue
        preview = get_preview(url)
        if preview:
            previews[url] = preview
    return classify_measurements(body.measurements, previews)


class ExplainBody(BaseModel):
    facts: dict


@app.post("/explain")
def explain_target(body: ExplainBody):
    try:
        return {"text": explain(body.facts)}
    except LookupError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except Exception as error:
        logger.warning("AI summary failed: %s", type(error).__name__)
        raise HTTPException(status_code=502, detail="The AI service did not answer.") from error


def run_lookup_job(job_id: str, ra: float, dec: float, size: float, detector: int | None):
    def update_progress(completed: int, total: int):
        with jobs_lock:
            job = jobs.get(job_id)
            if job:
                job.update(status="measuring", completed=completed, total=total)

    try:
        with jobs_lock:
            jobs[job_id]["status"] = "searching"
        result = lookup(ra, dec, size, detector, update_progress)
        with jobs_lock:
            jobs[job_id].update(status="completed", result=result, cache_hit=bool(result.get("cache_hit")))
    except Exception as error:
        logger.exception("Lookup job %s failed", job_id)
        with jobs_lock:
            jobs[job_id].update(status="failed", error=str(error))


@app.post("/point/jobs", status_code=202)
def start_point_job(
    background_tasks: BackgroundTasks,
    ra: float,
    dec: float,
    size: float = 0.1,
    detector: int | None = None,
):
    job_id = uuid.uuid4().hex
    cached = read_cached_lookup(lookup_cache_key(ra, dec, size, detector))
    if cached is not None:
        cached["cache_hit"] = True
    with jobs_lock:
        jobs[job_id] = {
            "status": "completed" if cached is not None else "queued",
            "completed": int(cached.get("images_found", 0)) if cached else 0,
            "total": int(cached.get("images_found", 0)) if cached else None,
            "result": cached,
            "error": None,
            "cache_hit": cached is not None,
        }
    if cached is None:
        background_tasks.add_task(run_lookup_job, job_id, ra, dec, size, detector)
    return {"job_id": job_id}


@app.get("/point/jobs/{job_id}")
def point_job_status(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Lookup job not found")
        return dict(job)


@app.get("/point/cache")
def point_cache(ra: float, dec: float, size: float = 0.1, detector: int | None = None):
    cached = read_cached_lookup(lookup_cache_key(ra, dec, size, detector))
    if cached is None:
        raise HTTPException(status_code=404, detail="No cached lookup for this point")
    cached["cache_hit"] = True
    return cached


@app.get("/point/image")
def point_image(cutout_url: str, false_color: bool = False):
    preview = get_preview(cutout_url)
    if preview is None:
        raise HTTPException(status_code=404, detail="Cutout preview is not available")

    if false_color:
        grayscale = Image.open(BytesIO(preview)).convert("L")
        colorized = ImageOps.colorize(
            grayscale,
            black="#101a32",
            mid="#bb5a55",
            white="#f3d9a0",
            midpoint=144,
        )
        output = BytesIO()
        colorized.save(output, format="PNG", optimize=True)
        preview = output.getvalue()

    return Response(preview, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


@app.get("/point")
def point(ra: float, dec: float, size: float = 0.1, detector: int | None = None):
    return lookup(ra, dec, size, detector)