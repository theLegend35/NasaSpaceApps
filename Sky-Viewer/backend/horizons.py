"""Predicted sky positions from JPL Horizons.

A Horizons position is a prediction for a named solar-system body at one time.
It is not a detection in the SPHEREx image.
"""
from datetime import datetime, timedelta
import math
import re

import requests

SESSION = requests.Session()
SESSION.headers["User-Agent"] = "SkyTimeline-SpaceApps/1.0"
ROW = re.compile(
    r"(\d{4}-[A-Za-z]{3}-\d{2})\s+\d{2}:\d{2}\s+"
    r"(\d+)\s+(\d+)\s+([\d.]+)\s+([+-]?\d+)\s+(\d+)\s+([\d.]+)"
)


def _hours_to_degrees(hours: float, minutes: float, seconds: float) -> float:
    return (hours + minutes / 60 + seconds / 3600) * 15


def _dms_to_degrees(degrees: float, minutes: float, seconds: float) -> float:
    sign = -1 if math.copysign(1, degrees) < 0 else 1
    return sign * (abs(degrees) + minutes / 60 + seconds / 3600)


def predict(name: str, when: str) -> dict:
    """Return the geocentric RA/Dec Horizons predicts for ``name`` on ``when`` (YYYY-MM-DD)."""
    start = datetime.strptime(when, "%Y-%m-%d")
    stop = (start + timedelta(days=1)).strftime("%Y-%m-%d")
    response = SESSION.get(
        "https://ssd.jpl.nasa.gov/api/horizons.api",
        params={
            "format": "json",
            "COMMAND": f"'{name}'",
            "OBJ_DATA": "NO",
            "MAKE_EPHEM": "YES",
            "EPHEM_TYPE": "OBSERVER",
            "CENTER": "'500@399'",
            "START_TIME": f"'{when}'",
            "STOP_TIME": f"'{stop}'",
            "STEP_SIZE": "'1 d'",
            "QUANTITIES": "'1'",
        },
        timeout=40,
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("error"):
        raise ValueError(payload["error"])
    match = ROW.search(payload.get("result") or "")
    if match is None:
        raise ValueError(f"Horizons has no sky position for {name}")
    ra = _hours_to_degrees(float(match.group(2)), float(match.group(3)), float(match.group(4)))
    dec = _dms_to_degrees(float(match.group(5)), float(match.group(6)), float(match.group(7)))
    return {
        "name": name,
        "date": match.group(1),
        "ra": ra,
        "dec": dec,
        "when": when,
        "note": "JPL Horizons prediction for a solar-system body. This is not a detection in the SPHEREx image.",
    }


AU_KM = 149_597_870.7
PATH_ROW = re.compile(
    r"^\s*(\d{4}-[A-Za-z]{3}-\d{2})\s+\d{2}:\d{2}\s+(?:[*CNAmr]+\s+)?"
    r"(\d+)\s+(\d+)\s+([\d.]+)\s+([+-]?)(\d+)\s+(\d+)\s+([\d.]+)\s+"
    r"([\d.]+)\s+([+-]?[\d.]+)",
    re.MULTILINE,
)


def _angle_between(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    p1, d1, p2, d2 = (math.radians(value) for value in (ra1, dec1, ra2, dec2))
    cosine = math.sin(d1) * math.sin(d2) + math.cos(d1) * math.cos(d2) * math.cos(p1 - p2)
    return math.degrees(math.acos(max(-1.0, min(1.0, cosine))))


def path(command: str, start: str, days: int) -> dict:
    """Daily geocentric positions and Earth distance for one body over ``days`` days."""
    if not 1 <= days <= 120:
        raise ValueError("Pick between 1 and 120 days.")
    first = datetime.strptime(start, "%Y-%m-%d")
    step = 1 if days <= 40 else 3
    response = SESSION.get(
        "https://ssd.jpl.nasa.gov/api/horizons.api",
        params={
            "format": "json",
            "COMMAND": f"'{command}'",
            "OBJ_DATA": "NO",
            "MAKE_EPHEM": "YES",
            "EPHEM_TYPE": "OBSERVER",
            "CENTER": "'500@399'",
            "START_TIME": f"'{start}'",
            "STOP_TIME": f"'{(first + timedelta(days=days)).strftime('%Y-%m-%d')}'",
            "STEP_SIZE": f"'{step} d'",
            "QUANTITIES": "'1,20'",
        },
        timeout=40,
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("error"):
        raise ValueError(payload["error"])
    points = []
    for match in PATH_ROW.finditer(payload.get("result") or ""):
        dec = (1 if match.group(5) != "-" else -1) * (
            float(match.group(6)) + float(match.group(7)) / 60 + float(match.group(8)) / 3600
        )
        points.append({
            "date": datetime.strptime(match.group(1), "%Y-%b-%d").strftime("%Y-%m-%d"),
            "ra": _hours_to_degrees(float(match.group(2)), float(match.group(3)), float(match.group(4))),
            "dec": dec,
            "earth_km": float(match.group(9)) * AU_KM,
            "closing_km_s": -float(match.group(10)),
        })
    if len(points) < 2:
        raise ValueError(f"Horizons has no daily positions for {command}")
    travelled = sum(
        _angle_between(a["ra"], a["dec"], b["ra"], b["dec"]) for a, b in zip(points, points[1:])
    )
    return {
        "command": command,
        "step_days": step,
        "points": points,
        "travelled_deg": travelled,
        "per_day_deg": travelled / max(days, 1),
    }
