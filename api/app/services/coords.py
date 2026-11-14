"""Coordinate parsing and simple sky math."""
from __future__ import annotations

import math
import re

from astropy import units as u
from astropy.coordinates import SkyCoord

_DECIMAL = re.compile(r"^\s*([+]?\d+(?:\.\d+)?)\s*[,\s]\s*([+-]?\d+(?:\.\d+)?)\s*$")


def parse_coords(text: str) -> tuple[float, float] | None:
    """Parse '133.795 -7.2451', '08h55m10.831s -07d14m42.53s' or '8:55:10.83 -7:14:42.5'.

    Returns (ra_deg, dec_deg) or None if this isn't a coordinate string.
    """
    q = text.strip().replace("−", "-")
    if not q:
        return None
    m = _DECIMAL.match(q)
    if m:
        ra, dec = float(m.group(1)), float(m.group(2))
        if 0 <= ra < 360 and -90 <= dec <= 90:
            return ra, dec
        return None
    if not re.search(r"\d", q) or re.search(r"[a-gi-ln-rt-z]", q.lower().replace("d", "")):
        # Letters other than h, m, s, d mean a name, not coordinates.
        return None
    parts = q.replace(",", " ").split()
    try:
        if len(parts) == 2 and ":" in parts[0]:
            c = SkyCoord(parts[0], parts[1], unit=(u.hourangle, u.deg))
        elif len(parts) == 6:
            c = SkyCoord(" ".join(parts[:3]), " ".join(parts[3:]), unit=(u.hourangle, u.deg))
        else:
            c = SkyCoord(q, unit=(u.hourangle, u.deg))
    except (ValueError, u.UnitsError):
        return None
    ra, dec = float(c.ra.deg), float(c.dec.deg)
    if not (0 <= ra < 360 and -90 <= dec <= 90):
        return None
    return ra, dec


def separation_arcsec(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    """Great-circle separation (haversine), arcsec."""
    r1, d1, r2, d2 = map(math.radians, (ra1, dec1, ra2, dec2))
    h = math.sin((d2 - d1) / 2) ** 2 + math.cos(d1) * math.cos(d2) * math.sin((r2 - r1) / 2) ** 2
    return math.degrees(2 * math.asin(min(1.0, math.sqrt(h)))) * 3600.0


def propagate_linear(ra: float, dec: float, pmra_mas: float, pmdec_mas: float,
                     epoch_from: float, epoch_to: float) -> tuple[float, float]:
    """Move a position by its proper motion: d(alpha*) = mu_alpha* dt, d(delta) = mu_delta dt.

    pmra is mu_alpha* (already includes cos(dec)), as Gaia and SIMBAD give it.
    Good to well under an arcsec for our baselines away from the poles; use
    SkyCoord.apply_space_motion when parallax matters.
    """
    dt = epoch_to - epoch_from
    ddec = pmdec_mas * dt / 3.6e6
    cosd = math.cos(math.radians(dec))
    dra = (pmra_mas * dt / 3.6e6) / max(cosd, 1e-6)
    return (ra + dra) % 360.0, dec + ddec


def mjd_to_jyear(mjd: float) -> float:
    return 2000.0 + (mjd - 51544.5) / 365.25


def jyear_to_mjd(jy: float) -> float:
    return 51544.5 + (jy - 2000.0) * 365.25
