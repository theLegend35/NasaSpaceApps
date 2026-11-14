"""Disk cache. Keys always include position, FOV and file version so a new
data release never serves stale frames (design doc §3)."""
from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import diskcache

from .settings import get_settings


@lru_cache
def cache() -> diskcache.Cache:
    return diskcache.Cache(str(get_settings().cache_dir / "kv"), size_limit=4 * 2**30)


def key(*parts: Any) -> str:
    raw = json.dumps(parts, sort_keys=True, default=str)
    return hashlib.sha1(raw.encode()).hexdigest()


def round_pos(ra: float, dec: float, places: int = 4) -> tuple[float, float]:
    """Round a position for cache keys (4 places is ~0.36 arcsec)."""
    return round(ra % 360.0, places), round(dec, places)


def files_dir() -> Path:
    d = get_settings().cache_dir / "files"
    d.mkdir(parents=True, exist_ok=True)
    return d


def file_url(name: str) -> str:
    return f"{get_settings().public_base_url}/api/v1/files/{name}"
