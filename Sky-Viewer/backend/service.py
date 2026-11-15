import concurrent.futures
from collections.abc import Callable

import astropy.units as u
from astropy.coordinates import SkyCoord

from .archive import find_images, measure, parse_footprint
from .cache import read_cached_lookup, lookup_cache_key, store_previews, write_cached_lookup


def lookup(
    ra: float,
    dec: float,
    size: float,
    detector: int | None,
    on_progress: Callable[[int, int], None] | None = None,
):
    cache_key = lookup_cache_key(ra, dec, size, detector)
    cached = read_cached_lookup(cache_key)
    if cached is not None:
        cached["cache_hit"] = True
        return cached

    coord = SkyCoord(ra * u.deg, dec * u.deg, frame="icrs")
    rows = find_images(ra, dec, size, detector)
    total = len(rows)
    footprints = []
    seen_footprints = set()
    if "footprint" in rows.colnames:
        for region in rows["footprint"]:
            polygon = parse_footprint(region)
            key = tuple((round(point[0], 5), round(point[1], 5)) for point in polygon)
            if len(polygon) >= 3 and key not in seen_footprints:
                seen_footprints.add(key)
                footprints.append(polygon)
    if on_progress:
        on_progress(0, total)

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(measure, row, coord) for row in rows]
        results = []
        for completed, future in enumerate(concurrent.futures.as_completed(futures), start=1):
            results.append(future.result())
            if on_progress:
                on_progress(completed, total)

    measurements = [measurement for measurement in results if measurement]
    previews = {}
    for measurement in measurements:
        preview = measurement.pop("_preview_png", None)
        if preview:
            previews[measurement["cutout_url"]] = preview
    store_previews(previews)
    measurements.sort(key=lambda item: item["wavelength_um"])
    result = {
        "ra": ra,
        "dec": dec,
        "discovery_source": rows.meta.get("discovery_source", "unknown"),
        "images_found": len(rows),
        "images_measured": len(measurements),
        "measurements": measurements,
        "footprints": footprints,
        "cache_hit": False,
    }
    write_cached_lookup(cache_key, result)
    return result