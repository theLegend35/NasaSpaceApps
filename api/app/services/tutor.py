"""AI layer: overview and tutor (design doc Feature 12).

Grounded: the model only sees a fact sheet we fetched or measured, must cite fact
IDs, and every number in its answer is checked against the facts. One regenerate;
then any sentence with an unknown number is dropped and counted.
"""
from __future__ import annotations

import re

import httpx

from ..core.errors import ApiError
from ..core.settings import get_settings

PROMPT = """You are the SolaraX tutor. Explain the selected sky object to a {level} reader.
Use ONLY the facts below. After every claim, cite the fact ID in brackets, like [F2].
If the facts don't answer the question, say so plainly. Never invent numbers.
Never call anything a discovery; call it a candidate. Keep it under 150 words.
FACTS:
{facts}
QUESTION: {question}"""

LEVELS = {"student", "volunteer", "astronomer"}
_NUM = re.compile(r"(?<![A-Za-z\[])[-+−]?\d[\d,]*(?:\.\d+)?")
_CITE = re.compile(r"\[F\d+\]")


def fact(fid: int, text: str, source: str, url: str | None = None) -> dict:
    return {"id": f"F{fid}", "text": text, "source": source, "url": url}


def fact_sheet(obj: dict) -> list[dict]:
    """Build facts from what the app already has. `obj` may contain simbad, source, classify."""
    facts: list[dict] = []
    n = 1
    sb = obj.get("simbad") or {}
    if sb.get("name"):
        facts.append(fact(n, f"SIMBAD main name: {sb['name']}", "SIMBAD", "https://simbad.cds.unistra.fr/")); n += 1
    if sb.get("otype"):
        facts.append(fact(n, f"SIMBAD object type: {sb['otype']}", "SIMBAD")); n += 1
    if sb.get("spType"):
        facts.append(fact(n, f"SIMBAD spectral type: {sb['spType']}", "SIMBAD")); n += 1
    if sb.get("pmRa") is not None:
        facts.append(fact(n, f"SIMBAD proper motion: {sb['pmRa']} mas/yr in RA, {sb['pmDec']} mas/yr in Dec", "SIMBAD")); n += 1
    src = obj.get("source") or {}
    mot = src.get("motion")
    if mot:
        facts.append(fact(n, f"Measured motion (this app): {mot['pmArcsecYr']:.2f} arcsec/yr ± {mot['errArcsecYr']:.2f}, "
                             f"significance {mot['significance']:.1f} sigma, baseline {mot['baselineYears']:.1f} years, "
                             f"shift {mot['shiftPx']:.1f} pixels", "SolaraX measurement (SPHEREx + AllWISE)")); n += 1
    if src.get("gaiaStatus") == "dark":
        facts.append(fact(n, "No Gaia DR3 source within 2 arcsec of its position", "ESA Gaia DR3")); n += 1
    elif src.get("gaia"):
        facts.append(fact(n, f"Gaia DR3 match: source {src['gaia']['sourceId']}, G = {src['gaia'].get('g')}", "ESA Gaia DR3")); n += 1
    aw = src.get("allwise")
    if aw and aw.get("w1_w2") is not None:
        facts.append(fact(n, f"AllWISE {aw['designation']}: W1 = {aw['w1']}, W2 = {aw['w2']}, W1-W2 = {aw['w1_w2']:.2f}",
                          "NASA AllWISE (IRSA)")); n += 1
    facts.append(fact(n, "SPHEREx pixels are 6.15 arcsec; SPHEREx maps the whole sky every six months in 102 bands",
                      "SPHEREx mission (IRSA)")); n += 1
    cl = obj.get("classify")
    if cl:
        d = cl["decision"]
        facts.append(fact(n, f"Rule score: {d['label']} {d['score']:.0f}/100 ({d['level']}); scores are a candidate ranking, not a confirmation",
                          "SolaraX rules (rules.yaml, PROPOSAL weights)")); n += 1
        for s in cl["scores"][:1]:
            for p in s["parts"]:
                if p["value"] is not None:
                    facts.append(fact(n, f"{s['label']} score part '{p['name']}': {p['points']:.0f} of {p['weight']} points ({p['text']})",
                                      "SolaraX rules")); n += 1
    return facts


def _numbers(text: str) -> list[float]:
    out = []
    for m in _NUM.finditer(_CITE.sub("", text)):
        s = m.group(0).replace(",", "").replace("−", "-")
        try:
            out.append(float(s))
        except ValueError:
            pass
    return out


def allowed_numbers(facts: list[dict]) -> set[float]:
    vals = set()
    for f in facts:
        for v in _numbers(f["text"]):
            vals.add(round(abs(v), 6))
    return vals


def number_ok(v: float, allowed: set[float]) -> bool:
    """A number passes if it matches a fact value, allowing the rounding a writer would do."""
    a = abs(v)
    if a in allowed or (float(a).is_integer() and a <= 3):  # small counts: '1 pixel', '2 bands'
        return True
    for x in allowed:
        if x == 0:
            continue
        if abs(a - x) <= max(0.051, 0.006 * x):  # one decimal of rounding or 0.6%
            return True
    return False


def check_numbers(answer: str, facts: list[dict]) -> tuple[str, int, list[str]]:
    """Drop sentences with numbers not in the facts. Returns (clean text, dropped count, bad numbers)."""
    allowed = allowed_numbers(facts)
    sentences = re.split(r"(?<=[.!?])\s+", answer.strip())
    kept, dropped, bad = [], 0, []
    for s in sentences:
        nums = [v for v in _numbers(s) if not number_ok(v, allowed)]
        if nums:
            dropped += 1
            bad += [str(v) for v in nums]
        else:
            kept.append(s)
    return " ".join(kept), dropped, bad


def _call_xai(prompt: str) -> str:
    s = get_settings()
    if not s.xai_api_key or not s.xai_model:
        raise ApiError("tutor_offline", "Tutor is offline (no API key). The rest of the app works.", status=503)
    try:
        r = httpx.post(f"{s.xai_base_url}/chat/completions", timeout=45,
                       headers={"Authorization": f"Bearer {s.xai_api_key}"},
                       json={"model": s.xai_model, "temperature": 0.2,
                             "messages": [{"role": "user", "content": prompt}]})
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"].strip()
    except httpx.TimeoutException as e:
        raise ApiError("tutor_timeout", "The tutor took too long. Here are the facts instead.", status=504, retryable=True) from e
    except (httpx.HTTPError, KeyError, IndexError) as e:
        raise ApiError("tutor_error", "The tutor couldn't answer right now.", status=502, retryable=True) from e


def ask(obj: dict, question: str, level: str = "student") -> dict:
    level = level if level in LEVELS else "student"
    facts = fact_sheet(obj)
    facts_txt = "\n".join(f"[{f['id']}] {f['text']} (source: {f['source']})" for f in facts)
    prompt = PROMPT.format(level=level, facts=facts_txt, question=question.strip()[:500])
    answer = _call_xai(prompt)
    clean, dropped, bad = check_numbers(answer, facts)
    if dropped:
        answer = _call_xai(prompt + "\n\nYour last answer used numbers not in the facts. Use only the facts' numbers.")
        clean, dropped, bad = check_numbers(answer, facts)
    cited = sorted(set(_CITE.findall(clean)))
    return {"answer": clean, "citations": [c.strip("[]") for c in cited], "facts": facts,
            "droppedSentences": dropped, "model": get_settings().xai_model,
            "disclaimer": "Answer generated by AI from the facts listed; check the sources."}
