"use client";

// Spectrum on click (design doc Feature 4). Plain SVG so we can draw upper-limit
// arrows and the shaded molecule windows exactly as specified.

import { useMemo, useState } from "react";
import { DownloadSimple } from "@phosphor-icons/react";
import type { SpecPoint, SpectrumResponse } from "@/lib/types";

const W = 640, H = 300, L = 56, R = 12, T = 14, B = 40;
const XMIN = 0.75, XMAX = 5.0;
// Labelled windows from the design doc.
const WINDOWS: [number, number, string][] = [[1.33, 1.47, "H₂O"], [1.82, 1.98, "H₂O"], [3.2, 3.45, "CH₄"], [4.2, 4.4, "CO₂"]];

export default function SpectrumChart({ data, loading, error, onRetry }: {
  data: SpectrumResponse | null; loading: boolean; error: string | null; onRetry: () => void;
}) {
  const [log, setLog] = useState(true);
  const pts: SpecPoint[] = useMemo(() => (data ? (data.binned ?? data.points) : []), [data]);

  const yr = useMemo(() => {
    const v = pts.map((p) => p.fluxUjy).filter((x) => (log ? x > 0 : Number.isFinite(x)));
    if (!v.length) return [1, 10];
    let lo = Math.min(...v), hi = Math.max(...v);
    if (log) { lo = Math.log10(lo) - 0.2; hi = Math.log10(hi) + 0.2; } else { const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad; }
    return [lo, hi];
  }, [pts, log]);

  if (error) return (
    <div className="card elev-sm state"><span className="card-kicker">Spectrum</span><span className="card-title">{error}</span>
      <button className="btn btn-secondary" style={{ alignSelf: "flex-start" }} onClick={onRetry}>Try again</button></div>
  );
  if (loading || !data) return (
    <div className="card elev-sm state"><span className="card-kicker">Measuring</span>
      <span className="card-title">Measuring every exposure that covers this source…</span>
      <p className="card-body">Each exposure sees it at a different wavelength. Bright points are measurements; down arrows are upper limits.</p></div>
  );

  const x = (l: number) => L + ((l - XMIN) / (XMAX - XMIN)) * (W - L - R);
  const y = (f: number) => {
    const v = log ? Math.log10(Math.max(f, 1e-9)) : f;
    return T + (1 - (v - yr[0]) / (yr[1] - yr[0])) * (H - T - B);
  };
  const ticksX = [1, 2, 3, 4, 5];
  const ticksY = log
    ? Array.from({ length: Math.floor(yr[1]) - Math.ceil(yr[0]) + 1 }, (_, i) => Math.ceil(yr[0]) + i)
    : [0, 0.25, 0.5, 0.75, 1].map((k) => yr[0] + k * (yr[1] - yr[0]));

  const csv = () => {
    const rows = ["lambda_um,bandwidth_um,flux_ujy,err_ujy,upper_limit,detector,date_utc",
      ...data.points.map((p) => [p.lambdaUm, p.bandwidthUm ?? "", p.fluxUjy, p.errUjy, p.upperLimit, p.detector, p.dateIso].join(","))];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "solarax-spectrum.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const s = data.summary;
  return (
    <div className="col" style={{ gap: "var(--space-3)" }}>
      <div className="row wrap">
        <span className="small">{data.binnedTo102 ? "102 channels" : `${s.nExposures} exposures`}: {s.nMeasured} measured, {s.nUpperLimits} upper limits{s.nDropped ? `, ${s.nDropped} dropped (flagged or failed)` : ""}</span>
        <div className="seg" style={{ marginLeft: "auto" }}>
          <label className="seg-opt"><input type="radio" name="yscale" checked={log} onChange={() => setLog(true)} />Log</label>
          <label className="seg-opt"><input type="radio" name="yscale" checked={!log} onChange={() => setLog(false)} />Linear</label>
        </div>
        <button className="btn btn-secondary small" onClick={csv}><DownloadSimple />CSV</button>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Brightness against wavelength" style={{ width: "100%", height: "auto" }}>
        {WINDOWS.map(([a, b, n], i) => (
          <g key={i}>
            <rect x={x(a)} y={T} width={x(b) - x(a)} height={H - T - B} fill="var(--color-accent-900)" />
            <text x={(x(a) + x(b)) / 2} y={T + 12} textAnchor="middle" fontSize="11" fill="var(--color-accent-300)">{n}</text>
          </g>
        ))}
        <line x1={L} y1={H - B} x2={W - R} y2={H - B} stroke="var(--color-divider)" />
        <line x1={L} y1={T} x2={L} y2={H - B} stroke="var(--color-divider)" />
        {ticksX.map((t) => <text key={t} x={x(t)} y={H - B + 16} textAnchor="middle" fontSize="11" fill="var(--color-neutral-400)">{t}</text>)}
        <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--color-neutral-400)">Wavelength (µm)</text>
        {ticksY.map((t) => (
          <text key={t} x={L - 6} y={y(log ? 10 ** t : t) + 4} textAnchor="end" fontSize="10" fill="var(--color-neutral-400)">
            {log ? `10${superscript(t)}` : t.toPrecision(2)}
          </text>
        ))}
        <text transform={`translate(12 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle" fontSize="11" fill="var(--color-neutral-400)">Flux (µJy)</text>
        {pts.map((p, i) => p.upperLimit ? (
          <g key={i} stroke="var(--color-neutral-500)" fill="var(--color-neutral-500)">
            <line x1={x(p.lambdaUm)} y1={y(p.fluxUjy)} x2={x(p.lambdaUm)} y2={y(p.fluxUjy) + 9} />
            <path d={`M${x(p.lambdaUm) - 2.5},${y(p.fluxUjy) + 7} L${x(p.lambdaUm)},${y(p.fluxUjy) + 11} L${x(p.lambdaUm) + 2.5},${y(p.fluxUjy) + 7}`} fill="none" />
          </g>
        ) : (
          <g key={i}>
            <line x1={x(p.lambdaUm)} x2={x(p.lambdaUm)} y1={y(p.fluxUjy + p.errUjy)} y2={y(Math.max(p.fluxUjy - p.errUjy, log ? p.fluxUjy / 3 : p.fluxUjy - p.errUjy))} stroke="var(--color-accent-500)" strokeWidth="1" />
            <circle cx={x(p.lambdaUm)} cy={y(p.fluxUjy)} r="2.6" fill="var(--color-accent-300)" />
          </g>
        ))}
      </svg>
      <div className="row wrap small">
        {Object.entries(data.indices).filter(([, v]) => v != null).map(([k, v]) => (
          <span key={k} className="tag tag-neutral num">{k.replace(/_/g, " ")}: {(v as number).toFixed(2)}</span>
        ))}
        {Object.values(data.indices).every((v) => v == null) && <span className="muted">Indices not measured: no points in both windows yet.</span>}
      </div>
      {data.templateFits.length ? (
        <span className="small">Best template: {data.templateFits[0].template} (reduced χ² {data.templateFits[0].redChi2.toFixed(2)})</span>
      ) : <span className="small muted">Template overlays appear once the template files are added (api/data/templates).</span>}
      {data.caveats.map((c) => <span key={c} className="small muted">{c}</span>)}
      <span className="small muted">Method: {data.method}.</span>
    </div>
  );
}

function superscript(n: number) {
  const m: Record<string, string> = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
  return String(n).split("").map((c) => m[c] ?? c).join("");
}
