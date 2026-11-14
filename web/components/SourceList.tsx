"use client";

// "What moved?" list (design doc Feature 7) with the Clean step's reject reasons (Feature 6).

import { useState } from "react";
import type { Source, SourcesResponse } from "@/lib/types";

type Props = {
  data: SourcesResponse | null;
  loading: boolean;
  error: string | null;
  selected: string | null;
  onSelect: (s: Source) => void;
  onRetry: () => void;
};

const TAG_TEXT: Record<string, string> = {
  gaia_match: "Gaia match", gaia_dark: "Gaia-dark", known_ss: "known solar system",
  artifact_risk: "artifact risk", new: "new", variable: "variable",
};

export default function SourceList({ data, loading, error, selected, onSelect, onRetry }: Props) {
  const [showRejected, setShowRejected] = useState(false);
  if (error) return (
    <div className="card elev-sm state"><span className="card-kicker">Couldn&apos;t measure sources</span><span className="card-title">{error}</span>
      <button className="btn btn-secondary" style={{ alignSelf: "flex-start" }} onClick={onRetry}>Try again</button></div>
  );
  if (loading || !data) return (
    <div className="card elev-sm state"><span className="card-kicker">Measuring</span>
      <span className="card-title">Finding every source, matching Gaia and AllWISE, fitting motion</span>
      <p className="card-body">This runs on the per-pass co-adds. The first run for a field can take a few minutes.</p></div>
  );
  const rows = data.sources.filter((s) => showRejected || !s.clean.rejected);
  const nRejected = data.sources.filter((s) => s.clean.rejected).length;
  return (
    <div className="col" style={{ gap: "var(--space-3)" }}>
      <div className="row wrap">
        <span className="small muted">{data.sources.length - nRejected} sources ranked by motion significance{data.capped ? " (capped at 200)" : ""}</span>
        <button className="toggle" aria-pressed={showRejected} onClick={() => setShowRejected((x) => !x)} style={{ marginLeft: "auto" }}>Show rejected ({nRejected})</button>
      </div>
      {data.notes.map((n) => <span key={n} className="small" style={{ color: "var(--color-accent-300)" }}>{n}</span>)}
      <div style={{ overflowX: "auto" }}>
        <table className="table" style={{ fontSize: 12 }}>
          <thead><tr><th>#</th><th>Source</th><th>Gaia</th><th>Motion ″/yr</th><th>σ</th><th>Shift px</th><th>Tags</th><th>Top class</th></tr></thead>
          <tbody>
            {rows.map((s, i) => (
              <tr key={s.id} className="src-row" aria-selected={s.id === selected} onClick={() => onSelect(s)} tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && onSelect(s)} title={s.clean.rejected ? s.clean.detail ?? "" : ""}>
                <td className="num">{i + 1}</td>
                <td className="num">{s.ra.toFixed(4)} {s.dec >= 0 ? "+" : "−"}{Math.abs(s.dec).toFixed(4)}</td>
                <td>{s.gaiaStatus === "match" ? "yes" : s.gaiaStatus === "dark" ? <span className="tag tag-accent">Gaia-dark</span> : "n/a"}</td>
                <td className="num">{s.motion ? `${s.motion.pmArcsecYr.toFixed(2)} ± ${s.motion.errArcsecYr.toFixed(2)}` : "not measured"}</td>
                <td className="num">{s.motion?.significance != null ? s.motion.significance.toFixed(1) : "–"}</td>
                <td className="num">{s.motion ? s.motion.shiftPx.toFixed(1) : "–"}</td>
                <td><div className="row wrap" style={{ gap: 3 }}>
                  {s.clean.rejected && <span className="tag tag-outline">{s.clean.reason}</span>}
                  {s.tags.map((t) => <span key={t} className="tag tag-neutral">{TAG_TEXT[t] ?? t}</span>)}
                </div></td>
                <td>{s.topClass.label} <span className="muted num">{s.topClass.score.toFixed(0)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Motion is a straight-line fit across AllWISE (2010) and the SPHEREx passes. SPHEREx alone can&apos;t measure slow motion well: under a pixel in six months. Rows are candidates, never discoveries.</p>
    </div>
  );
}
