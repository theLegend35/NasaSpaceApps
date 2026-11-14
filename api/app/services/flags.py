"""SPHEREx FLAGS: build the name->bit map from each file's header, never hardcode bits."""
from __future__ import annotations

from functools import lru_cache

import numpy as np
import yaml

from ..core.settings import get_settings


@lru_cache
def flag_config() -> dict:
    with open(get_settings().config_dir / "rules.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)["flags"]


def bit_map(header) -> dict[str, int]:
    """name -> bit, read from the header.

    QR3/DR1 files carry MSKNnnnn = name (and MSKDnnnn = description), where nnnn
    is the bit. Older QR2 prep files used MP_<NAME> = bit instead; accept both.
    """
    out: dict[str, int] = {}
    for k in header.keys():
        if k.startswith("MSKN") and k[4:].isdigit():
            out[str(header[k]).strip().upper()] = int(k[4:])
        elif k.startswith("MP_"):
            try:
                out[k[3:].upper()] = int(header[k])
            except (TypeError, ValueError):
                continue
    return out


def descriptions(header) -> dict[int, str]:
    return {int(k[4:]): str(header[k]) for k in header.keys() if k.startswith("MSKD") and k[4:].isdigit()}


def hide_mask_bits(bits: dict[str, int], names: list[str] | None = None) -> int:
    """OR of the bits for the default hide set. Names the header lacks are skipped."""
    names = names if names is not None else flag_config()["hide"]
    m = 0
    for n in names:
        if n in bits:
            m |= 1 << bits[n]
    return m


def bad_pixels(flags: np.ndarray, hide_bits: int) -> np.ndarray:
    return (flags.astype(np.int64) & hide_bits) != 0


def names_at(value: int, bits: dict[str, int]) -> list[str]:
    """Flag names set in one pixel value; unknown bits come back as 'unknown flag bit N'."""
    inv = {b: n for n, b in bits.items()}
    out = []
    v = int(value)
    b = 0
    while v:
        if v & 1:
            out.append(inv.get(b, f"unknown flag bit {b}"))
        v >>= 1
        b += 1
    return out


def fraction_in_aperture(bad: np.ndarray, x: float, y: float, r: float) -> float:
    """Fraction of flagged pixels within radius r (px) of (x, y)."""
    h, w = bad.shape
    yy, xx = np.ogrid[:h, :w]
    m = (xx - x) ** 2 + (yy - y) ** 2 <= r * r
    n = int(m.sum())
    return float(bad[m].sum()) / n if n else 1.0
