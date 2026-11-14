"use client";

// Explore: search rail + sky globe + location panel (mock-design "Sky Timeline App").
// Owns the view state and writes it to the URL so every view is a shareable link.

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Code, Export, LinkSimple, MagnifyingGlass, Minus, Plus, StarFour } from "@phosphor-icons/react";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { fmtDec, fmtRa, looksLikeCoords } from "@/lib/sky";
import { readUrlState, writeUrlState, type ViewState } from "@/lib/urlState";
import type {
  ClassifyResponse, CutoutsResponse, Resolved, SimbadInfo, Source, SourcesResponse, SpectrumResponse, TargetItem,
} from "@/lib/types";
import type { SkyMapHandle } from "./SkyMap";
import { SURVEYS } from "./SkyMap";
import BlinkPlayer, { type PlayerSettings } from "./BlinkPlayer";
import SourceList from "./SourceList";
import SpectrumChart from "./SpectrumChart";
import ClassCard from "./ClassCard";
import TutorPanel from "./TutorPanel";
import DiscussTab from "./DiscussTab";
import MissionRunner, { type MissionHooks } from "./MissionRunner";

const SkyMap = dynamic(() => import("./SkyMap"), { ssr: false });

// Names and kinds only (from api/config/targets.yaml). Positions always come from the API.
const EXAMPLES = [
  { name: "WISE 0855", kind: "Cold brown dwarf" },
  { name: "Barnard's Star", kind: "Fast-moving nearby star" },
  { name: "Epsilon Indi B", kind: "Brown dwarf pair" },
  { name: "RW Aurigae", kind: "Young variable star" },
  { name: "R Draconis", kind: "Mira variable" },
  { name: "Eros", kind: "Near-Earth asteroid" },
];

type Sel = { name: string | null; query: string | null; ra: number; dec: number; kind?: string | null; simbad?: SimbadInfo | null; targetId?: string | null; detector?: string };
type Tab = "blink" | "sources" | "spectrum" | "data" | "ai" | "discuss";
type Load<T> = { data: T | null; loading: boolean; error: { message: string; retryable?: boolean } | null };
const idle = <T,>(): Load<T> => ({ data: null, loading: false, error: null });

function useFetch<T>(key: string | null, fn: (signal: AbortSignal) => Promise<T>, nonce = 0): Load<T> {
  const [st, setSt] = useState<Load<T>>(idle<T>());
  useEffect(() => {
    if (!key) { setSt(idle<T>()); return; }
    const ctl = new AbortController();
    setSt({ data: null, loading: true, error: null });
    fn(ctl.signal)
      .then((data) => !ctl.signal.aborted && setSt({ data, loading: false, error: null }))
      .catch((e) => {
        if (ctl.signal.aborted || e?.name === "AbortError") return;
        setSt({ data: null, loading: false, error: { message: e instanceof ApiError ? e.message : "Something went wrong.", retryable: e instanceof ApiError ? e.retryable : true } });
      });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);
  return st;
}

export default function ExploreApp({ missionId }: { missionId?: string }) {
  const map = useRef<SkyMapHandle>(null);
  const [boot, setBoot] = useState<ViewState | null>(null);
  const [targets, setTargets] = useState<TargetItem[]>([]);
  const [sel, setSel] = useState<Sel | null>(null);
  const [panel, setPanel] = useState<"closed" | "compact" | "deep">("closed");
  const [tab, setTab] = useState<Tab>("blink");
  const [nameQ, setNameQ] = useState("WISE 0855");
  const [raQ, setRaQ] = useState("");
  const [decQ, setDecQ] = useState("");
  const [msg, setMsg] = useState("");
  const [survey, setSurvey] = useState<string>("spherex");
  const [showCov, setShowCov] = useState(true);
  const [cursor, setCursor] = useState<{ ra: number; dec: number } | null>(null);
  const [view, setView] = useState<{ ra: number; dec: number; fov: number } | null>(null);
  const [copied, setCopied] = useState("");
  const [settings, setSettings] = useState<PlayerSettings>({ det: "D1", cfov: 12, mode: "blink", diffRef: "median", baseline: "none", mask: false });
  const [stackIds, setStackIds] = useState<string[] | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [gif, setGif] = useState<string | null>(null);

  // ── boot from the URL ──
  useEffect(() => {
    const s = readUrlState(window.location.search);
    setBoot(s);
    if (s.det || s.cfov || s.mode || s.baseline || s.mask)
      setSettings((x) => ({ ...x, det: s.det ?? x.det, cfov: s.cfov ?? x.cfov, mode: (s.mode as PlayerSettings["mode"]) ?? x.mode, baseline: s.baseline ?? x.baseline, mask: s.mask ?? x.mask }));
    if (s.tab) setTab(s.tab as Tab);
    if (s.src) setSrc(s.src);
    if (s.frame) setFrame(s.frame);
    if (s.target) find(s.target, (s.panel as "compact" | "deep") ?? "compact");
    else if (s.ra !== undefined && s.dec !== undefined && s.panel && s.panel !== "closed") pick({ ra: s.ra, dec: s.dec }, s.panel as "compact" | "deep");
    apiGet<{ targets: TargetItem[] }>("/targets").then((r) => setTargets(r.targets)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── URL state ──
  useEffect(() => {
    if (!boot) return;
    writeUrlState({
      ra: sel?.ra ?? view?.ra, dec: sel?.dec ?? view?.dec, fov: view?.fov,
      target: sel?.query ?? undefined, panel: panel === "closed" ? undefined : panel, tab: panel === "deep" ? tab : undefined,
      det: settings.det, cfov: settings.cfov !== 12 ? settings.cfov : undefined, mode: settings.mode !== "blink" ? settings.mode : undefined,
      baseline: settings.baseline !== "none" ? settings.baseline : undefined, mask: settings.mask, frame: frame || undefined, src: src ?? undefined,
    });
  }, [boot, sel, view, panel, tab, settings, frame, src]);

  const select = useCallback((s: Sel, mode: "compact" | "deep" = "compact") => {
    setSel(s);
    setSrc(null);
    setStackIds(null);
    setFrame(0);
    setPanel(mode);
    setMsg("");
    setRaQ(s.ra.toFixed(5));
    setDecQ(s.dec.toFixed(5));
    const t = targets.find((x) => (s.targetId && x.id === s.targetId) || x.name === s.name);
    const det = s.detector ?? t?.detector;
    setSettings((x) => ({ ...x, det: det ?? x.det, baseline: t?.fast_mover ? "allwise" : "none" }));
    map.current?.goTo(s.ra, s.dec, 0.2); // 12 arcmin
  }, [targets]);

  const find = useCallback(async (q: string, mode: "compact" | "deep" = "compact") => {
    q = q.trim();
    if (!q) return;
    setMsg("Looking it up…");
    try {
      const r = await apiGet<Resolved>("/resolve", { q });
      const t = targets.find((x) => x.id === r.target);
      select({ name: r.name ?? (looksLikeCoords(q) ? null : q), query: q, ra: r.pos.ra, dec: r.pos.dec, kind: r.simbad?.otype ?? t?.kind ?? null,
        simbad: r.simbad ?? null, targetId: r.target ?? null, detector: t?.detector }, mode);
      if (r.simbad && r.name && r.name.toLowerCase() !== q.toLowerCase()) setMsg(`Showing SIMBAD's ${r.name}.`);
      else setMsg("");
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Couldn't find that name. Try RA/Dec.");
    }
  }, [targets, select]);

  const pick = useCallback((p: { ra: number; dec: number; targetId?: string }, mode: "compact" | "deep" = "compact") => {
    const t = p.targetId ? targets.find((x) => x.id === p.targetId) : undefined;
    if (t) { find(t.name, mode); setNameQ(t.name); return; }
    select({ name: null, query: null, ra: p.ra, dec: p.dec, kind: null }, mode);
  }, [targets, find, select]);

  const locate = () => {
    const q = `${raQ} ${decQ}`.trim();
    if (!raQ || !decQ) { setMsg("Enter both RA and Dec, like 133.795 and -7.2451."); return; }
    find(q);
  };

  // ── data ──
  const apiMode = settings.mode === "coadd" || settings.mode === "difference" ? "coadd" : settings.mode === "rgb" ? "rgb" : "single";
  const cutParams = sel && panel !== "closed" ? {
    ra: sel.ra, dec: sel.dec, fov: settings.cfov, detector: settings.det, mode: apiMode,
    diff: settings.mode === "difference" ? settings.diffRef : "none", stack: !!stackIds && settings.mode === "stack",
    baseline: settings.baseline, mask: settings.mask && apiMode === "single", obsIds: stackIds && settings.mode === "stack" ? stackIds.join(",") : undefined,
  } : null;
  const cut = useFetch<CutoutsResponse>(cutParams ? JSON.stringify(cutParams) : null, (sig) => apiGet("/cutouts", cutParams!, sig), nonce);

  const hint = sel?.simbad && sel.simbad.pmRa != null
    ? { hintRa: sel.simbad.ra, hintDec: sel.simbad.dec, hintPmRa: sel.simbad.pmRa, hintPmDec: sel.simbad.pmDec, hintEpoch: sel.simbad.epoch } : {};
  const wantSources = sel && panel === "deep" && (tab === "sources" || !!src || missionId);
  const srcParams = sel ? { ra: sel.ra, dec: sel.dec, fov: settings.cfov, detector: settings.det, ...hint } : null;
  const sources = useFetch<SourcesResponse>(wantSources && srcParams ? JSON.stringify(srcParams) : null, (sig) => apiGet("/sources", srcParams!, sig), nonce);
  const selSource: Source | undefined = sources.data?.sources.find((s) => s.id === src);

  // Spectrum: the selected source, else the target itself (with its catalog motion).
  const specPos = selSource ? { ra: selSource.ra, dec: selSource.dec } : sel ? { ra: sel.ra, dec: sel.dec } : null;
  const useTargetPm = !selSource && sel?.simbad?.pmRa != null;
  const specParams = specPos ? { ...specPos, ...(useTargetPm ? { ra: sel!.simbad!.ra, dec: sel!.simbad!.dec, pmRa: sel!.simbad!.pmRa, pmDec: sel!.simbad!.pmDec, epoch: sel!.simbad!.epoch } : {}) } : null;
  const spectrum = useFetch<SpectrumResponse>(panel === "deep" && tab === "spectrum" && specParams ? JSON.stringify(specParams) : null, (sig) => apiGet("/spectrum", specParams!, sig), nonce);
  const clsParams = sel && src ? { ra: sel.ra, dec: sel.dec, fov: settings.cfov, detector: settings.det, sourceId: src } : null;
  const classify = useFetch<ClassifyResponse>(panel === "deep" && (tab === "spectrum" || tab === "sources") && clsParams ? JSON.stringify(clsParams) : null, (sig) => apiGet("/classify", clsParams!, sig), nonce);

  const missionHooks: MissionHooks = useMemo(() => ({
    state: { sel, tab, settings, src, sources: sources.data, panel },
    goTo: (q: string, mode: "compact" | "deep") => { setNameQ(q); find(q, mode); },
    setTab: (t: string) => { setPanel("deep"); setTab(t as Tab); },
    setSettings: (s: Partial<PlayerSettings>) => setSettings((x) => ({ ...x, ...s })),
  }), [sel, tab, settings, src, sources.data, panel, find]);

  const copy = async (what: "link" | "embed") => {
    const url = window.location.href;
    const embed = `${window.location.origin}/embed?${new URLSearchParams({ ra: String(sel?.ra ?? ""), dec: String(sel?.dec ?? ""), fov: String(settings.cfov), det: settings.det, baseline: settings.baseline })}`;
    const text = what === "link" ? url : `<iframe src="${embed}" width="420" height="520" style="border:0" title="SolaraX blink"></iframe>`;
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(""), 1500); } catch { setMsg("Couldn't copy. Your browser blocked the clipboard."); }
  };

  const exportGif = async () => {
    if (!sel) return;
    setGif("making");
    try {
      const r = await apiPost<{ gifUrl: string }>("/export/gif", { ra: sel.ra, dec: sel.dec, fov: settings.cfov, detector: settings.det, mode: apiMode === "rgb" ? "single" : apiMode, diff: settings.mode === "difference" ? settings.diffRef : "none", baseline: settings.baseline });
      setGif(r.gifUrl);
    } catch (e) { setGif(null); setMsg(e instanceof ApiError ? e.message : "GIF export failed."); }
  };

  const deep = panel === "deep";
  const title = sel?.name ?? (sel ? "Custom sky region" : "");

  return (
    <div className="explore">
      {/* left rail */}
      <aside className="rail" style={{ display: deep ? "none" : undefined }}>
        <h4 style={{ margin: 0 }}>Pick a spot. Watch it change.</h4>
        <p className="small" style={{ margin: "0 0 var(--space-3)", color: "var(--color-neutral-300)" }}>Search for an object or enter a position. Then blink real SPHEREx observations to see what moved.</p>
        <form className="col" onSubmit={(e) => { e.preventDefault(); find(nameQ); }}>
          <div className="field"><label htmlFor="nm">Search the sky</label>
            <input id="nm" className="input on-sky" value={nameQ} onChange={(e) => setNameQ(e.target.value)} placeholder="WISE 0855 or 133.795 -7.2451" /></div>
          <button className="btn btn-primary"><MagnifyingGlass />Find target</button>
        </form>
        <span className="small muted" style={{ marginTop: "var(--space-3)" }}>Or go to coordinates</span>
        <form className="col" onSubmit={(e) => { e.preventDefault(); locate(); }}>
          <div className="row">
            <div className="field grow"><label htmlFor="ra">Right ascension</label><input id="ra" className="input on-sky" value={raQ} onChange={(e) => setRaQ(e.target.value)} placeholder="133.795" /></div>
            <div className="field grow"><label htmlFor="dc">Declination</label><input id="dc" className="input on-sky" value={decQ} onChange={(e) => setDecQ(e.target.value)} placeholder="-7.2451" /></div>
          </div>
          <button className="btn btn-primary">Locate in sky<ArrowRight /></button>
        </form>
        <span className="small" role="status" style={{ color: "var(--color-accent-300)", minHeight: 18 }}>{msg}</span>
        <span style={{ fontSize: 11 }} className="muted">Degrees (133.795 -7.2451) or 08h55m10.8s -07d14m42s both work.</span>
        <span className="small muted" style={{ marginTop: "var(--space-4)" }}>Example targets</span>
        {EXAMPLES.map((x) => (
          <button key={x.name} className="example" aria-pressed={sel?.query === x.name} onClick={() => { setNameQ(x.name); find(x.name); }}>
            <StarFour size={18} color="var(--color-accent-400)" />
            <span className="col" style={{ gap: 0 }}><span style={{ fontSize: 14 }}>{x.name}</span><span className="muted" style={{ fontSize: 11 }}>{x.kind}</span></span>
          </button>
        ))}
      </aside>

      {/* sky */}
      <section className="sky">
        {boot && (
          <SkyMap ref={map} targets={targets} selected={sel} survey={survey} showCoverage={showCov}
            initial={{ ra: boot.ra, dec: boot.dec, fov: boot.fov }}
            onPick={(p) => pick(p)} onView={setView} onCursor={setCursor} onError={setMsg} />
        )}
        {missionId && <MissionRunner id={missionId} hooks={missionHooks} />}
        <div className="sky-overlay">
          <span className="kicker">{deep ? "Target view" : "Explore · whole sky"}</span>
          <h4 style={{ margin: 0 }}>{deep && sel ? `Zoomed in on ${title}` : "A changing sky, one region at a time"}</h4>
          <span className="small muted">Drag to spin · scroll to zoom · click a target or any spot</span>
          {deep && <button className="btn btn-secondary on-sky" style={{ alignSelf: "flex-start" }} onClick={() => setPanel("compact")}><ArrowLeft />Back to sky</button>}
        </div>
        <div className="col" style={{ position: "absolute", right: "var(--space-6)", top: "var(--space-6)", alignItems: "flex-end" }}>
          <label className="sr-only" htmlFor="survey">Background</label>
          <select id="survey" className="input on-sky" style={{ width: 190 }} value={survey} onChange={(e) => setSurvey(e.target.value)}>
            {SURVEYS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <button className="toggle on-sky" aria-pressed={showCov} onClick={() => setShowCov((x) => !x)}>SPHEREx coverage</button>
          <span className="small muted">Background is for looking, not measuring.</span>
        </div>
        <div className="sky-bottom">
          <div className="col">
            <span className="small num" style={{ color: "var(--color-neutral-300)" }}>
              {cursor ? `RA ${fmtRa(cursor.ra)}  Dec ${fmtDec(cursor.dec)}` : view ? `View centre RA ${fmtRa(view.ra)}  Dec ${fmtDec(view.dec)}` : ""}
              {view ? `  ·  FOV ${view.fov >= 1 ? view.fov.toFixed(1) + "°" : (view.fov * 60).toFixed(1) + "′"}` : ""}
            </span>
          </div>
          <span style={{ flex: 1 }} />
          <button className="btn btn-secondary on-sky" onClick={() => copy("link")}><LinkSimple />{copied === "link" ? "Link copied" : "Copy view link"}</button>
          <div className="col">
            <button className="btn btn-secondary btn-icon on-sky" title="Zoom in" onClick={() => view && map.current?.goTo(view.ra, view.dec, view.fov / 1.6)}><Plus /></button>
            <button className="btn btn-secondary btn-icon on-sky" title="Zoom out" onClick={() => view && map.current?.goTo(view.ra, view.dec, Math.min(180, view.fov * 1.6))}><Minus /></button>
          </div>
        </div>
      </section>

      {/* location panel */}
      <aside className="panel" data-open={panel !== "closed"} style={{ width: panel === "closed" ? 0 : deep ? "var(--panel-deep)" : "var(--panel-compact)" }}>
        {sel && panel === "compact" && (
          <div className="panel-inner" style={{ width: 340 }}>
            <span className="kicker">Location panel</span>
            <div>
              <h4 style={{ margin: "0 0 4px" }}>{title}</h4>
              <div className="small num" style={{ color: "var(--color-neutral-300)" }}>RA {fmtRa(sel.ra)} · Dec {fmtDec(sel.dec)}</div>
              {sel.kind && <div className="small muted">SIMBAD type: {sel.kind}</div>}
            </div>
            <BlinkPlayer compact cut={cut.data} loading={cut.loading} error={cut.error} settings={settings} onSettings={() => {}} onStack={() => {}}
              onRetry={() => setNonce((n) => n + 1)} counts={cut.data?.counts} motion={sel.simbad} sources={null} selectedSource={null} />
            {cut.data?.counts && (
              <div className="row wrap">{Object.entries(cut.data.counts).map(([d, n]) => <span key={d} className="tag tag-neutral num">{d} · {n}</span>)}</div>
            )}
            <button className="btn btn-primary" style={{ height: 48, fontSize: 16 }} onClick={() => setPanel("deep")}>Open target view<ArrowRight /></button>
            <button className="btn btn-ghost small" style={{ alignSelf: "flex-start" }} onClick={() => setPanel("closed")}>Close</button>
          </div>
        )}
        {sel && deep && (
          <div className="panel-inner">
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div className="grow">
                <span className="kicker">Target view</span>
                <h3 style={{ margin: "2px 0 4px" }}>{title}</h3>
                <div className="small num" style={{ color: "var(--color-neutral-300)" }}>RA {fmtRa(sel.ra)} · Dec {fmtDec(sel.dec)}{sel.kind ? ` · ${sel.kind}` : ""}</div>
              </div>
              <button className="btn btn-secondary" onClick={exportGif} disabled={gif === "making" || !cut.data}><Export />{gif === "making" ? "Making GIF…" : "Export GIF"}</button>
              <button className="btn btn-secondary btn-icon" title={copied === "embed" ? "Embed code copied" : "Copy embed code"} onClick={() => copy("embed")}><Code /></button>
            </div>
            {gif && gif !== "making" && <a className="small" href={gif} target="_blank" rel="noreferrer">Your GIF is ready (opens in a new tab)</a>}
            <div className="tabs" role="tablist">
              {([["blink", "Blink"], ["sources", "Sources"], ["spectrum", "Spectrum"], ["data", "Data"], ["ai", "AI"], ["discuss", "Discuss"]] as const).map(([k, n]) => (
                <button key={k} role="tab" className="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{n}</button>
              ))}
            </div>
            {tab === "blink" && (
              <BlinkPlayer cut={cut.data} loading={cut.loading} error={cut.error} settings={settings}
                onSettings={(s) => { setSettings((x) => ({ ...x, ...s })); if (s.mode && s.mode !== "stack") setStackIds(null); }}
                onStack={(ids) => setStackIds(ids)} onRetry={() => setNonce((n) => n + 1)} counts={cut.data?.counts}
                motion={sel.simbad} sources={sources.data?.sources ?? null} selectedSource={src} initialFrame={frame} onFrameChange={setFrame} />
            )}
            {tab === "sources" && (
              <>
                <SourceList data={sources.data} loading={sources.loading} error={sources.error?.message ?? null} selected={src}
                  onSelect={(s) => setSrc(s.id)} onRetry={() => setNonce((n) => n + 1)} />
                {src && <ClassCard data={classify.data} loading={classify.loading} error={classify.error?.message ?? null} />}
              </>
            )}
            {tab === "spectrum" && (
              <>
                <span className="small muted">{selSource ? `Source ${selSource.id}` : `${title} (catalog position moved to each exposure date)`}. Pick another in Sources.</span>
                <SpectrumChart data={spectrum.data} loading={spectrum.loading} error={spectrum.error?.message ?? null} onRetry={() => setNonce((n) => n + 1)} />
                {src && <ClassCard data={classify.data} loading={classify.loading} error={classify.error?.message ?? null} />}
              </>
            )}
            {tab === "data" && cut.data && (
              <div style={{ overflowX: "auto" }}>
                <table className="table" style={{ fontSize: 12 }}>
                  <thead><tr><th>Date (UTC)</th><th>Detector</th><th>λ (µm)</th><th>Release</th><th>Flagged</th><th>Obs ID</th></tr></thead>
                  <tbody>
                    {cut.data.frames.map((f) => (
                      <tr key={f.id}><td className="num">{f.dateIso.slice(0, 16).replace("T", " ")}</td><td>{f.detector}</td>
                        <td className="num">{f.wavelengthUm?.toFixed(3) ?? (f.wavelengthRangeUm ? f.wavelengthRangeUm.map((v) => v.toFixed(2)).join("–") : "–")}</td>
                        <td>{f.release}</td><td className="num">{f.flaggedFraction != null ? (f.flaggedFraction * 100).toFixed(1) + "%" : "–"}</td>
                        <td className="num" style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{f.obsId ?? `${f.nExposures} exposures`}</td></tr>
                    ))}
                    {cut.data.skipped.map((s) => (
                      <tr key={s.obsId}><td className="num">{s.dateIso.slice(0, 16).replace("T", " ")}</td><td>{s.detector}</td><td colSpan={4} style={{ color: "var(--color-accent-300)" }}>Skipped: {s.reason}</td></tr>
                    ))}
                  </tbody>
                </table>
                <p className="small muted">Stretch: one asinh stretch shared by every frame ({JSON.stringify(cut.data.stretch.percentiles ?? "")} percentiles), so brightness changes are real, not auto-contrast.</p>
              </div>
            )}
            {tab === "ai" && (
              <TutorPanel ctx={{ targetQuery: sel.query, ra: sel.ra, dec: sel.dec, fov: settings.cfov, detector: settings.det, sourceId: src }} />
            )}
            {tab === "discuss" && <DiscussTab ra={sel.ra} dec={sel.dec} />}
          </div>
        )}
      </aside>
    </div>
  );
}
