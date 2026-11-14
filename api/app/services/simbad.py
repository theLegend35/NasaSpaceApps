"""Name resolution through CDS Sesame (SIMBAD). Returns only what SIMBAD returned."""
from __future__ import annotations

import urllib.parse
import xml.etree.ElementTree as ET

from ..core import cache as kv
from ..core.errors import ApiError
from ..core.http import request_with_retries
from ..core.settings import get_settings


def _text(node: ET.Element | None, tag: str) -> str | None:
    if node is None:
        return None
    el = node.find(tag)
    return el.text.strip() if el is not None and el.text else None


def _float(v: str | None) -> float | None:
    try:
        return float(v) if v is not None else None
    except ValueError:
        return None


def lookup(name: str) -> dict | None:
    """Resolve a name with SIMBAD. Returns None if SIMBAD has no such object.

    Result: {name, ra, dec, otype, spType, pmRa, pmDec, plx, epoch: 2000.0, source}
    Positions are J2000 at epoch J2000: fast movers have moved since (design doc §1).
    """
    k = kv.key("sesame", name.strip().lower())
    hit = kv.cache().get(k)
    if hit is not None:
        return hit or None
    url = f"{get_settings().sesame_url}?{urllib.parse.quote(name.strip())}"
    r = request_with_retries("GET", url, service="SIMBAD (Sesame)", timeout=30)
    try:
        root = ET.fromstring(r.text)
    except ET.ParseError as e:
        raise ApiError("bad_upstream", "SIMBAD returned something we couldn't read.", status=502) from e
    res = root.find(".//Resolver")
    ra = _float(_text(res, "jradeg"))
    dec = _float(_text(res, "jdedeg"))
    if res is None or ra is None or dec is None:
        kv.cache().set(k, {}, expire=86400)
        return None
    pm = res.find("pm")
    out = {
        "name": _text(res, "oname") or name,
        "ra": ra,
        "dec": dec,
        "otype": _text(res, "otype"),
        "spType": _text(res, "spType"),
        "pmRa": _float(_text(pm, "pmRA")),
        "pmDec": _float(_text(pm, "pmDE")),
        "plx": _float(_text(res.find("plx"), "v")),
        "epoch": 2000.0,
        "source": "SIMBAD",
    }
    kv.cache().set(k, out, expire=7 * 86400)
    return out
