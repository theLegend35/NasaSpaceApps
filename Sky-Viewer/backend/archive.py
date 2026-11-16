from io import BytesIO
import time
from urllib.parse import urlencode, urlsplit, urlunsplit

import astropy.units as u
import numpy as np
import requests
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.table import Table
from astropy.wcs import WCS
from astroquery.ipac.irsa import Irsa
from astropy.utils.data import conf
from PIL import Image
from pyvo.dal import DALFormatError, DALServiceError, TAPService

conf.remote_timeout = 120


class TAPSession(requests.Session):
    def request(self, method, url, **kwargs):
        kwargs.setdefault("timeout", (10, 120))
        return super().request(method, url, **kwargs)


TRANSIENT_STATUS = {502, 503, 504}


def is_transient(error: Exception) -> bool:
    """True for gateway/proxy errors that IRSA usually recovers from quickly."""
    for candidate in (error, getattr(error, "cause", None), getattr(error, "__cause__", None)):
        response = getattr(candidate, "response", None)
        if getattr(response, "status_code", None) in TRANSIENT_STATUS:
            return True
    message = str(error)
    return any(f"{code} " in message or f"HTTP Code: {code}" in message for code in TRANSIENT_STATUS)


def with_retries(fn, attempts: int = 6):
    """Retry IRSA gateway errors with backoff (1, 2, 4, 8, 15s ≈ 30s total)."""
    for attempt in range(attempts):
        try:
            return fn()
        except (DALServiceError, requests.RequestException) as error:
            if not is_transient(error) or attempt == attempts - 1:
                raise
            time.sleep(min(2**attempt, 15))


def parse_footprint(region) -> list[list[float]]:
    tokens = str(region).replace(",", " ").replace("(", " ").replace(")", " ").split()
    if len(tokens) < 8 or tokens[0].upper() != "POLYGON":
        return []
    values = tokens[2:] if tokens[1].upper() in {"ICRS", "FK5", "GALACTIC"} else tokens[1:]
    try:
        coordinates = [float(value) for value in values]
    except ValueError:
        return []
    if len(coordinates) < 6 or len(coordinates) % 2:
        return []
    return [[coordinates[index], coordinates[index + 1]] for index in range(0, len(coordinates), 2)]


def render_preview(image_data) -> bytes | None:
    data = np.asarray(image_data, dtype=np.float32)
    valid = np.isfinite(data)
    if not np.any(valid):
        return None

    low, high = np.percentile(data[valid], (1, 99))
    stretched = np.zeros(data.shape, dtype=np.float32)
    if high > low:
        stretched[valid] = np.clip((data[valid] - low) / (high - low), 0, 1)
    else:
        stretched[valid] = 1

    preview = Image.fromarray((np.sqrt(stretched) * 255).astype(np.uint8))
    preview = preview.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    preview = preview.resize((512, 512), Image.Resampling.BICUBIC)
    output = BytesIO()
    preview.save(output, format="PNG", optimize=True)
    return output.getvalue()


def find_images(ra: float, dec: float, size_deg: float, detector: int | None):
    """Prefer fresh TAP results, falling back to SIA if TAP is unavailable."""
    coord = SkyCoord(ra * u.deg, dec * u.deg, frame="icrs")
    try:
        rows = find_images_tap(ra, dec, size_deg, detector)
        source = "TAP"
    except (DALFormatError, DALServiceError, requests.RequestException, TimeoutError) as tap_error:
        try:
            rows = find_images_sia(ra, dec, size_deg, detector, coord)
            source = "SIA"
        except Exception as sia_error:
            raise RuntimeError(f"TAP failed: {tap_error}; SIA fallback failed: {sia_error}") from sia_error

    rows.meta["discovery_source"] = source
    return rows


def find_images_tap(ra: float, dec: float, size_deg: float, detector: int | None):
    band_filter = f"AND p.energy_bandpassname = 'SPHEREx-D{detector}'" if detector else ""
    query = f"""
    SELECT
      'https://irsa.ipac.caltech.edu/' || a.uri || '?center={ra},{dec}d&size={size_deg}' AS uri,
            p.time_bounds_lower, p.energy_bandpassname, p.poly AS footprint
    FROM spherex.artifact a
    JOIN spherex.plane p ON a.planeid = p.planeid
    WHERE 1 = CONTAINS(POINT('ICRS', {ra}, {dec}), p.poly) {band_filter}
    ORDER BY p.time_bounds_lower
    """
    service = TAPService(Irsa.tap_url, session=TAPSession())
    rows = with_retries(lambda: service.run_sync(query, language="ADQL")).to_table()
    rows.meta["discovery_source"] = "TAP"
    return rows


def find_images_sia(
    ra: float,
    dec: float,
    size_deg: float,
    detector: int | None,
    coord: SkyCoord,
):
    rows = with_retries(
        lambda: Irsa.query_sia(
            pos=(coord, 1 * u.arcsec),
            collection=["spherex_dr1", "spherex_dr1_deep", "spherex_qr3", "spherex_qr3_deep"],
        )
    )

    if detector is not None:
        rows = rows[rows["energy_bandpassname"] == f"SPHEREx-D{detector}"]

    cutouts = []
    for row in rows:
        source = urlsplit(str(row["access_url"]))
        query = urlencode({"center": f"{ra},{dec}d", "size": size_deg})
        cutout_url = urlunsplit((source.scheme, source.netloc, source.path, query, source.fragment))
        cutouts.append((cutout_url, float(row["t_min"]), str(row["energy_bandpassname"]), str(row["s_region"])))

    return Table(rows=cutouts, names=("uri", "time_bounds_lower", "energy_bandpassname", "footprint"))


def compact_wcs(header, shape):
    if "CD1_1" in header:
        cd = [
            [float(header["CD1_1"]), float(header["CD1_2"])],
            [float(header["CD2_1"]), float(header["CD2_2"])],
        ]
    else:
        cd = [[float(header["CDELT1"]), 0.0], [0.0, float(header["CDELT2"])]]
    return {
        "crpix": [float(header["CRPIX1"]), float(header["CRPIX2"])],
        "crval": [float(header["CRVAL1"]), float(header["CRVAL2"])],
        "cd": cd,
        "width": int(shape[1]),
        "height": int(shape[0]),
    }


def measure(row, coord: SkyCoord):
    """Download one cutout and read its pixel at coord."""
    try:
        with fits.open(row["uri"], cache=False) as hdul:
            header = hdul["IMAGE"].header
            x, y = WCS(header).world_to_pixel(coord)
            spectral_wcs = WCS(header, fobj=hdul, key="W")
            spectral_wcs.sip = None
            wavelength, bandwidth = spectral_wcs.pixel_to_world(x, y)

            ix, iy = int(round(float(x))), int(round(float(y)))
            image = hdul["IMAGE"].data
            if not (0 <= iy < image.shape[0] and 0 <= ix < image.shape[1]):
                return None

            try:
                preview_png = render_preview(image)
            except Exception:
                preview_png = None

            preview_x = float(np.clip(float(x) / max(image.shape[1] - 1, 1), 0, 1))
            preview_y = float(np.clip(1 - float(y) / max(image.shape[0] - 1, 1), 0, 1))
            try:
                wcs = compact_wcs(header, image.shape)
            except Exception:
                wcs = None

            return {
                "time_mjd": float(row["time_bounds_lower"]),
                "detector": str(row["energy_bandpassname"]),
                "wavelength_um": float(wavelength.to(u.um).value),
                "bandwidth_um": float(bandwidth.to(u.um).value),
                "flux": float(image[iy, ix]),
                "variance": float(hdul["VARIANCE"].data[iy, ix]),
                "flag": int(hdul["FLAGS"].data[iy, ix]),
                "flux_unit": header.get("BUNIT", ""),
                "cutout_url": str(row["uri"]),
                "_preview_png": preview_png,
                "preview_x": preview_x,
                "preview_y": preview_y,
                "wcs": wcs,
            }
    except Exception:
        return None