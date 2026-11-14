"use client";

// Learn mission runner (design doc Feature 11). Missions are data (content/missions/*.json);
// the runner sets the view for each step and checks answers against live app state.

import { useEffect, useState } from "react";
import { ArrowRight, Lightbulb } from "@phosphor-icons/react";
import type { PlayerSettings } from "./BlinkPlayer";
import type { Source, SourcesResponse } from "@/lib/types";
import { MISSIONS, type Mission, type Step } from "@/content/missions";

export type MissionHooks = {
  state: { sel: { name: string | null } | null; tab: string; settings: PlayerSettings; src: string | null; sources: SourcesResponse | null; panel: string };
  goTo: (q: string, mode: "compact" | "deep") => void;
  setTab: (t: string) => void;
  setSettings: (s: Partial<PlayerSettings>) => void;
};

function check(step: Step, h: MissionHooks, choice: string | null): boolean | null {
  const t = step.task;
  const s = h.state;
  switch (t.type) {
    case "read": return null;
    case "toggle": return Object.entries(t.expect).every(([k, v]) => (s.settings as Record<string, unknown>)[k] === v);
    case "open-tab": return s.tab === t.tab && s.panel === "deep";
    case "choose": return choice === null ? null : choice === t.answer;
    case "select-source": {
      const src: Source | undefined = s.sources?.sources.find((x) => x.id === s.src);
      if (!src) return null;
      return t.tags.every((tag) => src.tags.includes(tag)) && (src.motion?.significance ?? 0) >= (t.minSignificance ?? 0);
    }
  }
}

export default function MissionRunner({ id, hooks }: { id: string; hooks: MissionHooks }) {
  const m: Mission | undefined = MISSIONS.find((x) => x.id === id);
  const [i, setI] = useState(0);
  const [hint, setHint] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const step = m?.steps[i];

  // Move the app to this step's view.
  useEffect(() => {
    if (!m || !step?.view) return;
    const v = step.view;
    if (v.target && hooks.state.sel?.name !== v.target) hooks.goTo(v.target, v.panel ?? "deep");
    if (v.tab) hooks.setTab(v.tab);
    if (v.settings) hooks.setSettings(v.settings);
    setHint(false);
    setChoice(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, m]);

  if (!m || !step) return null;
  const ok = check(step, hooks, choice);
  const done = i === m.steps.length - 1;
  try { localStorage.setItem(`mission:${m.id}`, String(i)); } catch { /* private mode */ }

  return (
    <div className="card mission-card" role="dialog" aria-label={`Mission: ${m.title}`}>
      <div className="row"><span className="card-kicker grow">Mission · {m.title}</span><span className="small muted num">Step {i + 1} of {m.steps.length}</span></div>
      <div className="bar-track"><div className="bar-fill" style={{ width: `${((i + 1) / m.steps.length) * 100}%` }} /></div>
      <p style={{ margin: 0, fontSize: 14 }}>{step.text}</p>
      {step.task.type === "choose" && (
        <div className="row wrap">{step.task.options.map((o) => (
          <button key={o} className="toggle" aria-pressed={choice === o} onClick={() => setChoice(o)}>{o}</button>
        ))}</div>
      )}
      {ok === true && step.why && <span className="small" style={{ color: "var(--color-accent-300)" }}>Right. {step.why}</span>}
      {ok === false && step.task.type === "choose" && <span className="small" style={{ color: "var(--color-accent-300)" }}>Not quite. {step.hint}</span>}
      {hint && <span className="small muted">{step.hint}</span>}
      <div className="row">
        <button className="btn btn-ghost small" onClick={() => setHint(true)}><Lightbulb />Hint</button>
        <span className="grow" />
        {i > 0 && <button className="btn btn-secondary small" onClick={() => setI(i - 1)}>Back</button>}
        {!done
          ? <button className="btn btn-primary small" disabled={ok === false || (ok === null && step.task.type !== "read")} onClick={() => setI(i + 1)}>Next<ArrowRight /></button>
          : <a className="btn btn-primary small" href="/learn">Finish</a>}
      </div>
    </div>
  );
}
