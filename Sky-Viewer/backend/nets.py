"""Two small networks for Sky Timeline.

BlinkNet compares two cutout patches and guesses settled, mover, variable, or artifact.
SpecNet reads six SPHEREx detector fluxes and guesses star, brown dwarf, galaxy, or solar system.

Both are trained on synthetic examples that match the numbers the API actually scores.
Their output is a candidate, not a confirmation.
"""
from pathlib import Path
import json

import numpy as np
from PIL import Image
from io import BytesIO

BLINK_LABELS = ("settled", "mover", "variable", "artifact")
SPEC_LABELS = ("star", "brown dwarf", "galaxy", "solar system")
BANDS_UM = np.array([0.92, 1.36, 2.02, 3.12, 4.12, 4.71], dtype=np.float32)
MODEL_DIR = Path(__file__).resolve().parent / "models"

_weights: dict | None = None


def _conv(x, w, b):
    channels, height, width = x.shape
    filters = w.shape[0]
    out_h, out_w = height - 2, width - 2
    cols = np.empty((channels * 9, out_h * out_w), np.float32)
    index = 0
    for channel in range(channels):
        for row in range(3):
            for col in range(3):
                cols[index] = x[channel, row:row + out_h, col:col + out_w].reshape(-1)
                index += 1
    out = (w.reshape(filters, -1) @ cols).reshape(filters, out_h, out_w) + b[:, None, None]
    return out, cols


def _conv_back(dout, cols, w, x):
    filters, channels, _, _ = w.shape
    out_h, out_w = dout.shape[1:]
    flat = dout.reshape(filters, -1)
    dcol = w.reshape(filters, -1).T @ flat
    dw = (flat @ cols.T).reshape(w.shape)
    db = dout.sum(axis=(1, 2))
    dx = np.zeros_like(x)
    index = 0
    for channel in range(channels):
        for row in range(3):
            for col in range(3):
                dx[channel, row:row + out_h, col:col + out_w] += dcol[index].reshape(out_h, out_w)
                index += 1
    return dx, dw, db


def _pool(x):
    filters, height, width = x.shape
    even_h, even_w = height // 2 * 2, width // 2 * 2
    view = x[:, :even_h, :even_w].reshape(filters, even_h // 2, 2, even_w // 2, 2)
    windows = view.transpose(0, 1, 3, 2, 4).reshape(filters, even_h // 2, even_w // 2, 4)
    return windows.max(-1), windows.argmax(-1)


def _pool_back(dout, index, shape):
    filters, height, width = shape
    even_h, even_w = height // 2 * 2, width // 2 * 2
    out_h, out_w = even_h // 2, even_w // 2
    windows = np.zeros((filters, out_h, out_w, 4), np.float32)
    n = np.arange(filters)[:, None, None]
    i = np.arange(out_h)[None, :, None]
    j = np.arange(out_w)[None, None, :]
    windows[n, i, j, index] = dout
    restored = windows.reshape(filters, out_h, out_w, 2, 2).transpose(0, 1, 3, 2, 4).reshape(filters, even_h, even_w)
    if (even_h, even_w) == (height, width):
        return restored
    full = np.zeros(shape, np.float32)
    full[:, :even_h, :even_w] = restored
    return full


def _softmax_grad(logits, label):
    shifted = logits - logits.max()
    probs = np.exp(shifted)
    probs /= probs.sum()
    grad = probs.copy()
    grad[label] -= 1
    return float(-np.log(probs[label] + 1e-8)), grad, probs


def _blink_forward(x, weights):
    a1, cols1 = _conv(x, weights["w1"], weights["b1"])
    h1 = np.maximum(a1, 0)
    p1, i1 = _pool(h1)
    a2, cols2 = _conv(p1, weights["w2"], weights["b2"])
    h2 = np.maximum(a2, 0)
    p2, i2 = _pool(h2)
    flat = p2.reshape(-1)
    z3 = weights["w3"] @ flat + weights["b3"]
    h3 = np.maximum(z3, 0)
    logits = weights["w4"] @ h3 + weights["b4"]
    cache = (x, a1, cols1, h1, p1, i1, a2, cols2, h2, p2, i2, flat, z3, h3)
    return logits, cache


def _blink_backward(cache, dlogits, weights):
    x, a1, cols1, h1, p1, i1, a2, cols2, h2, p2, i2, flat, z3, h3 = cache
    dw4 = np.outer(dlogits, h3)
    db4 = dlogits
    dz3 = (weights["w4"].T @ dlogits) * (z3 > 0)
    dw3 = np.outer(dz3, flat)
    db3 = dz3
    dp2 = (weights["w3"].T @ dz3).reshape(p2.shape)
    dh2 = _pool_back(dp2, i2, h2.shape) * (a2 > 0)
    dp1, dw2, db2 = _conv_back(dh2, cols2, weights["w2"], p1)
    dh1 = _pool_back(dp1, i1, h1.shape) * (a1 > 0)
    _, dw1, db1 = _conv_back(dh1, cols1, weights["w1"], x)
    return {"w1": dw1, "b1": db1, "w2": dw2, "b2": db2, "w3": dw3, "b3": db3, "w4": dw4, "b4": db4}


def _spec_forward(x, weights):
    z1 = weights["s1"] @ x + weights["sb1"]
    h1 = np.maximum(z1, 0)
    logits = weights["s2"] @ h1 + weights["sb2"]
    return logits, (x, z1, h1)


def _spec_backward(cache, dlogits, weights):
    x, z1, h1 = cache
    ds2 = np.outer(dlogits, h1)
    dsb2 = dlogits
    dz1 = (weights["s2"].T @ dlogits) * (z1 > 0)
    ds1 = np.outer(dz1, x)
    dsb1 = dz1
    return {"s1": ds1, "sb1": dsb1, "s2": ds2, "sb2": dsb2}


def _init_weights(rng):
    weights = {
        "w1": rng.normal(0, np.sqrt(2 / 18), (8, 2, 3, 3)).astype(np.float32),
        "b1": np.zeros(8, np.float32),
        "w2": rng.normal(0, np.sqrt(2 / 72), (16, 8, 3, 3)).astype(np.float32),
        "b2": np.zeros(16, np.float32),
        "w3": rng.normal(0, np.sqrt(2 / 256), (32, 256)).astype(np.float32),
        "b3": np.zeros(32, np.float32),
        "w4": rng.normal(0, np.sqrt(2 / 32), (4, 32)).astype(np.float32),
        "b4": np.zeros(4, np.float32),
        "s1": rng.normal(0, np.sqrt(2 / 6), (24, 6)).astype(np.float32),
        "sb1": np.zeros(24, np.float32),
        "s2": rng.normal(0, np.sqrt(2 / 24), (4, 24)).astype(np.float32),
        "sb2": np.zeros(4, np.float32),
    }
    return weights


def _gradient_error(weights):
    rng = np.random.default_rng(1)
    sample = rng.random((2, 24, 24)).astype(np.float32)
    label = 1
    logits, cache = _blink_forward(sample, weights)
    _, grad, _ = _softmax_grad(logits, label)
    analytic = _blink_backward(cache, grad, weights)["w1"][0, 0, 0, 0]
    step = 1e-3
    original = weights["w1"][0, 0, 0, 0]
    weights["w1"][0, 0, 0, 0] = original + step
    plus, _ = _blink_forward(sample, weights)
    weights["w1"][0, 0, 0, 0] = original - step
    minus, _ = _blink_forward(sample, weights)
    weights["w1"][0, 0, 0, 0] = original
    _, g_plus, _ = _softmax_grad(plus, label)
    _, g_minus, _ = _softmax_grad(minus, label)
    # Loss difference, not the softmax grad vector.
    loss_plus = -np.log((np.exp(plus - plus.max()) / np.exp(plus - plus.max()).sum())[label] + 1e-8)
    loss_minus = -np.log((np.exp(minus - minus.max()) / np.exp(minus - minus.max()).sum())[label] + 1e-8)
    numeric = (loss_plus - loss_minus) / (2 * step)
    return float(abs(analytic - numeric) / max(abs(numeric), 1e-6))


def _blob(image, cy, cx, amp, sigma=1.35):
    yy, xx = np.mgrid[0:24, 0:24]
    image += amp * np.exp(-((yy - cy) ** 2 + (xx - cx) ** 2) / (2 * sigma ** 2))


def _blink_sample(kind, rng):
    image = rng.normal(0.12, 0.035, (2, 24, 24)).astype(np.float32)
    cy, cx = rng.uniform(8, 16, size=2)
    amp = float(rng.uniform(0.5, 0.95))
    if kind == 0:
        _blob(image[0], cy, cx, amp)
        _blob(image[1], cy + rng.normal(0, 0.15), cx + rng.normal(0, 0.15), amp * rng.uniform(0.9, 1.1))
    elif kind == 1:
        shift = float(rng.uniform(2.8, 6.0))
        angle = float(rng.uniform(0, 2 * np.pi))
        _blob(image[0], cy, cx, amp)
        _blob(image[1], cy + shift * np.sin(angle), cx + shift * np.cos(angle), amp * rng.uniform(0.85, 1.15))
    elif kind == 2:
        _blob(image[0], cy, cx, amp)
        _blob(image[1], cy, cx, amp * float(rng.choice([0.25, 2.5])))
    else:
        _blob(image[0], cy, cx, amp * 0.35)
        _blob(image[1], cy, cx, amp * 0.35)
        frame = int(rng.integers(0, 2))
        if rng.random() < 0.5:
            image[frame, int(rng.integers(0, 24)), :] += rng.uniform(0.55, 1.0)
        else:
            image[frame, int(rng.integers(0, 24)), int(rng.integers(0, 24))] = 1.0
    return np.clip(image, 0, 1)


def _planck(temp):
    wave_m = BANDS_UM.astype(np.float64) * 1e-6
    nu = 2.99792458e8 / wave_m
    x = np.clip(6.62607015e-34 * nu / (1.380649e-23 * temp), 0, 80)
    radiance = (2 * 6.62607015e-34 * nu ** 3 / 2.99792458e8 ** 2) / np.expm1(x)
    return radiance.astype(np.float32)


def normalize_sed(values):
    logged = np.log10(np.clip(values, 1e-8, None))
    logged = logged - logged.mean()
    return logged / (np.sqrt(np.mean(logged ** 2)) + 1e-6)


def _spec_sample(kind, rng):
    if kind == 0:
        sed = _planck(float(rng.uniform(3500, 9000)))
    elif kind == 1:
        sed = _planck(float(rng.uniform(350, 900)))
    elif kind == 2:
        sed = BANDS_UM ** float(rng.uniform(0.4, 1.4))
    else:
        sed = _planck(float(rng.uniform(150, 280))) + 0.15 * _planck(4000)
    sed = sed / sed.max()
    sed *= float(rng.uniform(0.7, 1.3))
    sed *= rng.normal(1, 0.05, size=6)
    return normalize_sed(sed).astype(np.float32)


def _accuracy(weights, samples, labels, kind):
    correct = 0
    for sample, label in zip(samples, labels):
        if kind == "blink":
            logits, _ = _blink_forward(sample, weights)
        else:
            logits, _ = _spec_forward(sample, weights)
        correct += int(int(logits.argmax()) == int(label))
    return correct / max(len(labels), 1)


def _adam_step(moments, weights, grads, step, lr):
    moments["t"] += 1
    t = moments["t"]
    for key, grad in grads.items():
        moments["m"][key] = 0.9 * moments["m"][key] + 0.1 * grad
        moments["v"][key] = 0.999 * moments["v"][key] + 0.001 * (grad * grad)
        mhat = moments["m"][key] / (1 - 0.9 ** t)
        vhat = moments["v"][key] / (1 - 0.999 ** t)
        weights[key] -= lr * mhat / (np.sqrt(vhat) + 1e-8)


def train(epochs=8, samples=2048, batch=64, seed=7):
    rng = np.random.default_rng(seed)
    weights = _init_weights(rng)
    grad_error = _gradient_error(weights)
    if grad_error > 0.05:
        raise RuntimeError(f"BlinkNet gradient check failed: relative error {grad_error:.3f}")

    def batch_of(kind, count):
        data, labels = [], []
        for _ in range(count):
            label = int(rng.integers(0, 4))
            data.append(_blink_sample(label, rng) if kind == "blink" else _spec_sample(label, rng))
            labels.append(label)
        return data, np.array(labels, np.int64)

    blink_val = batch_of("blink", 400)
    spec_val = batch_of("spec", 400)
    moments = {"t": 0, "m": {k: np.zeros_like(v) for k, v in weights.items()}, "v": {k: np.zeros_like(v) for k, v in weights.items()}}
    blink_acc, spec_acc = [], []
    for _ in range(epochs):
        order = rng.permutation(samples)
        labels = rng.integers(0, 4, size=samples)
        for start in range(0, samples, batch):
            idx = order[start:start + batch]
            grads = {key: np.zeros_like(value) for key, value in weights.items()}
            for sample_index in idx:
                label = int(labels[sample_index])
                blink, cache = _blink_forward(_blink_sample(label, rng), weights)
                _, grad, _ = _softmax_grad(blink, label)
                for key, value in _blink_backward(cache, grad, weights).items():
                    grads[key] += value
                spec, spec_cache = _spec_forward(_spec_sample(label, rng), weights)
                _, spec_grad, _ = _softmax_grad(spec, label)
                for key, value in _spec_backward(spec_cache, spec_grad, weights).items():
                    grads[key] += value
            for key in grads:
                grads[key] /= len(idx)
            _adam_step(moments, weights, grads, moments["t"], 0.01)
        blink_acc.append(_accuracy(weights, *blink_val, "blink"))
        spec_acc.append(_accuracy(weights, *spec_val, "spec"))
    return weights, {"gradient_relative_error": grad_error, "blink_val_accuracy": blink_acc, "spec_val_accuracy": spec_acc}


def save_weights(weights, metrics):
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    np.savez(MODEL_DIR / "nets.npz", **weights)
    (MODEL_DIR / "metrics.json").write_text(json.dumps({key: [float(v) for v in value] if isinstance(value, list) else float(value) for key, value in metrics.items()}))


def load_weights():
    global _weights
    data = np.load(MODEL_DIR / "nets.npz")
    _weights = {key: data[key] for key in data.files}
    return _weights


def ensure_trained():
    if (MODEL_DIR / "nets.npz").exists():
        return load_weights()
    weights, metrics = train()
    save_weights(weights, metrics)
    return load_weights()


def _probs(logits):
    shifted = logits - logits.max()
    probs = np.exp(shifted)
    probs /= probs.sum()
    labels = BLINK_LABELS if len(probs) == 4 and logits.shape == (4,) else SPEC_LABELS
    # Both heads have 4 classes. Caller passes the label set.
    return probs


def blink_scores(pair):
    weights = _weights or ensure_trained()
    logits, _ = _blink_forward(pair.astype(np.float32), weights)
    shifted = logits - logits.max()
    probs = np.exp(shifted)
    probs /= probs.sum()
    scores = {label: float(probs[i]) for i, label in enumerate(BLINK_LABELS)}
    label = max(scores, key=scores.get)
    return {"label": label, "scores": scores}


def spectrum_scores(sed):
    weights = _weights or ensure_trained()
    logits, _ = _spec_forward(normalize_sed(np.asarray(sed, np.float32)), weights)
    shifted = logits - logits.max()
    probs = np.exp(shifted)
    probs /= probs.sum()
    scores = {label: float(probs[i]) for i, label in enumerate(SPEC_LABELS)}
    label = max(scores, key=scores.get)
    return {"label": label, "scores": scores}


def preview_patch(png, px, py, size=24):
    image = Image.open(BytesIO(png)).convert("L")
    width, height = image.size
    cx = int(np.clip(px, 0, 1) * (width - 1))
    cy = int(np.clip(py, 0, 1) * (height - 1))
    half = 48
    if width < half * 2 or height < half * 2:
        crop = image.resize((size, size), Image.Resampling.BOX)
    else:
        left = int(np.clip(cx - half, 0, width - half * 2))
        top = int(np.clip(cy - half, 0, height - half * 2))
        crop = image.crop((left, top, left + half * 2, top + half * 2)).resize((size, size), Image.Resampling.BOX)
    return np.asarray(crop, np.float32) / 255


def _centroid(patch):
    floor = patch.min()
    weights = patch - floor
    total = float(weights.sum())
    if total < 1e-6:
        return np.array([patch.shape[1] / 2, patch.shape[0] / 2])
    yy, xx = np.mgrid[0:patch.shape[0], 0:patch.shape[1]]
    return np.array([(weights * xx).sum() / total, (weights * yy).sum() / total])


def band_fluxes(measurements):
    buckets = {f"D{i}": [] for i in range(1, 7)}
    for item in measurements:
        detector = str(item.get("detector", "")).replace("SPHEREx-", "")
        flux = item.get("flux")
        if detector in buckets and isinstance(flux, (int, float)) and np.isfinite(flux):
            buckets[detector].append(float(flux))
    present = [float(np.median(buckets[f"D{i}"])) for i in range(1, 7) if buckets[f"D{i}"]]
    fill = float(np.median(present)) if present else 0.0
    values = [float(np.median(buckets[f"D{i}"])) if buckets[f"D{i}"] else fill for i in range(1, 7)]
    return values, len(present)


def classify_measurements(measurements, previews):
    """Score a lookup. ``previews`` maps cutout URL to PNG bytes."""
    ensure_trained()
    usable = [item for item in measurements if item.get("cutout_url") in previews and item.get("preview_x") is not None]
    by_detector: dict[str, list] = {}
    for item in usable:
        by_detector.setdefault(str(item.get("detector")), []).append(item)
    pair = None
    best_gap = -1.0
    for group in by_detector.values():
        ordered = sorted(group, key=lambda item: float(item.get("time_mjd") or 0))
        if len(ordered) < 2:
            continue
        gap = float(ordered[-1]["time_mjd"]) - float(ordered[0]["time_mjd"])
        if gap > best_gap:
            best_gap = gap
            pair = (ordered[0], ordered[-1])
    blink = None
    shift = None
    if pair:
        first, last = pair
        patch_a = preview_patch(previews[first["cutout_url"]], first["preview_x"], first["preview_y"])
        patch_b = preview_patch(previews[last["cutout_url"]], last["preview_x"], last["preview_y"])
        blink = blink_scores(np.stack([patch_a, patch_b]))
        blink["detector"] = first.get("detector")
        blink["a_mjd"] = first.get("time_mjd")
        blink["b_mjd"] = last.get("time_mjd")
        delta = _centroid(patch_b) - _centroid(patch_a)
        shift = float(np.hypot(delta[0], delta[1]))
    fluxes, used = band_fluxes(measurements)
    spectrum = None
    if used >= 3:
        spectrum = spectrum_scores(fluxes)
        spectrum["bands_used"] = used
        spectrum["fluxes"] = fluxes
    notes = []
    if blink is not None and shift is not None and blink["label"] == "mover" and shift < 1:
        notes.append(
            f"The mover score is high, but the center of light only moved {shift:.1f} px, so the pictures differ by more than a clear jump."
        )
    elif blink is not None and shift is not None and blink["label"] == "settled" and shift > 2:
        notes.append(f"The settled score does not match a measured shift of {shift:.1f} px.")
    if spectrum is not None:
        notes.append("The spectrum read is the center pixel in each detector, so it includes the sky around the object.")
    return {
        "blink": blink,
        "spectrum": spectrum,
        "shift_px": shift,
        "trained_on": "synthetic cutouts and spectra",
        "notes": notes,
    }


if __name__ == "__main__":
    trained, metrics = train()
    save_weights(trained, metrics)
    print(json.dumps({key: [round(float(v), 4) for v in value] if isinstance(value, list) else round(float(value), 4) for key, value in metrics.items()}))
