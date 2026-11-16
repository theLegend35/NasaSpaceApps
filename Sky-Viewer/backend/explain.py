"""Plain-language summary of one target's measurements, written by Gemini.

The key comes from the GEMINI_API_KEY environment variable and is never stored in the repo.
The model only sees the numbers this app already measured, and is told to stay inside them.
"""
import json
import os

import requests

MODEL = os.getenv("GEMINI_MODEL", "gemini-flash-latest")
RULES = (
    "You explain infrared sky measurements from NASA's SPHEREx mission to a curious visitor. "
    "Use only the facts in the JSON below. If a fact is missing, say it is not measured yet. "
    "BlinkNet and SpecNet are small neural networks trained on synthetic examples, so call their labels "
    "candidates and never a discovery. Write 3 or 4 short sentences in plain words, then one line that "
    "starts with 'Try next:' and names one thing to do in the viewer (Blink, Subtract, Heatmap, Spectrum, "
    "or another detector)."
)


def explain(facts: dict) -> str:
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise LookupError("The AI summary is not switched on for this server.")
    response = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
        headers={"x-goog-api-key": key},
        json={
            "contents": [{"parts": [{"text": f"{RULES}\n\nFacts:\n{json.dumps(facts)[:6000]}"}]}],
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 1024},
        },
        timeout=40,
    )
    response.raise_for_status()
    parts = response.json()["candidates"][0]["content"]["parts"]
    return "".join(part.get("text", "") for part in parts).strip()
