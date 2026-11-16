"""Share the Redis cache through the repo.

Export what is in Redis to plain files:

    python -m backend.seed export

Those files live in ``cache-seed/`` and are loaded into Redis when the API starts,
so anyone who clones the repo gets the cached lookups and previews without
querying IRSA again. Existing Redis keys are never overwritten.
"""
from pathlib import Path
import logging
import re
import sys

from redis.exceptions import RedisError

from .cache import redis_client

logger = logging.getLogger(__name__)

SEED_DIR = Path(__file__).resolve().parent.parent / "cache-seed"
LOOKUP_PREFIX = "spherex:lookup:v1:"
PREVIEW_PREFIX = "spherex:preview:"
DIGEST = re.compile(r"^[0-9a-f]{64}$")
KINDS = (
    ("lookups", LOOKUP_PREFIX, ".json"),
    ("previews", PREVIEW_PREFIX, ".png"),
)


def export_cache(seed_dir: Path = SEED_DIR) -> dict[str, int]:
    """Write every cached lookup and preview in Redis to ``seed_dir``."""
    counts = {}
    for folder, prefix, suffix in KINDS:
        target = seed_dir / folder
        target.mkdir(parents=True, exist_ok=True)
        written = 0
        for key in redis_client.scan_iter(match=f"{prefix}*", count=500):
            digest = key.decode("utf-8")[len(prefix):]
            value = redis_client.get(key)
            if not DIGEST.match(digest) or value is None:
                continue
            path = target / f"{digest}{suffix}"
            if not path.exists() or path.read_bytes() != value:
                path.write_bytes(value)
                written += 1
        counts[folder] = written
    return counts


def load_seed(seed_dir: Path = SEED_DIR) -> dict[str, int]:
    """Add seed files to Redis without a TTL, skipping keys that already exist."""
    counts = {}
    if not seed_dir.is_dir():
        return counts
    try:
        redis_client.ping()
    except RedisError as error:
        logger.warning("Redis unavailable while loading cache seed: %s", error)
        return counts
    try:
        for folder, prefix, suffix in KINDS:
            files = [path for path in (seed_dir / folder).glob(f"*{suffix}") if DIGEST.match(path.stem)]
            pipe = redis_client.pipeline(transaction=False)
            for path in files:
                pipe.set(f"{prefix}{path.stem}", path.read_bytes(), nx=True)
            counts[folder] = sum(1 for added in pipe.execute() if added) if files else 0
    except RedisError as error:
        logger.warning("Redis unavailable while loading cache seed: %s", error)
    return counts


def write_static(seed_dir: Path = SEED_DIR) -> int:
    """Save the target list and a BlinkNet/SpecNet score for every seeded lookup, for the static site."""
    import hashlib
    import json

    from .cache import known_targets
    from .nets import classify_measurements

    (seed_dir / "targets.json").write_text(json.dumps(known_targets), encoding="utf-8")
    scores = seed_dir / "scores"
    scores.mkdir(parents=True, exist_ok=True)
    written = 0
    for path in (seed_dir / "lookups").glob("*.json"):
        measurements = json.loads(path.read_text(encoding="utf-8")).get("measurements", [])
        previews = {}
        for item in measurements:
            url = item.get("cutout_url")
            png = seed_dir / "previews" / f"{hashlib.sha256(str(url).encode('utf-8')).hexdigest()}.png"
            if url and png.is_file():
                previews[url] = png.read_bytes()
        (scores / path.name).write_text(json.dumps(classify_measurements(measurements, previews)), encoding="utf-8")
        written += 1
    return written


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "static":
        print(f"Wrote targets.json and {write_static()} scores to {SEED_DIR}")
    elif command == "export":
        result = export_cache()
        print(f"Exported to {SEED_DIR}: {result['lookups']} new/changed lookups, {result['previews']} new/changed previews")
    elif command == "load":
        result = load_seed()
        print(f"Loaded into Redis: {result.get('lookups', 0)} lookups, {result.get('previews', 0)} previews (existing keys kept)")
    else:
        print("Usage: python -m backend.seed export|load")
        sys.exit(2)
