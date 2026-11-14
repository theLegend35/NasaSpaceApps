"""PNG rendering: one shared asinh stretch for all frames, diverging colours for differences."""
from __future__ import annotations

import io

import numpy as np
from PIL import Image

NAN_GRAY = (89, 93, 108)          # --color-neutral-700: no data / fully flagged
MASK_RGBA = (147, 151, 171, 190)  # --color-neutral-500 at ~75%


def shared_limits(frames: list[np.ndarray], lo_pct: float = 0.5, hi_pct: float = 99.5) -> tuple[float, float]:
    """One vmin/vmax from all frames together (PROPOSAL 0.5/99.5 percentiles).

    Per-frame auto-contrast makes fake brightness changes, so never do it.
    """
    vals = np.concatenate([f[np.isfinite(f)].ravel() for f in frames if f is not None and np.isfinite(f).any()])
    if vals.size == 0:
        return 0.0, 1.0
    lo, hi = np.percentile(vals, [lo_pct, hi_pct])
    if hi <= lo:
        hi = lo + 1e-6
    return float(lo), float(hi)


def asinh_u8(img: np.ndarray, vmin: float, vmax: float, a: float = 0.1) -> np.ndarray:
    x = np.clip((img - vmin) / (vmax - vmin), 0.0, 1.0)
    y = np.arcsinh(x / a) / np.arcsinh(1.0 / a)
    return (np.nan_to_num(y) * 255).astype(np.uint8)


def to_png(img: np.ndarray, vmin: float, vmax: float, upscale: int = 1) -> bytes:
    g = asinh_u8(img, vmin, vmax)
    rgb = np.stack([g, g, g], axis=-1)
    nan = ~np.isfinite(img)
    rgb[nan] = NAN_GRAY
    return _encode(rgb, upscale)


def diff_png(diff: np.ndarray, limit: float | None = None, upscale: int = 1) -> tuple[bytes, float]:
    """Diverging map centred on zero. Orange = brighter now, blue = brighter before.

    Colourblind-safe pair; the legend in the UI uses the same two colours.
    """
    finite = diff[np.isfinite(diff)]
    if limit is None:
        limit = float(np.percentile(np.abs(finite), 99.5)) if finite.size else 1.0
        limit = limit or 1.0
    t = np.clip(np.nan_to_num(diff) / limit, -1, 1)
    base = np.array([22, 24, 38], dtype=np.float64)       # --color-bg
    pos = np.array([240, 160, 60], dtype=np.float64)      # orange: brighter now
    neg = np.array([80, 160, 240], dtype=np.float64)      # blue: brighter before
    tt = np.abs(t)[..., None] ** 0.6
    rgb = np.where(t[..., None] >= 0, base + (pos - base) * tt, base + (neg - base) * tt)
    rgb = rgb.astype(np.uint8)
    rgb[~np.isfinite(diff)] = NAN_GRAY
    return _encode(rgb, upscale), limit


def mask_png(bad: np.ndarray, uncovered: np.ndarray | None = None, upscale: int = 1) -> bytes:
    rgba = np.zeros(bad.shape + (4,), dtype=np.uint8)
    rgba[bad] = MASK_RGBA
    if uncovered is not None:
        rgba[uncovered] = (*NAN_GRAY, 255)
    im = Image.fromarray(rgba[::-1], "RGBA")  # FITS row 0 is the bottom
    if upscale > 1:
        im = im.resize((im.width * upscale, im.height * upscale), Image.NEAREST)
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def rgb_png(r: np.ndarray, g: np.ndarray, b: np.ndarray, upscale: int = 1) -> bytes:
    chans = []
    for c in (r, g, b):
        lo, hi = shared_limits([c])
        chans.append(asinh_u8(c, lo, hi))
    rgb = np.stack(chans, axis=-1)
    return _encode(rgb, upscale)


def _encode(rgb: np.ndarray, upscale: int) -> bytes:
    im = Image.fromarray(rgb[::-1], "RGB")  # flip so north is up, east left
    if upscale > 1:
        im = im.resize((im.width * upscale, im.height * upscale), Image.NEAREST)
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def gif(frames_png: list[bytes], captions: list[str], fps: float = 2.0, credit: str = "Data: NASA SPHEREx/IRSA") -> bytes:
    from PIL import ImageDraw

    ims = []
    for png, cap in zip(frames_png, captions):
        im = Image.open(io.BytesIO(png)).convert("RGB")
        if im.width < 360:
            k = max(1, 360 // im.width)
            im = im.resize((im.width * k, im.height * k), Image.NEAREST)
        d = ImageDraw.Draw(im)
        d.rectangle([0, 0, im.width, 18], fill=(22, 24, 38))
        d.text((6, 3), cap, fill=(233, 233, 237))
        d.rectangle([0, im.height - 16, im.width, im.height], fill=(22, 24, 38))
        d.text((6, im.height - 14), credit, fill=(178, 182, 202))
        ims.append(im.convert("P", palette=Image.ADAPTIVE))
    buf = io.BytesIO()
    ims[0].save(buf, "GIF", save_all=True, append_images=ims[1:], duration=int(1000 / fps), loop=0)
    return buf.getvalue()
