"""Demo pack: real results saved by scripts/precache.py for every test target.

Served instantly and labelled 'cached <date>', so the demo never depends on IRSA
being up. Only real run output goes in here; the pack is never hand-edited.
"""
from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

from . import cache as kv
from .settings import get_settings

BASE_TOKEN = "{{BASE}}"


def _dir() -> Path:
    d = get_settings().demo_pack_dir
    (d / "files").mkdir(parents=True, exist_ok=True)
    return d


def canonical(endpoint: str, params: dict) -> str:
    clean = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in params.items() if v not in (None, "", [])}
    return kv.key(endpoint, clean)


@lru_cache
def manifest() -> dict:
    p = _dir() / "manifest.json"
    if not p.exists():
        return {"createdIso": None, "entries": {}}
    return json.loads(p.read_text(encoding="utf-8"))


def lookup(endpoint: str, params: dict) -> dict | None:
    m = manifest()
    entry = m["entries"].get(canonical(endpoint, params))
    if not entry:
        return None
    raw = (_dir() / entry["file"]).read_text(encoding="utf-8")
    data = json.loads(raw.replace(BASE_TOKEN, get_settings().public_base_url))
    data["cached"] = {"date": m.get("createdIso"), "source": "demo pack"}
    return data


def save(endpoint: str, params: dict, payload: dict) -> None:
    """Copy referenced PNGs into the pack and store the payload with portable URLs."""
    d = _dir()
    base = get_settings().public_base_url
    text = json.dumps(payload)
    for name in set(re.findall(r"/api/v1/files/([0-9a-f]{40}\.(?:png|gif))", text)):
        src = kv.files_dir() / name
        if src.exists():
            shutil.copy2(src, d / "files" / name)
    text = text.replace(base, BASE_TOKEN)
    key = canonical(endpoint, params)
    fname = f"{endpoint.strip('/').replace('/', '_')}-{key[:12]}.json"
    (d / fname).write_text(text, encoding="utf-8")
    p = d / "manifest.json"
    m = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"entries": {}}
    m["createdIso"] = datetime.now(timezone.utc).isoformat(timespec="minutes")
    m["entries"][key] = {"endpoint": endpoint, "params": params, "file": fname}
    p.write_text(json.dumps(m, indent=1), encoding="utf-8")
    manifest.cache_clear()


def file_path(name: str) -> Path | None:
    for d in (kv.files_dir(), _dir() / "files"):
        p = d / name
        if p.exists():
            return p
    return None
