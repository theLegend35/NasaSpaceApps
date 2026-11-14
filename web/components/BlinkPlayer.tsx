"use client";

// Location panel Blink tab (design doc Features 2, 3, 5) in the layout of
// mock-design "Sky Timeline App": tilting 3D stage, Timelapse vs Blink A/B,
// pass-grouped timeline, A/B badges, speed, crosshair, path arrow, loop.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowCounterClockwise, Pause, Play, SkipBack, SkipForward, Swap, Warning,
} from "@phosphor-icons/react";
import type { CutoutsResponse, Frame, SimbadInfo, Source } from "@/lib/types";
import { daysBetween, fmtDate, isoToJyear, propagate, skyToUv } from "@/lib/sky";

export type ViewMode = "blink" | "coadd" | "difference" | "stack" | "rgb";

export type PlayerSettings = {
  det: string;
  cfov: number;
  mode: ViewMode;
  diffRef: "median" | "first";
  baseline: "none" | "allwise";
  mask: boolean;
};

type Props = {
  cut: CutoutsResponse | null;
  loading: boolean;
  error: { message: string; retryable?: boolean } | null;
  settings: PlayerSettings;
  onSettings: (s: Partial<PlayerSettings>) => void;
  onStack: (obsIds: string[]) => void;
  onRetry: () => void;
  counts: Record<string, number> | undefined;
  motion: SimbadInfo | null | undefined; // catalog proper motion for the path arrow
  sources: Source[] | null;
  selectedSource: string | null;
  onFrameChange?: (i: number) => void;
  initialFrame?: number;
  compact?: boolean;
};

const DETS = ["D1", "D2", "D3", "D4", "D5", "D6"];
const VIEWS: [ViewMode, string][] = [["blink", "Frames"], ["coadd", "Co-add"], ["difference", "Difference"], ["stack", "Stack"], ["rgb", "RGB"]];

function caption(f: Frame) {
  if (f.kind === "allwise") return `${f.epochLabel ?? "AllWISE (2010)"} · ${f.detector}`;
  const lam = f.wavelengthUm != null ? `${f.wavelengthUm.toFixed(3)} µm`
    : f.wavelengthRangeUm ? `${f.wavelengthRangeUm[0].toFixed(2)}–${f.wavelengthRangeUm[1].toFixed(2)} µm` : "λ not measured";
  const n = f.nExposures && f.nExposures > 1 ? ` · ${f.nExposures} exposures` : "";
  return `${f.dateIso.slice(0, 16).replace("T", " ")} UTC · ${f.detector} · ${lam} · ${f.release}${n}`;
}

export default function BlinkPlayer(p: Props) {
  const frames = useMemo(() => p.cut?.frames ?? [], [p.cut]);
  const N = frames.length;
  const [frame, setFrame] = useState(p.initialFrame ?? 0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [style, setStyle] = useState<"time" | "blink">("time");
  const [a, setA] = useState(0);
  const [b, setB] = useState(Math.max(0, N - 1));
  const [side, setSide] = useState<"a" | "b">("a");
  const [blinking, setBlinking] = useState(false);
  const [pick, setPick] = useState<"a" | "b">("a");
  const [orbit, setOrbit] = useState(-12);
  const [tilt, setTilt] = useState(6);
  const [tog, setTog] = useState({ crosshair: true, arrow: true, loop: true, known: false });
  const [loaded, setLoaded] = useState(0);
  const [flash, setFlash] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const reduced = useRef(false);

  // New frame set: reset A/B to first and last, preload every PNG before allowing play.
  useEffect(() => {
    setLoaded(0);
    setA(0);
    setB(Math.max(0, N - 1));
    setFrame((f) => Math.min(f, Math.max(0, N - 1)));
    setPlaying(false);
    setBlinking(false);
    let n = 0;
    const urls = frames.flatMap((f) => [f.pngUrl, f.maskPngUrl].filter(Boolean) as string[]);
    urls.forEach((u) => {
      const im = new Image();
      im.onload = im.onerror = () => setLoaded(++n);
      im.src = u;
    });
    reduced.current = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, [frames, N]);
  const totalUrls = frames.reduce((k, f) => k + 1 + (f.maskPngUrl ? 1 : 0), 0);
  const ready = N > 0 && loaded >= totalUrls;

  const cur = style === "blink" ? (side === "a" ? a : b) : frame;
  const f = frames[cur];
  useEffect(() => { p.onFrameChange?.(cur); }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps

  // Timer: timelapse steps frames, blink flips A/B.
  useEffect(() => {
    if (!ready || !(playing || blinking)) return;
    const t = setInterval(() => {
      if (blinking) setSide((s) => (s === "a" ? "b" : "a"));
      else setFrame((i) => {
        if (i + 1 < N) return i + 1;
        if (!tog.loop) { setPlaying(false); return i; }
        setFlash(true);
        setTimeout(() => setFlash(false), 350);
        return 0;
      });
    }, 1000 / speed);
    return () => clearInterval(t);
  }, [ready, playing, blinking, speed, N, tog.loop]);

  const step = useCallback((d: number) => {
    setStyle("time"); setBlinking(false); setPlaying(false);
    setFrame((i) => (i + d + N) % Math.max(1, N));
  }, [N]);

  // Keyboard: Space play/pause, Left/Right step, D difference, M mask.
  useEffect(() => {
    if (p.compact) return;
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input,textarea,select,[contenteditable]")) return;
      if (e.key === " ") { e.preventDefault(); setStyle("time"); setBlinking(false); setPlaying((x) => !x); }
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "d" || e.key === "D") p.onSettings({ mode: p.settings.mode === "difference" ? "blink" : "difference" });
      else if (e.key === "m" || e.key === "M") p.onSettings({ mask: !p.settings.mask });
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [p, step]);

  const assign = (k: "a" | "b", i: number) => {
    if (k === "a") { if (i === b) setB(a); setA(i); } else { if (i === a) setA(b); setB(i); }
    setSide(k);
  };

  const dragStart = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button,label,input,a,select")) return;
    const sx = e.clientX, sy = e.clientY, o = orbit, t = tilt;
    const mv = (ev: PointerEvent) => {
      setOrbit(Math.max(-40, Math.min(40, o + (ev.clientX - sx) * 0.25)));
      setTilt(Math.max(-30, Math.min(30, t - (ev.clientY - sy) * 0.25)));
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
    addEventListener("pointermove", mv);
    addEventListener("pointerup", up);
  };

  // Overlays, all in 0..100 SVG units of the image.
  const centre = p.cut?.field;
  const overlay = useMemo(() => {
    if (!centre || !f) return null;
    const out: { arrow?: [number, number, number, number]; marks: { u: number; v: number; dark: boolean; sel: boolean }[]; track?: string } = { marks: [] };
    const m = p.motion;
    if (m && m.pmRa != null && m.pmDec != null) {
      const t0 = frames[0]?.kind === "allwise" ? 2010.5 : isoToJyear(frames[0]?.dateIso ?? f.dateIso);
      const t1 = f.kind === "allwise" ? 2010.5 : isoToJyear(f.dateIso);
      const p0 = propagate(m.ra, m.dec, m.pmRa, m.pmDec, m.epoch, t0);
      const p1 = propagate(m.ra, m.dec, m.pmRa, m.pmDec, m.epoch, t1);
      const u0 = skyToUv(p0.ra, p0.dec, centre, centre.fovArcmin);
      const u1 = skyToUv(p1.ra, p1.dec, centre, centre.fovArcmin);
      if (Math.hypot(u1.u - u0.u, u1.v - u0.v) > 0.002) out.arrow = [u0.u * 100, u0.v * 100, u1.u * 100, u1.v * 100];
    }
    if (p.sources && (tog.known || p.selectedSource)) {
      for (const s of p.sources) {
        const sel = s.id === p.selectedSource;
        if (!tog.known && !sel) continue;
        if (s.clean.rejected && !sel) continue;
        out.marks.push({ u: s.uv[0] * 100, v: s.uv[1] * 100, dark: s.gaiaStatus === "dark", sel });
        if (sel && s.motion?.track?.length) out.track = s.motion.track.map((q) => `${q.uv[0] * 100},${q.uv[1] * 100}`).join(" ");
      }
    }
    return out;
  }, [centre, f, frames, p.motion, p.sources, p.selectedSource, tog.known]);

  // ── states (mock 1f) ──
  if (p.error) {
    const waking = p.error.retryable && /wak/i.test(p.error.message);
    return (
      <div className="card elev-sm state">
        <span className="card-kicker">{waking ? "Slow server" : /coverage/i.test(p.error.message) ? "No coverage" : "Couldn't load"}</span>
        <span className="card-title">{p.error.message}</span>
        <p className="card-body">{waking ? "This can take up to a minute the first time. Your images will appear on their own." : p.error.retryable ? "The archive is slow or down right now. Try again in a minute." : "Try a nearby spot, another detector or one of the example targets."}</p>
        {p.error.retryable && <button className="btn btn-secondary" style={{ alignSelf: "flex-start" }} onClick={p.onRetry}>Try again</button>}
      </div>
    );
  }
  if (p.loading || !p.cut) {
    return (
      <div className="card elev-sm state">
        <span className="card-kicker">Loading</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "var(--space-2)" }}>
          {[0, 1, 2, 3].map((i) => <span key={i} className="skeleton" style={{ aspectRatio: "1" }} />)}
        </div>
        <span className="card-title">Fetching and aligning SPHEREx images</span>
        <p className="card-body">IRSA can take a minute or two for a new spot. Every frame is reprojected onto one grid with one shared stretch.</p>
      </div>
    );
  }
  if (!N) {
    return <div className="card elev-sm state"><span className="card-kicker">No coverage</span><span className="card-title">No SPHEREx images of this spot yet</span></div>;
  }

  const deep = p.settings.baseline === "allwise";
  const blinkMode = style === "blink";
  const passStart = (i: number) => i > 0 && frames[i].pass !== frames[i - 1].pass;

  // ── compact (location panel preview) ──
  if (p.compact) {
    return (
      <div className="col" style={{ gap: "var(--space-3)" }}>
        <div style={{ position: "relative" }}>
          <img src={f.pngUrl} alt={`SPHEREx image, ${caption(f)}`} style={{ width: "100%", aspectRatio: "1", borderRadius: "var(--radius-md)", imageRendering: "pixelated", boxShadow: "var(--shadow-sm)" }} />
          <span className="tag tag-neutral" style={{ position: "absolute", left: 8, top: 8 }}>Image {cur + 1} of {N}</span>
        </div>
        <div className="row">
          <button className="btn btn-secondary btn-icon" title="Previous image" onClick={() => step(-1)}><SkipBack /></button>
          <button className="btn btn-secondary btn-icon" title="Play or pause" disabled={!ready} onClick={() => { setStyle("time"); setPlaying((x) => !x); }}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button>
          <button className="btn btn-secondary btn-icon" title="Next image" onClick={() => step(1)}><SkipForward /></button>
          <span className="small num" style={{ marginLeft: "var(--space-2)" }}>{fmtDate(f.dateIso)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: "var(--space-4)" }}>
      {/* view switch + detector + FOV */}
      <div className="row wrap" style={{ gap: "var(--space-3)" }}>
        <div className="seg" role="radiogroup" aria-label="View">
          {VIEWS.map(([m, label]) => (
            <label key={m} className="seg-opt"><input type="radio" name="view" checked={p.settings.mode === m} onChange={() => p.onSettings({ mode: m })} />{label}</label>
          ))}
        </div>
        {p.settings.mode === "difference" && (
          <div className="seg" aria-label="Difference reference">
            <label className="seg-opt"><input type="radio" name="ref" checked={p.settings.diffRef === "median"} onChange={() => p.onSettings({ diffRef: "median" })} />vs median</label>
            <label className="seg-opt"><input type="radio" name="ref" checked={p.settings.diffRef === "first"} onChange={() => p.onSettings({ diffRef: "first" })} />vs first</label>
          </div>
        )}
      </div>
      <div className="row wrap" style={{ gap: "var(--space-2)" }}>
        <span className="small muted">Detector</span>
        {DETS.map((d) => (
          <button key={d} className="chip-det" aria-pressed={p.settings.det === d} onClick={() => p.onSettings({ det: d })} disabled={p.settings.mode === "rgb"}>
            {d}{p.counts?.[d] != null && <span className="muted">{p.counts[d]}</span>}
          </button>
        ))}
        <label className="small muted row" style={{ marginLeft: "auto" }} title="Bigger field means slower download (30 arcmin is about 6× the pixels of 12)">
          Field {p.settings.cfov}′
          <input type="range" min={2} max={30} step={1} value={p.settings.cfov} onChange={(e) => p.onSettings({ cfov: +e.target.value })} style={{ accentColor: "var(--color-accent)", width: 110 }} />
        </label>
      </div>

      {/* stage */}
      <div className="stage" onPointerDown={dragStart}>
        <div className="stage-3d" style={{ transform: reduced.current ? undefined : `rotateX(${tilt}deg) rotateY(${orbit}deg)` }}>
          <div className={`stage-card${flash ? " flash" : ""}`}>
            <img className="frame" src={f.pngUrl} alt={`Sky image: ${caption(f)}`} draggable={false} />
            {p.settings.mask && f.maskPngUrl && <img className="frame" src={f.maskPngUrl} alt="Flagged pixels" draggable={false} style={{ position: "absolute", inset: 0, boxShadow: "none", background: "transparent" }} />}
            <div className="overlay">
              <svg viewBox="0 0 100 100" aria-hidden>
                {tog.crosshair && (
                  <g stroke="var(--color-accent-400)" strokeWidth="0.35" fill="none">
                    <line x1="50" y1="36" x2="50" y2="44" /><line x1="50" y1="56" x2="50" y2="64" />
                    <line x1="36" y1="50" x2="44" y2="50" /><line x1="56" y1="50" x2="64" y2="50" />
                    <circle cx="50" cy="50" r="5.5" />
                  </g>
                )}
                {tog.arrow && overlay?.arrow && (
                  <g stroke="var(--color-motion)" strokeWidth="0.5" fill="var(--color-motion)">
                    <line x1={overlay.arrow[0]} y1={overlay.arrow[1]} x2={overlay.arrow[2]} y2={overlay.arrow[3]} strokeDasharray="1.5 1" />
                    <circle cx={overlay.arrow[2]} cy={overlay.arrow[3]} r="0.9" />
                  </g>
                )}
                {overlay?.track && <polyline points={overlay.track} stroke="var(--color-accent-200)" strokeWidth="0.35" fill="none" strokeDasharray="1 1" />}
                {overlay?.marks.map((m, i) => m.sel
                  ? <circle key={i} cx={m.u} cy={m.v} r="4" stroke="var(--color-accent-100)" strokeWidth="0.5" fill="none" />
                  : m.dark
                    ? <rect key={i} x={m.u - 1.6} y={m.v - 1.6} width="3.2" height="3.2" transform={`rotate(45 ${m.u} ${m.v})`} stroke="var(--color-accent-300)" strokeWidth="0.3" fill="none" />
                    : <circle key={i} cx={m.u} cy={m.v} r="1.8" stroke="var(--color-neutral-400)" strokeWidth="0.25" fill="none" />)}
              </svg>
            </div>
            <div className="caption"><span className="num">{f.kind === "allwise" ? "AllWISE (2010)" : fmtDate(f.dateIso)}</span><span className="tag tag-neutral">Image {cur + 1} of {N}</span></div>
            {blinkMode && <span className="tag tag-accent" style={{ position: "absolute", top: 8, right: 8, transform: "translateZ(50px)", fontSize: 17, padding: "2px 11px" }}>{side.toUpperCase()}</span>}
          </div>
        </div>
        <div className="seg corner on-sky" style={{ left: "var(--space-4)", top: "var(--space-4)" }}>
          <label className="seg-opt"><input type="radio" name="style" checked={!blinkMode} onChange={() => { setStyle("time"); setBlinking(false); setFrame(cur); }} />Timelapse</label>
          <label className="seg-opt"><input type="radio" name="style" checked={blinkMode} onChange={() => { setStyle("blink"); setPlaying(false); }} />Blink</label>
        </div>
        <button className="btn btn-secondary corner on-sky" title="Face the image straight on" onClick={() => { setOrbit(0); setTilt(0); }} style={{ right: "var(--space-4)", top: "var(--space-4)" }}><ArrowCounterClockwise />Flat view</button>
        <div className="corner col" style={{ left: "var(--space-4)", bottom: "var(--space-4)" }}>
          <button className="ab-thumb" aria-pressed={blinkMode && side === "a"} title="Show image A" onClick={() => { setStyle("blink"); setSide("a"); setPick("a"); setBlinking(false); setPlaying(false); }}><img src={frames[a]?.pngUrl} alt="" /><span className="tag tag-accent">A</span></button>
          <button className="ab-thumb" aria-pressed={blinkMode && side === "b"} title="Show image B" onClick={() => { setStyle("blink"); setSide("b"); setPick("b"); setBlinking(false); setPlaying(false); }}><img src={frames[b]?.pngUrl} alt="" /><span className="tag tag-accent">B</span></button>
        </div>
        <span className="corner small muted" style={{ right: "var(--space-4)", bottom: "var(--space-3)" }}>Drag to tilt · {p.cut.field.orientation}</span>
      </div>

      <div className="small muted num" aria-live="polite">{caption(f)}{f.flaggedFraction != null && ` · ${(f.flaggedFraction * 100).toFixed(1)}% flagged`}</div>

      {p.settings.mode === "difference" && (
        <div className="small row wrap" style={{ gap: "var(--space-4)" }}>
          <span><span className="legend-swatch" style={{ background: "var(--color-diff-pos)" }} /> brighter now</span>
          <span><span className="legend-swatch" style={{ background: "var(--color-diff-neg)" }} /> brighter before</span>
          <span className="muted">Same-detector co-adds minus the {p.settings.diffRef} reference. For the eye, not for measuring.</span>
        </div>
      )}

      {/* controls */}
      <div className="row wrap" style={{ gap: "var(--space-4)" }}>
        {!blinkMode ? (
          <div className="row" style={{ gap: "var(--space-1)" }}>
            <button className="btn btn-secondary btn-icon" title="Previous image (←)" onClick={() => step(-1)}><SkipBack /></button>
            <button className="btn btn-secondary btn-icon" title="Play or pause (Space)" disabled={!ready} onClick={() => setPlaying((x) => !x)} style={{ width: 48, height: 48, fontSize: 20 }}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button>
            <button className="btn btn-secondary btn-icon" title="Next image (→)" onClick={() => step(1)}><SkipForward /></button>
          </div>
        ) : (
          <div className="row small muted" style={{ height: 48 }}>Pick for
            <button className="btn btn-secondary btn-icon" style={{ borderColor: pick === "a" ? "var(--color-accent-400)" : undefined }} onClick={() => { setPick("a"); setSide("a"); }}>A</button>
            <button className="btn btn-secondary btn-icon" style={{ borderColor: pick === "b" ? "var(--color-accent-400)" : undefined }} onClick={() => { setPick("b"); setSide("b"); }}>B</button>
          </div>
        )}
        <button className="btn btn-primary blink-btn" aria-pressed={blinking} disabled={!ready || N < 2}
          onClick={() => { if (blinking) setBlinking(false); else { setStyle("blink"); setPlaying(false); setBlinking(true); } }}>
          <Swap />{blinking ? "Stop blinking" : "Blink A ⇄ B"}
        </button>
        <label className="col small muted grow" style={{ minWidth: 120, gap: 2 }}>Speed · {speed} per second
          <input type="range" min={0.25} max={4} step={0.25} value={speed} onChange={(e) => setSpeed(+e.target.value)} style={{ accentColor: "var(--color-accent)", width: "100%" }} />
        </label>
      </div>
      {!ready && <span className="small muted">Loading frames {loaded} of {totalUrls}… playback starts when all are ready.</span>}

      {/* timeline */}
      <div className="col" style={{ gap: 4 }}>
        <div className="ticks">
          {frames.map((fr, i) => {
            const isA = i === a, isB = i === b;
            const stackMode = p.settings.mode === "stack" && fr.obsId;
            return (
              <button key={fr.id} className="tick" title={caption(fr)} data-on={i === cur} data-ab={isA || isB}
                style={{ marginLeft: passStart(i) ? 14 : 0 }}
                onClick={() => {
                  if (stackMode) {
                    const s = new Set(ticked);
                    if (s.has(fr.obsId!)) s.delete(fr.obsId!); else s.add(fr.obsId!);
                    setTicked(s);
                  } else if (blinkMode) assign(pick, i);
                  else { setFrame(i); setPlaying(false); }
                }}>
                <span className="badge" style={{ visibility: isA || isB ? "visible" : "hidden" }}>{isA ? "A" : isB ? "B" : "·"}</span>
                <span className="bar" />
                <span className="lbl num">{stackMode ? (ticked.has(fr.obsId!) ? "+" : ".") + " " : ""}{fr.kind === "allwise" ? "2010" : fmtDate(fr.dateIso, true)}</span>
              </button>
            );
          })}
        </div>
        <span className="small muted">
          {p.settings.mode === "stack" ? "Tick frames (+ added, . unused), then stack them. Fainter static sources appear; movers smear."
            : blinkMode ? `Click a date to set image ${pick.toUpperCase()}` : "Click a date to jump there"}
        </span>
      </div>
      {p.settings.mode === "stack" && (
        <button className="btn btn-secondary" style={{ alignSelf: "flex-start" }} disabled={ticked.size < 2} onClick={() => p.onStack([...ticked])}>Stack {ticked.size} frames</button>
      )}

      <p className="small" style={{ margin: 0, color: "var(--color-neutral-300)" }}>
        Comparing <strong style={{ fontWeight: 500 }}>A</strong> {frames[a]?.kind === "allwise" ? "AllWISE (2010)" : fmtDate(frames[a]?.dateIso ?? "")} with <strong style={{ fontWeight: 500 }}>B</strong> {fmtDate(frames[b]?.dateIso ?? "")}, {frames[a] && frames[b] ? daysBetween(frames[a].dateIso, frames[b].dateIso) : 0} days apart.
      </p>
      <div className="row wrap">
        <button className="btn btn-secondary small" onClick={() => assign("a", cur)}>Use this image as A</button>
        <button className="btn btn-secondary small" onClick={() => assign("b", cur)}>Use as B</button>
        {([["crosshair", "Crosshair"], ["arrow", "Path arrow"], ["loop", "Loop"], ["known", "Known objects"]] as const).map(([k, label]) => (
          <button key={k} className="toggle" aria-pressed={tog[k]} onClick={() => setTog((t) => ({ ...t, [k]: !t[k] }))} disabled={k === "known" && !p.sources}>{label}</button>
        ))}
        <button className="toggle" aria-pressed={deep} onClick={() => p.onSettings({ baseline: deep ? "none" : "allwise" })} title="Insert the AllWISE (2010) image as frame 0">Deep time</button>
        <button className="toggle" aria-pressed={p.settings.mask} onClick={() => p.onSettings({ mask: !p.settings.mask })} disabled={p.settings.mode !== "blink"} title="Show flagged pixels (M)">Mask</button>
      </div>
      {deep && frames[0]?.kind !== "allwise" && (
        <span className="small muted">No AllWISE Atlas image came back for this spot, so deep time is off.</span>
      )}
      {p.cut.skipped.length > 0 && (
        <div className="row small" style={{ color: "var(--color-accent-300)" }}><Warning />{p.cut.skipped.length} frame{p.cut.skipped.length > 1 ? "s" : ""} couldn&apos;t be downloaded. See the Data tab.</div>
      )}
      {p.cut.cached && <span className="small muted">Showing cached data from {p.cut.cached.date?.slice(0, 10)}.</span>}
      <p className="small muted" style={{ margin: 0 }}>Each SPHEREx exposure sees this spot at a different wavelength, so brightness can change just because the wavelength did. Anything that seems to move is a candidate until a researcher confirms it.</p>
    </div>
  );
}
