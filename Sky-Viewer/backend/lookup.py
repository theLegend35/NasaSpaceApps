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

from .cache import (
    get_known_targets,
    get_preview,
    lookup_cache_key,
    read_cached_lookup,
    seed_known_targets,
)
from .service import lookup

logger = logging.getLogger(__name__)
jobs: dict[str, dict[str, object]] = {}
jobs_lock = threading.Lock()


@asynccontextmanager
async def lifespan(_app):
    seed_known_targets()
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST"])


@app.get("/targets")
def targets():
    return get_known_targets()


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