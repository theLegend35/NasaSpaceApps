"use client";

import { FormEvent, useState } from "react";
import { askHelper, type HelperContext } from "../lib/helper";
import { explainTarget, fetchHorizons } from "../lib/spherex";

const PROMPTS = ["What do you see?", "Did it move?", "Which sources are here?"];

function observationDate(mjd: number) {
  return new Date((mjd - 40587) * 86_400_000).toISOString().slice(0, 10);
}

export default function HelperChat(ctx: HelperContext) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<{ role: "you" | "helper"; text: string }[]>([
    { role: "helper", text: "I look at the two cutouts with BlinkNet, then answer from the measurements and catalogs for this target." },
  ]);

  function send(question: string) {
    const text = question.trim();
    if (!text) return;
    setMessages((current) => [...current, { role: "you", text }, { role: "helper", text: askHelper(text, ctx) }]);
    setDraft("");
  }

  async function predict() {
    const times = (ctx.result?.measurements ?? []).map((item) => item.time_mjd).filter((value) => Number.isFinite(value));
    const when = times.length ? observationDate(Math.min(...times)) : new Date().toISOString().slice(0, 10);
    setMessages((current) => [...current, { role: "you", text: `Predicted position of ${ctx.name}` }]);
    try {
      const found = await fetchHorizons(ctx.name, when);
      const dec = `${found.dec >= 0 ? "+" : ""}${found.dec.toFixed(5)}`;
      setMessages((current) => [...current, {
        role: "helper",
        text: `On ${found.date}, JPL Horizons predicts ${found.name} at RA ${found.ra.toFixed(5)}°, Dec ${dec}°. ${found.note}`,
      }]);
    } catch (error) {
      setMessages((current) => [...current, {
        role: "helper",
        text: error instanceof Error ? error.message : "Horizons did not return a position.",
      }]);
    }
  }

  async function explain() {
    const frames = ctx.result?.measurements ?? [];
    const times = frames.map((item) => item.time_mjd).filter((value) => Number.isFinite(value));
    setMessages((current) => [...current, { role: "you", text: "Explain this target with AI" }]);
    try {
      const text = await explainTarget({
        target: ctx.name,
        ra_deg: ctx.ra,
        dec_deg: ctx.dec,
        images_found: ctx.result?.images_found ?? 0,
        images_measured: frames.length,
        first_image: times.length ? observationDate(Math.min(...times)) : null,
        last_image: times.length ? observationDate(Math.max(...times)) : null,
        images_with_quality_flag: frames.filter((item) => item.flag !== 0).length,
        blinknet: ctx.score?.blink ?? null,
        center_shift_px: ctx.score?.shift_px ?? null,
        specnet: ctx.score?.spectrum ?? null,
        notes: ctx.score?.notes ?? [],
        gaia_stars_in_field: ctx.catalogs?.gaia.length ?? null,
        allwise_sources_in_field: ctx.catalogs?.wise.length ?? null,
      });
      setMessages((current) => [...current, { role: "helper", text: `Gemini, from the measurements above: ${text}` }]);
    } catch (error) {
      setMessages((current) => [...current, { role: "helper", text: error instanceof Error ? error.message : "The AI summary did not answer." }]);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    send(draft);
  }

  return (
    <section className="tv-help" aria-label="Sky helper">
      <h3>Helper</h3>
      <div className="tv-help-log">
        {messages.map((message, index) => (
          <p key={index} className={message.role === "you" ? "tv-help-q" : "tv-help-a"}>{message.text}</p>
        ))}
      </div>
      <div className="tv-chips">
        {PROMPTS.map((prompt) => (
          <button key={prompt} type="button" onClick={() => send(prompt)}>{prompt}</button>
        ))}
        <button type="button" onClick={() => void predict()}>Predicted position</button>
        <button type="button" onClick={() => void explain()}>Explain with AI</button>
      </div>
      <form className="tv-help-row" onSubmit={onSubmit}>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask about this target" aria-label="Ask the helper" />
        <button type="submit" className="tv-btn">Ask</button>
      </form>
    </section>
  );
}
