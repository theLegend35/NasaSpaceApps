"use client";

// Class card (design doc Feature 8): label with likely/possible/unlikely and the
// word "candidate"; one bar per class; click a bar to see its parts.

import { useState } from "react";
import type { ClassifyResponse } from "@/lib/types";

export default function ClassCard({ data, loading, error }: { data: ClassifyResponse | null; loading: boolean; error: string | null }) {
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <div className="card"><span className="card-kicker">Class</span><span className="small">{error}</span></div>;
  if (loading || !data) return <div className="card"><span className="card-kicker">Class</span><span className="small muted">Scoring every class from the measurements…</span></div>;
  const d = data.decision;
  const shown = open ?? d.class;
  return (
    <div className="card elev-sm" style={{ gap: "var(--space-3)", padding: "var(--space-4)" }}>
      <span className="card-kicker">What is it? Rule scores</span>
      <span className="card-title">{d.uncertain ? "Uncertain: " : ""}{d.wording}</span>
      <span className="small muted">Score {d.score.toFixed(0)} of 100. {d.uncertain ? "Top score is low or close to the next class, so this goes to the vote queue." : ""}</span>
      <div className="col" style={{ gap: 0 }}>
        {data.scores.map((s) => (
          <div key={s.class}>
            <button className="score-btn" onClick={() => setOpen(open === s.class ? null : s.class)} aria-expanded={shown === s.class}>
              <span>{s.label}</span>
              <span className="bar-track"><span className="bar-fill" style={{ display: "block", width: `${s.score}%`, background: s.class === d.class ? "var(--color-accent-400)" : undefined }} /></span>
              <span className="num" style={{ textAlign: "right" }}>{s.score.toFixed(0)}</span>
            </button>
            {shown === s.class && (
              <ul className="small" style={{ margin: "0 0 var(--space-2)", paddingLeft: 18, color: "var(--color-neutral-300)" }}>
                {s.parts.map((p) => <li key={p.name}><span className="num">{p.points.toFixed(0)}/{p.weight}</span> · {p.text}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>
      <span className="small muted">{data.modelNote} Weights are proposals (rules.yaml). Inputs marked &quot;not measured&quot; score zero.</span>
    </div>
  );
}
