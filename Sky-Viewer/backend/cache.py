import hashlib
import json
import logging
import math
import os
import threading

import redis
from redis.exceptions import RedisError

logger = logging.getLogger(__name__)
lookup_cache_ttl = 24 * 60 * 60
preview_cache_ttl = 30 * 24 * 60 * 60
max_cached_previews = 512
redis_client = redis.Redis.from_url(
    os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0"),
    decode_responses=False,
    socket_connect_timeout=1,
    socket_timeout=1,
)
image_previews: dict[str, bytes] = {}
preview_lock = threading.Lock()
known_targets = [
    {
        "id": "wise-0855",
        "name": "WISE 0855",
        "description": "Cold brown dwarf",
        "ra": 133.79513,
        "dec": -7.24515,
    },
    {
        "id": "barnards-star",
        "name": "Barnard's Star",
        "description": "High proper-motion red dwarf",
        "ra": 269.44649,
        "dec": 4.76533,
        "epoch": 2025.0,
    },
    {
        "id": "epsilon-indi-b",
        "name": "Epsilon Indi B",
        "description": "Nearby brown dwarf pair",
        "ra": 331.09465,
        "dec": -56.79996,
        "epoch": 2025.0,
    },
    {
        "id": "rw-aurigae",
        "name": "RW Aurigae",
        "description": "Young variable star",
        "ra": 76.95658,
        "dec": 30.40130,
        "epoch": 2025.0,
    },
    {
        "id": "r-draconis",
        "name": "R Draconis",
        "description": "Long-period variable star",
        "ra": 248.16725,
        "dec": 66.75502,
        "epoch": 2025.0,
    },
]


def seed_known_targets():
    try:
        for target in known_targets:
            redis_client.set(f"spherex:target:{target['id']}", json.dumps(target), nx=True)
            redis_client.sadd("spherex:known_targets", target["id"])
    except RedisError as error:
        logger.warning("Redis unavailable while seeding known targets: %s", error)


def get_known_targets():
    try:
        target_ids = redis_client.smembers("spherex:known_targets")
        targets = []
        for target_id in target_ids:
            target_json = redis_client.get(f"spherex:target:{target_id.decode('utf-8')}")
            if target_json:
                targets.append(json.loads(target_json))
        if targets:
            return sorted(targets, key=lambda target: target["name"])
    except (RedisError, json.JSONDecodeError, UnicodeDecodeError) as error:
        logger.warning("Could not read Redis known targets: %s", error)
    return known_targets


def lookup_cache_key(ra: float, dec: float, size: float, detector: int | None) -> str:
    parameters = json.dumps(
        {"ra": round(ra, 6), "dec": round(dec, 6), "size": round(size, 6), "detector": detector},
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(parameters.encode("ascii")).hexdigest()
    return f"spherex:lookup:v1:{digest}"


def json_safe(value):
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    return value


def read_cached_lookup(key: str):
    try:
        value = redis_client.get(key)
        return json_safe(json.loads(value)) if value else None
    except (RedisError, json.JSONDecodeError, UnicodeDecodeError) as error:
        logger.warning("Could not read Redis lookup cache: %s", error)
        return None


def write_cached_lookup(key: str, result: dict):
    try:
        redis_client.set(key, json.dumps(json_safe(result), allow_nan=False), ex=lookup_cache_ttl)
    except (RedisError, TypeError, ValueError) as error:
        logger.warning("Could not write Redis lookup cache: %s", error)


def preview_cache_key(cutout_url: str) -> str:
    digest = hashlib.sha256(cutout_url.encode("utf-8")).hexdigest()
    return f"spherex:preview:{digest}"


def store_previews(previews: dict[str, bytes]):
    with preview_lock:
        image_previews.update(previews)
        while len(image_previews) > max_cached_previews:
            image_previews.pop(next(iter(image_previews)))
    try:
        if previews:
            pipe = redis_client.pipeline(transaction=False)
            for cutout_url, preview in previews.items():
                pipe.set(preview_cache_key(cutout_url), preview, ex=preview_cache_ttl)
            pipe.execute()
    except RedisError as error:
        logger.warning("Could not write Redis preview cache: %s", error)


def get_preview(cutout_url: str):
    with preview_lock:
        preview = image_previews.get(cutout_url)
    if preview is None:
        try:
            preview = redis_client.get(preview_cache_key(cutout_url))
        except RedisError as error:
            logger.warning("Could not read Redis preview cache: %s", error)
    return preview