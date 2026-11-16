"""Name resolution plus Gaia DR3 and AllWISE positions for a sky patch.

Both catalogs are read from IRSA's Gator service, which answers a cone search
with the published table. Sesame resolves a name to coordinates.
"""
from urllib.parse import quote
from xml.etree import ElementTree
import math

import requests

USER_AGENT = "SkyTimeline-SpaceApps/1.0"
SESSION = requests.Session()
SESSION.headers["User-Agent"] = USER_AGENT
GATOR = "https://irsa.ipac.caltech.edu/cgi-bin/Gator/nph-query"

ALIASES = {
    "wise 0855": "WISE J085510.83-071442.5",
    "wise 0855-0714": "WISE J085510.83-071442.5",
    "barnard's star": "Barnard's Star",
    "barnards star": "Barnard's Star",
    "epsilon indi b": "Epsilon Indi B",
    "rw aur": "RW Aur",
    "rw aurigae": "RW Aur",
    "r dra": "R Dra",
    "r draconis": "R Dra",
}


def _text(node, path):
    found = node.find(path)
    return found.text.strip() if found is not None and found.text else None


def resolve_name(name: str):
    query = " ".join(name.strip().split())
    if not query:
        return None
    lookup = ALIASES.get(query.lower(), query)
    response = SESSION.get(
        "https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/?" + quote(lookup),
        timeout=20,
    )
    response.raise_for_status()
    root = ElementTree.fromstring(response.content)
    for resolver in root.findall(".//Resolver"):
        resolved = _text(resolver, "name") or _text(resolver, "oname")
        ra = _text(resolver, "jradeg")
        dec = _text(resolver, "jdedeg")
        if resolved and ra and dec:
            return {"name": resolved, "ra": float(ra), "dec": float(dec), "query": query}
    return None


def _num(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def _gator_rows(catalog, ra, dec, radius_arcsec, columns, constraints=None):
    params = {
        "catalog": catalog,
        "spatial": "Cone",
        "objstr": f"{ra} {dec}",
        "radius": int(radius_arcsec),
        "radunits": "arcsec",
        "outfmt": "1",
        "selcols": ",".join(columns),
    }
    if constraints:
        params["constraints"] = constraints
    response = SESSION.get(GATOR, params=params, timeout=40)
    response.raise_for_status()
    lines = response.text.splitlines()
    header = next((line for line in lines if line.startswith("|")), None)
    if header is None:
        raise RuntimeError("Catalog search did not return a table")
    names = [part.strip() for part in header.strip().strip("|").split("|")]
    rows = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("|") or stripped.startswith("\\"):
            continue
        parts = stripped.split()
        if len(parts) < len(names) or parts[0] in {"char", "double", "int", "null"}:
            continue
        rows.append(dict(zip(names, parts[:len(names)])))
    return rows


def catalogs(ra: float, dec: float, radius: float):
    radius = float(max(0.02, min(0.25, radius)))
    radius_arcsec = int(round(radius * 3600))
    result = {"ra": ra, "dec": dec, "radius_deg": radius, "gaia": [], "wise": [], "errors": []}
    try:
        for row in _gator_rows(
            "gaia_dr3_source", ra, dec, radius_arcsec,
            ["source_id", "ra", "dec", "phot_g_mean_mag"],
            "phot_g_mean_mag < 18",
        )[:40]:
            result["gaia"].append({
                "catalog": "Gaia DR3",
                "name": row["source_id"],
                "ra": _num(row["ra"]),
                "dec": _num(row["dec"]),
                "brightness": _num(row["phot_g_mean_mag"]),
                "brightness_label": "G",
            })
        result["gaia"] = [row for row in result["gaia"] if row["ra"] is not None and row["dec"] is not None]
    except Exception as error:
        result["errors"].append(f"Gaia: {error}")
    try:
        for row in _gator_rows(
            "allwise_p3as_psd", ra, dec, radius_arcsec,
            ["designation", "ra", "dec", "w1mpro"],
        )[:40]:
            result["wise"].append({
                "catalog": "AllWISE",
                "name": row["designation"],
                "ra": _num(row["ra"]),
                "dec": _num(row["dec"]),
                "brightness": _num(row["w1mpro"]),
                "brightness_label": "W1",
            })
        result["wise"] = [row for row in result["wise"] if row["ra"] is not None and row["dec"] is not None]
    except Exception as error:
        result["errors"].append(f"AllWISE: {error}")
    return result
