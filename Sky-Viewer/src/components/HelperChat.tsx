"use client";

import { FormEvent, useState } from "react";
import { askHelper, type HelperContext } from "../lib/helper";
import { fetchHorizons } from "../lib/spherex";

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
      </div>
      <form className="tv-help-row" onSubmit={onSubmit}>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask about this target" aria-label="Ask the helper" />
        <button type="submit" className="tv-btn">Ask</button>
      </form>
    </section>
  );
}
