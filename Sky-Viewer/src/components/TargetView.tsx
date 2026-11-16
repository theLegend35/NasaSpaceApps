"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, ArrowRight, Link2, Pause, Play, RotateCcw, Share2, SkipBack, SkipForward } from "lucide-react";
import { formatMjd, formatNumber, type LookupResponse, type Measurement } from "../lib/spherex";

type TargetViewProps = {
  targetName: string;
  targetDescription: string;
  ra: number;
  dec: number;
  result: LookupResponse | null;
  cacheHit: boolean;
  error: string;
  loading: boolean;
  progressText: string;
  statusMessage: string;
  onLoadObservations: () => void;
};

type Tab = "blink" | "spectrum" | "data";
type Mode = "time" | "blink" | "sub" | "add" | "heat";

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "time", label: "Timelapse", hint: "Play every image in date order." },
  { id: "blink", label: "Blink", hint: "Flip between A and B so anything that moved or changed jumps out." },
  { id: "sub", label: "Subtract", hint: "B minus A. Grey means no change; lighter is brighter in B, darker is dimmer." },
  { id: "add", label: "Add", hint: "A and B averaged together for a cleaner, deeper image." },
  { id: "heat", label: "Heatmap", hint: "Red got brighter from A to B, blue got dimmer. A moving object shows as a blue and red pair." },
];
const DETECTORS = ["D1", "D2", "D3", "D4", "D5", "D6"];
const DAY_MS = 86_400_000;

const detectorOf = (m: Measurement) => m.detector.replace(/^SPHEREx-/i, "");
const previewUrl = (m: Measurement) => `/api/point/image?cutout_url=${encodeURIComponent(m.cutout_url)}`;
const mjdDate = (mjd: number) => new Date((mjd - 40587) * DAY_MS);
function shortDate(mjd: number) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "2-digit" }).format(mjdDate(mjd));
}

/** Combine two greyscale previews pixel by pixel (Subtract / Add / Heatmap). */
function useComposite(a: Measurement | undefined, b: Measurement | undefined, mode: Mode) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const active = mode === "sub" || mode === "add" || mode === "heat";
  const aUrl = a ? previewUrl(a) : null;
  const bUrl = b ? previewUrl(b) : null;

  useEffect(() => {
    if (!active || !aUrl || !bUrl) { setSrc(null); return; }
    let cancelled = false;
    setFailed(false);
    const load = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
    Promise.all([load(aUrl), load(bUrl)]).then(([imgA, imgB]) => {
      if (cancelled) return;
      const size = 256;
      const read = (img: HTMLImageElement) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, size, size);
        return ctx.getImageData(0, 0, size, size).data;
      };
      const A = read(imgA), B = read(imgB);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      const out = ctx.createImageData(size, size);
      for (let i = 0; i < A.length; i += 4) {
        const va = A[i], vb = B[i];
        let r: number, g: number, bl: number;
        if (mode === "sub") {
          r = g = bl = 128 + (vb - va) * 1.5;
        } else if (mode === "add") {
          r = g = bl = (va + vb) * 0.6;
        } else {
          const d = (vb - va) / 255;
          const t = Math.pow(Math.min(1, Math.abs(d) * 2.2), 0.7);
          const hot = d > 0 ? [255, 70, 60] : [60, 110, 255];
          const base = [22, 24, 38];
          r = base[0] + (hot[0] - base[0]) * t;
          g = base[1] + (hot[1] - base[1]) * t;
          bl = base[2] + (hot[2] - base[2]) * t;
        }
        out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = bl; out.data[i + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      setSrc(canvas.toDataURL("image/png"));
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [active, aUrl, bUrl, mode]);

  return { src: active ? src : null, failed: active && failed };
}

export default function TargetView({
  targetName, targetDescription, ra, dec, result, cacheHit, error, loading, progressText, statusMessage, onLoadObservations,
}: TargetViewProps) {
  const [tab, setTab] = useState<Tab>("blink");
  const [mode, setMode] = useState<Mode>("time");
  const [detector, setDetector] = useState<string>("all");
  const [frame, setFrame] = useState(0);
  const [aIdx, setAIdx] = useState(0);
  const [bIdx, setBIdx] = useState(0);
  const [side, setSide] = useState<"a" | "b">("a");
  const [playing, setPlaying] = useState(false);
  const [blinking, setBlinking] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [orbit, setOrbit] = useState(-12);
  const [tilt, setTilt] = useState(8);
  const [copied, setCopied] = useState(false);
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);

  const allFrames = useMemo(
    () => (result ? [...result.measurements].sort((x, y) => x.time_mjd - y.time_mjd) : []),
    [result],
  );
  const presentDetectors = useMemo(() => new Set(allFrames.map(detectorOf)), [allFrames]);
  const frames = useMemo(
    () => (detector === "all" ? allFrames : allFrames.filter((m) => detectorOf(m) === detector)),
    [allFrames, detector],
  );
  const count = frames.length;

  // Reset the view whenever a new lookup result or detector filter arrives.
  useEffect(() => {
    setFrame(0);
    setAIdx(0);
    setBIdx(Math.max(0, frames.length - 1));
    setSide("a");
    setPlaying(false);
    setBlinking(false);
  }, [frames]);

  useEffect(() => {
    if (count < 2) return;
    if (mode === "time" && playing) {
      const timer = window.setInterval(() => setFrame((f) => (f + 1) % count), 1000 / speed);
      return () => window.clearInterval(timer);
    }
    if (mode === "blink" && blinking) {
      const timer = window.setInterval(() => setSide((s) => (s === "a" ? "b" : "a")), 1000 / speed);
      return () => window.clearInterval(timer);
    }
  }, [mode, playing, blinking, speed, count]);

  const shownIndex = mode === "time" ? frame : mode === "blink" ? (side === "a" ? aIdx : bIdx) : aIdx;
  const shown = frames[shownIndex];
  const frameA = frames[aIdx];
  const frameB = frames[bIdx];
  const composite = useComposite(frameA, frameB, mode);
  const isCompare = mode === "sub" || mode === "add" || mode === "heat";
  const stageSrc = isCompare ? composite.src : shown ? previewUrl(shown) : null;

  const visits = useMemo(() => {
    const groups: { day: number; start: number; size: number }[] = [];
    frames.forEach((m, index) => {
      const day = Math.floor(m.time_mjd);
      const last = groups[groups.length - 1];
      if (last && day - last.day <= 1) last.size += 1;
      else groups.push({ day, start: index, size: 1 });
    });
    return groups;
  }, [frames]);

  const gapDays = frameA && frameB ? Math.round(Math.abs(frameB.time_mjd - frameA.time_mjd)) : 0;
  const viewPath = `/?ra=${ra.toFixed(3)}&dec=${dec.toFixed(3)}`;

  function selectFrame(index: number) {
    setPlaying(false);
    if (mode === "time") setFrame(index);
    else if (mode === "blink") { setBlinking(false); if (side === "a") setAIdx(index); else setBIdx(index); }
    else setBIdx(index);
  }

  function chooseMode(next: Mode) {
    if (mode === "time" && next !== "time") setAIdx(frame);
    setMode(next);
    setPlaying(false);
    setBlinking(false);
  }

  async function copyLink() {
    const url = new URL(viewPath, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked: the link text stays visible to copy by hand */ }
  }

  async function share() {
    const url = new URL(viewPath, window.location.origin).toString();
    if (navigator.share) {
      try { await navigator.share({ title: `${targetName} · Sky Timeline`, url }); return; } catch { /* fall back to copy */ }
    }
    void copyLink();
  }

  function startTiltDrag(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button,a,input")) return;
    const startX = event.clientX, startY = event.clientY, o0 = orbit, t0 = tilt;
    const el = event.currentTarget;
    el.setPointerCapture(event.pointerId);
    const move = (ev: PointerEvent) => {
      setOrbit(Math.max(-40, Math.min(40, o0 + (ev.clientX - startX) * 0.25)));
      setTilt(Math.max(-30, Math.min(30, t0 - (ev.clientY - startY) * 0.25)));
    };
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  return (
    <aside className="target-view" id="target-panel" aria-label="Target view">
      <div className="tv-head">
        <div className="tv-head-text">
          <p className="eyebrow">Target view</p>
          <h2>{targetName}</h2>
          <p>RA {ra.toFixed(3)}° · Dec {dec >= 0 ? "+" : "−"}{Math.abs(dec).toFixed(3)}° · {targetDescription}</p>
        </div>
        <button type="button" className="tv-btn" onClick={() => void share()}><Share2 size={16} /> Share</button>
      </div>

      <div className="tv-link">
        <Link2 size={14} aria-hidden="true" />
        <span>…{viewPath}</span>
        <button type="button" className="tv-ghost" onClick={() => void copyLink()}>{copied ? "Link copied" : "Copy view link"}</button>
      </div>

      <div className="tv-tabs" role="tablist" aria-label="Target view sections">
        {(["blink", "spectrum", "data"] as Tab[]).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "is-on" : ""} onClick={() => setTab(id)}>
            {id === "blink" ? "Blink" : id === "spectrum" ? "Spectrum" : "Data"}
          </button>
        ))}
      </div>

      {error && <div className="notice" role="alert">{error}</div>}

      {!result ? (
        <div className="tv-empty">
          <strong>{loading ? progressText : "No observations loaded yet"}</strong>
          <span>{loading ? "This can take a minute while IRSA searches and each cutout is measured." : statusMessage || "Load the SPHEREx images that cover this spot to compare them over time."}</span>
          <button type="button" className="load-button" disabled={loading} onClick={onLoadObservations}>
            {loading ? <><span className="button-spinner" aria-hidden="true" /> Loading…</> : <>Load observations <ArrowRight size={16} /></>}
          </button>
        </div>
      ) : count === 0 ? (
        <div className="tv-empty">
          <strong>No measured images</strong>
          <span>IRSA found {result.images_found} images here, but none could be measured{detector !== "all" ? ` in ${detector}` : ""}.</span>
        </div>
      ) : tab === "blink" ? (
        <>
          <div className="tv-seg" role="group" aria-label="Comparison mode">
            {MODES.map((m) => (
              <button key={m.id} type="button" title={m.hint} aria-pressed={mode === m.id} onClick={() => chooseMode(m.id)}>{m.label}</button>
            ))}
          </div>
          <p className="tv-hint">{MODES.find((m) => m.id === mode)?.hint}</p>

          <div className="tv-stage" onPointerDown={startTiltDrag}>
            <div className="tv-scene" style={{ transform: `rotateX(${tilt}deg) rotateY(${orbit}deg)` }}>
              <div className="tv-card">
                <div className="tv-card-top">
                  <span>{isCompare ? `${shortDate(frameA.time_mjd)} → ${shortDate(frameB.time_mjd)}` : formatMjd(shown.time_mjd)}</span>
                  <span className="tv-tag">{isCompare ? `A vs B` : `Image ${shownIndex + 1} of ${count}`}</span>
                </div>
                <div className="tv-image">
                  {stageSrc && brokenSrc !== stageSrc ? (
                    <img src={stageSrc} alt={`SPHEREx ${isCompare ? MODES.find((m) => m.id === mode)?.label.toLowerCase() : "cutout"} for ${targetName}`} onError={() => setBrokenSrc(stageSrc)} draggable={false} />
                  ) : (
                    <span className="tv-noimg">{composite.failed || brokenSrc === stageSrc ? "Preview not available" : "Preparing image…"}</span>
                  )}
                  <span className="tv-cross" style={{ left: `${(shown ?? frameA).preview_x * 100}%`, top: `${(shown ?? frameA).preview_y * 100}%` }} aria-hidden="true" />
                  {mode === "blink" && <span className="tv-side">{side.toUpperCase()}</span>}
                  <span className="tv-band">{detectorOf(shown)} · {shown.wavelength_um.toFixed(2)} µm</span>
                </div>
              </div>
            </div>
            <button type="button" className="tv-icon tv-reset" title="Face the image straight on" aria-label="Reset tilt" onClick={() => { setOrbit(0); setTilt(0); }}><RotateCcw size={16} /></button>
            {mode !== "time" && (
              <div className="tv-thumbs">
                {(["a", "b"] as const).map((key) => {
                  const m = key === "a" ? frameA : frameB;
                  const on = mode === "blink" ? side === key : true;
                  return (
                    <button key={key} type="button" className={on ? "is-on" : ""} title={`Show image ${key.toUpperCase()} · ${formatMjd(m.time_mjd)}`} onClick={() => { setBlinking(false); setMode("blink"); setSide(key); }}>
                      <img src={previewUrl(m)} alt="" draggable={false} />
                      <span>{key.toUpperCase()}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <span className="tv-drag">Drag to tilt</span>
          </div>

          {mode === "heat" && (
            <div className="tv-legend" aria-label="Heatmap scale"><span>Dimmer in B</span><i /><span>Brighter in B</span></div>
          )}

          <div className="tv-controls">
            {mode === "time" && (
              <div className="transport-controls">
                <button type="button" aria-label="Previous image" disabled={count < 2} onClick={() => { setPlaying(false); setFrame((f) => (f - 1 + count) % count); }}><SkipBack size={17} /></button>
                <button type="button" className="play-button" aria-label={playing ? "Pause" : "Play"} disabled={count < 2} onClick={() => setPlaying((p) => !p)}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
                <button type="button" aria-label="Next image" disabled={count < 2} onClick={() => { setPlaying(false); setFrame((f) => (f + 1) % count); }}><SkipForward size={17} /></button>
              </div>
            )}
            <button
              type="button"
              className={`tv-blink${mode === "blink" && blinking ? " is-on" : ""}`}
              disabled={count < 2}
              onClick={() => { if (mode !== "blink") chooseMode("blink"); setBlinking((b) => (mode === "blink" ? !b : true)); }}
            >
              <ArrowLeftRight size={17} /> {mode === "blink" && blinking ? "Stop blinking" : "Blink A ⇄ B"}
            </button>
            <label className="tv-speed">
              <span>Speed · {speed} per second</span>
              <input type="range" min="0.5" max="4" step="0.5" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
            </label>
          </div>

          <div className="tv-ticks" aria-label="Images by date">
            {visits.map((visit) => (
              <div key={visit.start} className="tv-visit" style={{ flexGrow: visit.size }}>
                <div className="tv-visit-bars">
                  {frames.slice(visit.start, visit.start + visit.size).map((m, offset) => {
                    const index = visit.start + offset;
                    const current = index === shownIndex;
                    const badge = mode !== "time" ? (index === aIdx ? "A" : index === bIdx ? "B" : "") : "";
                    return (
                      <button key={index} type="button" title={`${formatMjd(m.time_mjd)} · ${detectorOf(m)} · ${m.wavelength_um.toFixed(2)} µm`} aria-label={`Image ${index + 1}, ${formatMjd(m.time_mjd)}`} aria-current={current} className={current ? "is-on" : ""} onClick={() => selectFrame(index)}>
                        <span className="tv-badge">{badge}</span>
                        <span className="tv-bar" />
                      </button>
                    );
                  })}
                </div>
                <span className="tv-visit-date">{shortDate(visit.day)}</span>
              </div>
            ))}
          </div>
          <span className="tv-hint">Click a bar to jump to that image{mode !== "time" ? " (sets B; use the A/B buttons below to change A)" : ""}.</span>

          <div className="tv-grid">
            <span>Infrared range</span>
            <div className="tv-seg tv-seg-sm" role="group" aria-label="Detector">
              <button type="button" aria-pressed={detector === "all"} onClick={() => setDetector("all")}>All</button>
              {DETECTORS.map((d) => (
                <button key={d} type="button" aria-pressed={detector === d} disabled={!presentDetectors.has(d)} title={presentDetectors.has(d) ? undefined : "Not in this lookup"} onClick={() => setDetector(d)}>{d}</button>
              ))}
            </div>
            <span>This image</span>
            <span className="tv-facts">
              <span>{shown.wavelength_um.toFixed(3)} µm</span>
              <span>Flux {formatNumber(shown.flux)} {shown.flux_unit}</span>
              <span className={shown.flag === 0 ? "quality-clear" : "quality-flagged"}>{shown.flag === 0 ? "Quality clear" : `Quality flag ${shown.flag}`}</span>
            </span>
          </div>

          {mode !== "time" && (
            <p className="tv-compare">
              Comparing <strong>A</strong> {formatMjd(frameA.time_mjd)} with <strong>B</strong> {formatMjd(frameB.time_mjd)}, {gapDays} {gapDays === 1 ? "day" : "days"} apart.
              {detectorOf(frameA) !== detectorOf(frameB) || Math.abs(frameA.wavelength_um - frameB.wavelength_um) > 0.05
                ? ` They were taken at different wavelengths (${frameA.wavelength_um.toFixed(2)} and ${frameB.wavelength_um.toFixed(2)} µm), so a change can be color rather than time.`
                : ""}
            </p>
          )}

          <div className="tv-actions">
            <button type="button" className="tv-btn" onClick={() => setAIdx(shownIndex)}>Use this image as A</button>
            <button type="button" className="tv-btn" onClick={() => setBIdx(shownIndex)}>Use as B</button>
            <a className="tv-btn" href={shown.cutout_url} target="_blank" rel="noreferrer">Open FITS cutout <ArrowRight size={15} /></a>
          </div>
        </>
      ) : tab === "spectrum" ? (
        <Spectrum frames={allFrames} current={shown} onPick={(m) => { setDetector("all"); setMode("time"); setTab("blink"); setFrame(allFrames.indexOf(m)); }} />
      ) : (
        <DataTable frames={frames} current={shown} onPick={(index) => { setMode("time"); setTab("blink"); setFrame(index); }} />
      )}

      {result && (
        <p className="result-caption">
          {result.images_found} images found · {allFrames.length} measured · source {result.discovery_source}
          {cacheHit ? " · from Redis cache" : " · saved in Redis"}
        </p>
      )}
    </aside>
  );
}

function niceTicks(min: number, max: number, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const step0 = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= step0) ?? step0;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(6)));
  return { lo, hi, ticks };
}

function Spectrum({ frames, current, onPick }: { frames: Measurement[]; current: Measurement | undefined; onPick: (m: Measurement) => void }) {
  const [hover, setHover] = useState<Measurement | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const points = frames.filter((m) => m.flux !== null && Number.isFinite(m.flux));
  if (points.length === 0) return <div className="tv-empty"><strong>No flux values to plot</strong></div>;

  const W = 600, H = 300, L = 62, R = 16, T = 16, B = 40;
  const fluxes = points.map((m) => m.flux as number);
  const y = niceTicks(Math.min(...fluxes), Math.max(...fluxes));
  const waves = points.map((m) => m.wavelength_um);
  const x = niceTicks(Math.min(...waves), Math.max(...waves), 5);
  const xMin = x.lo, xMax = x.hi;
  const px = (w: number) => L + ((w - xMin) / (xMax - xMin)) * (W - L - R);
  const py = (f: number) => T + (1 - (f - y.lo) / (y.hi - y.lo)) * (H - T - B);
  const unit = points[0].flux_unit || "flux";
  const fmt = (v: number) => (Math.abs(v) >= 0.01 && Math.abs(v) < 1000 ? Number(v.toPrecision(3)).toString() : v.toExponential(1));

  return (
    <div className="tv-spectrum">
      <p className="tv-hint">Brightness at this position in every image, by wavelength. Click a point to open that image.</p>
      <div className="tv-chart" ref={wrapRef}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Spectrum: flux in ${unit} against wavelength, ${points.length} measurements`}>
          {y.ticks.map((t) => (
            <g key={t}>
              <line className="tv-grid-line" x1={L} x2={W - R} y1={py(t)} y2={py(t)} />
              <text className="tv-axis" x={L - 8} y={py(t) + 4} textAnchor="end">{fmt(t)}</text>
            </g>
          ))}
          {x.ticks.map((w, i) => (
            <text key={w} className="tv-axis" x={px(w)} y={H - B + 18} textAnchor={i === 0 ? "start" : i === x.ticks.length - 1 ? "end" : "middle"}>{w} µm</text>
          ))}
          <line className="tv-axis-line" x1={L} x2={W - R} y1={H - B} y2={H - B} />
          <text className="tv-axis" x={L} y={H - 4}>Wavelength</text>
          <text className="tv-axis" x={12} y={T + 4} transform={`rotate(-90 12 ${T + 4})`} textAnchor="end">{unit}</text>
          {points.map((m, i) => (
            <circle
              key={i}
              className={`tv-dot${m === current ? " is-on" : ""}`}
              cx={px(m.wavelength_um)}
              cy={py(m.flux as number)}
              r={m === current ? 6 : 4}
              onMouseEnter={() => setHover(m)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onPick(m)}
            />
          ))}
        </svg>
        {hover && (
          <div className="tv-tip" style={{ left: `${(px(hover.wavelength_um) / W) * 100}%`, top: `${(py(hover.flux as number) / H) * 100}%` }}>
            <strong>{hover.wavelength_um.toFixed(3)} µm · {detectorOf(hover)}</strong>
            <span>{formatNumber(hover.flux)} {hover.flux_unit}</span>
            <span>{formatMjd(hover.time_mjd)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function DataTable({ frames, current, onPick }: { frames: Measurement[]; current: Measurement | undefined; onPick: (index: number) => void }) {
  return (
    <div className="tv-table">
      <table>
        <thead>
          <tr><th>#</th><th>Date</th><th>Detector</th><th>Wavelength</th><th>Flux</th><th>σ</th><th>Flag</th></tr>
        </thead>
        <tbody>
          {frames.map((m, index) => (
            <tr key={index} className={m === current ? "is-on" : ""} onClick={() => onPick(index)}>
              <td>{index + 1}</td>
              <td>{shortDate(m.time_mjd)}</td>
              <td>{detectorOf(m)}</td>
              <td>{m.wavelength_um.toFixed(3)} µm</td>
              <td>{formatNumber(m.flux, 2)}</td>
              <td>{m.variance !== null && m.variance >= 0 ? formatNumber(Math.sqrt(m.variance), 1) : "—"}</td>
              <td className={m.flag === 0 ? "quality-clear" : "quality-flagged"}>{m.flag === 0 ? "Clear" : m.flag}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
