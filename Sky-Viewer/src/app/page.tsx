"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowLeft, Globe, Link2, Map, Minus, Plus } from "lucide-react";
import ObservationPanel from "../components/ObservationPanel";
import TargetSidebar from "../components/TargetSidebar";
import TargetView from "../components/TargetView";
import { MoverScrubber, MoversPanel } from "../components/SolarSystemMovers";
import { About, Learn, ResearchHub, SkyFeed } from "../components/SiteSections";
import { fetchCachedLookup, fetchKnownTargets, loadObservations, resolveName, type KnownTarget, type LookupJobStatus, type LookupResponse } from "../lib/spherex";
import type { Mover, MoverPath, SkyPath } from "../lib/movers";
import SkyGlobe, { SkyMap } from "./SkyGlobe";

const NAV_ITEMS = [
  { id: "explore", label: "Explore" },
  { id: "target", label: "Target" },
  { id: "hub", label: "Research hub" },
  { id: "feed", label: "Sky feed" },
  { id: "learn", label: "Learn" },
  { id: "about", label: "About" },
] as const;
type NavId = (typeof NAV_ITEMS)[number]["id"];

export default function Home() {
  const [ra, setRa] = useState("133.79513");
  const [dec, setDec] = useState("-7.24515");
  const [targetName, setTargetName] = useState("WISE 0855");
  const [targetQuery, setTargetQuery] = useState("WISE 0855");
  const [targetDescription, setTargetDescription] = useState("Cold brown dwarf");
  const [knownTargets, setKnownTargets] = useState<KnownTarget[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState("wise-0855");
  const [size, setSize] = useState("0.1");
  const [detector, setDetector] = useState("2");
  const [viewMode, setViewMode] = useState<"globe" | "map">("globe");
  const [targetView, setTargetView] = useState(false);
  const [section, setSection] = useState<"sky" | "hub" | "feed" | "learn" | "about">("sky");
  const pickRef = useRef(0);
  const [zoom, setZoom] = useState(1);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<LookupResponse | null>(null);
  const [cacheHit, setCacheHit] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [falseColor, setFalseColor] = useState(false);
  const [failedPreview, setFailedPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<LookupJobStatus | null>(null);
  const [mover, setMover] = useState<{ mover: Mover; path: MoverPath } | null>(null);
  const [moverDay, setMoverDay] = useState(0);
  const [moverRequest, setMoverRequest] = useState<{ command: string; nonce: number } | null>(null);
  const skyPath: SkyPath | null = mover ? { name: mover.mover.name, points: mover.path.points, active: moverDay } : null;
  const timelineLength = result?.measurements.length ?? 0;
  const raNumber = Number.parseFloat(ra) || 0;
  const decNumber = Number.parseFloat(dec) || 0;
  const footprints = result?.footprints ?? [];
  const progressText = progress?.status === "measuring" && progress.total !== null
    ? `Measuring cutouts ${progress.completed} of ${progress.total}`
    : "Searching IRSA image footprints";

  useEffect(() => {
    let active = true;
    async function hydrateCachedTarget() {
      try {
        const targets = await fetchKnownTargets();
        if (!active) return;
        setKnownTargets(targets);
        const linked = new URLSearchParams(window.location.search);
        if (linked.has("ra") && linked.has("dec")) return;
        const defaultTarget = targets.find((target) => target.id === "wise-0855");
        if (!defaultTarget) return;
        setSelectedTargetId(defaultTarget.id);
        setTargetName(defaultTarget.name);
        setTargetQuery(defaultTarget.name);
        setTargetDescription(defaultTarget.description);
        const cached = await fetchCachedLookup(defaultTarget.ra, defaultTarget.dec, 0.1, "2");
        if (!active || !cached) return;
        setResult(cached);
        setCacheHit(true);
        setFrameIndex(0);
      } catch {
        return;
      }
    }
    void hydrateCachedTarget();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkedRa = Number(params.get("ra"));
    const linkedDec = Number(params.get("dec"));
    if (Number.isFinite(linkedRa) && Number.isFinite(linkedDec) && params.has("ra") && params.has("dec")) {
      // A shared link opens straight into the target view for that position.
      // A link that lands on a saved target uses that target's exact position, so its saved images open at once.
      void fetchKnownTargets().catch(() => [] as KnownTarget[]).then((targets) => {
        const near = targets.find((target) => Math.abs(target.ra - linkedRa) < 0.002 && Math.abs(target.dec - linkedDec) < 0.002);
        void pickSkyPoint(near?.ra ?? linkedRa, near?.dec ?? linkedDec);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!playing || timelineLength < 2) return;
    const timer = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % timelineLength);
    }, 850);
    return () => window.clearInterval(timer);
  }, [playing, timelineLength]);

  function setSkyPoint(nextRa: number, nextDec: number) {
    setRa(nextRa.toFixed(5));
    setDec(nextDec.toFixed(5));
    setSelectedTargetId("");
    setTargetName("Custom sky region");
    setTargetQuery("");
    setTargetDescription("No named object here");
    setResult(null);
    setCacheHit(false);
    setFrameIndex(0);
    setPlaying(false);
    setError("");
    setStatusMessage("Point selected. Locate in sky checks Redis; load observations queries IRSA.");
  }

  async function runLookup(nextRa: string, nextDec: string, pickId: number) {
    setError("");
    setFailedPreview(null);
    setLoading(true);
    setStatusMessage("No saved images for this point. Asking IRSA for the SPHEREx cutouts…");
    try {
      const job = await loadObservations(nextRa, nextDec, size, detector, setProgress);
      if (pickId !== pickRef.current) return;
      if (!job.result) throw new Error("The lookup completed without a result.");
      setResult(job.result);
      setCacheHit(Boolean(job.cache_hit || job.result.cache_hit));
      setFrameIndex(0);
      setStatusMessage("Loaded SPHEREx images from IRSA.");
    } catch (caught) {
      if (pickId !== pickRef.current) return;
      setError(caught instanceof Error ? caught.message : "Could not reach the lookup service. Check that the FastAPI server is running.");
    } finally {
      if (pickId === pickRef.current) {
        setLoading(false);
        setProgress(null);
      }
    }
  }

  async function ensureObservations(nextRa: number, nextDec: number) {
    const pickId = ++pickRef.current;
    const raText = nextRa.toFixed(5);
    const decText = nextDec.toFixed(5);
    setLoading(true);
    setStatusMessage("Checking saved images…");
    try {
      const cached = await fetchCachedLookup(Number(raText), Number(decText), Number(size), detector);
      if (pickId !== pickRef.current) return;
      if (cached) {
        setLoading(false);
        setResult(cached);
        setCacheHit(true);
        setStatusMessage("Loaded this point from the shared cache.");
        return;
      }
      if (detector !== "2" || Number(size) !== 0.1) {
        const seeded = await fetchCachedLookup(Number(raText), Number(decText), 0.1, "2");
        if (pickId !== pickRef.current) return;
        if (seeded) {
          setLoading(false);
          setSize("0.1");
          setDetector("2");
          setResult(seeded);
          setCacheHit(true);
          setStatusMessage("Loaded this point from the shared cache.");
          return;
        }
      }
    } catch {
      if (pickId !== pickRef.current) return;
    }
    await runLookup(raText, decText, pickId);
  }

  async function pickSkyPoint(nextRa: number, nextDec: number) {
    setSkyPoint(nextRa, nextDec);
    setTargetView(true);
    await ensureObservations(nextRa, nextDec);
  }

  function pickTarget(targetId: string) {
    void chooseTarget(targetId);
    setTargetView(true);
    setSection("sky");
  }

  function goTo(id: NavId) {
    if (id === "explore" || id === "target") {
      setSection("sky");
      setTargetView(id === "target");
      if (id === "target" && !result) void ensureObservations(raNumber, decNumber);
    } else {
      setSection(id);
    }
    window.scrollTo({ top: 0 });
  }

  const sectionProps = {
    knownTargets,
    onOpenTarget: (targetId: string) => { pickTarget(targetId); window.scrollTo({ top: 0 }); },
    onExplore: () => goTo("explore"),
    onShowMovers: () => {
      setSection("sky");
      setTargetView(false);
      setMoverRequest({ command: "433;", nonce: Date.now() });
      window.setTimeout(() => document.getElementById("movers")?.scrollIntoView({ behavior: "smooth" }), 60);
    },
  };

  function focusMoverDay(name: string, path: MoverPath, day: number) {
    const point = path.points[day];
    if (!point) return;
    setMoverDay(day);
    setRa(point.ra.toFixed(5));
    setDec(point.dec.toFixed(5));
    setSelectedTargetId("");
    setTargetName(`${name} · ${point.date}`);
    setTargetQuery(name);
    setTargetDescription(`Where JPL Horizons places ${name} on ${point.date}, seen from Earth's centre`);
    setResult(null);
    setCacheHit(false);
    setFrameIndex(0);
    setPlaying(false);
    setError("");
  }

  function showMoverPath(next: Mover, path: MoverPath) {
    setMover({ mover: next, path });
    focusMoverDay(next.name, path, 0);
    document.getElementById("explore")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function lookAtMoverDay() {
    if (!mover) return;
    const point = mover.path.points[moverDay];
    setStatusMessage(`SPHEREx images covering ${mover.mover.name}'s position on ${point.date}. Each image has its own date, so the asteroid sits elsewhere in images taken on other days.`);
    setTargetView(true);
    void ensureObservations(point.ra, point.dec);
  }

  function updateCoordinate(axis: "ra" | "dec", value: string) {
    if (axis === "ra") setRa(value);
    else setDec(value);
    setSelectedTargetId("");
    setTargetQuery("");
    setTargetName("Selected sky position");
    setTargetDescription("ICRS sky position");
    setResult(null);
    setCacheHit(false);
    setPlaying(false);
  }

  async function chooseTarget(targetId: string) {
    setSelectedTargetId(targetId);
    const target = knownTargets.find((candidate) => candidate.id === targetId);
    if (!target) {
      setTargetName("Selected sky position");
      setTargetQuery("");
      setTargetDescription("ICRS sky position");
      return;
    }
    setRa(target.ra.toFixed(5));
    setDec(target.dec.toFixed(5));
    setTargetName(target.name);
    setTargetQuery(target.name);
    setTargetDescription(target.description);
    setResult(null);
    setCacheHit(false);
    setFrameIndex(0);
    setPlaying(false);
    setError("");
    await ensureObservations(target.ra, target.dec);
  }

  async function searchKnownTarget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = targetQuery.trim();
    const folded = query.toLocaleLowerCase();
    const target = knownTargets.find((candidate) => candidate.name.toLocaleLowerCase() === folded)
      ?? knownTargets.find((candidate) => candidate.name.toLocaleLowerCase().includes(folded));
    if (target) {
      void chooseTarget(target.id);
      setTargetView(true);
      return;
    }
    setError("");
    setStatusMessage(`Looking up ${query}…`);
    try {
      const found = await resolveName(query);
      if (!found) {
        setError("No sky position for that name. Enter coordinates instead.");
        setStatusMessage("");
        return;
      }
      setSelectedTargetId("");
      setRa(found.ra.toFixed(5));
      setDec(found.dec.toFixed(5));
      setTargetName(found.name);
      setTargetDescription(found.typed ? "Coordinates you typed" : "Name resolved by Sesame");
      setTargetView(true);
      setResult(null);
      setCacheHit(false);
      setFrameIndex(0);
      setPlaying(false);
      await ensureObservations(found.ra, found.dec);
    } catch {
      setError("The name service did not answer. Enter coordinates instead.");
      setStatusMessage("");
    }
  }

  async function locateInSky(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);
    setCacheHit(false);
    setFrameIndex(0);
    setPlaying(false);
    setStatusMessage("Point selected. Checking Redis cache…");
    try {
      const cached = await fetchCachedLookup(Number(ra), Number(dec), Number(size), detector);
      if (cached) {
        setResult(cached);
        setCacheHit(true);
        setStatusMessage("Loaded this point from the shared cache.");
        return;
      }
    } catch {
      /* The live lookup below still runs. */
    }
    await runLookup(ra, dec, ++pickRef.current);
  }

  async function search(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setResult(null);
    setCacheHit(false);
    setFrameIndex(0);
    setPlaying(false);
    await runLookup(ra, dec, ++pickRef.current);
  }

  async function copyViewLink() {
    const url = new URL(window.location.href);
    url.searchParams.set("ra", ra);
    url.searchParams.set("dec", dec);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Clipboard access is unavailable in this browser.");
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="#explore" aria-label="Sky Timeline home">Sky Timeline</a>
        <nav className="main-nav" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => {
            const active = item.id === "explore" ? section === "sky" && !targetView
              : item.id === "target" ? section === "sky" && targetView
              : section === item.id;
            return (
              <a
                key={item.id}
                className={active ? "nav-active" : ""}
                href={`#${item.id}`}
                aria-current={active ? "page" : undefined}
                onClick={(event) => { event.preventDefault(); goTo(item.id); }}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
        <div className="data-source"><span className="status-dot" /> SPHEREx · IRSA</div>
      </header>

      {section === "hub" && <ResearchHub {...sectionProps} />}
      {section === "feed" && <SkyFeed {...sectionProps} />}
      {section === "learn" && <Learn {...sectionProps} />}
      {section === "about" && <About {...sectionProps} />}

      <div className={targetView ? "explore-layout is-target" : "explore-layout"} hidden={section !== "sky"}>
        {!targetView && <TargetSidebar
          knownTargets={knownTargets}
          selectedTargetId={selectedTargetId}
          targetQuery={targetQuery}
          onTargetQueryChange={setTargetQuery}
          ra={ra}
          dec={dec}
          onRaChange={(value) => updateCoordinate("ra", value)}
          onDecChange={(value) => updateCoordinate("dec", value)}
          size={size}
          onSizeChange={setSize}
          detector={detector}
          onDetectorChange={setDetector}
          loading={loading}
          progressText={progressText}
          statusMessage={statusMessage}
          onSearchKnownTarget={searchKnownTarget}
          onLocateInSky={locateInSky}
          onLoadObservations={() => void search()}
          onChooseTarget={pickTarget}
        />}

        <section className="sky-stage" id="explore" aria-label="Explore the sky">
          <div className="stage-heading">
            <p className="eyebrow">{targetView ? "Target view" : "Explore · whole sky"}</p>
            <h1>{targetView ? `Zoomed in on ${targetName}` : "A changing sky, one region at a time"}</h1>
            <p>Drag to rotate · click a target or any spot to go deeper</p>
            {targetView && (
              <button type="button" className="copy-link stage-back" onClick={() => setTargetView(false)}>
                <ArrowLeft size={16} /> Whole sky
              </button>
            )}
          </div>

          <div className="view-switch" role="group" aria-label="Sky view mode">
            <button type="button" className={viewMode === "globe" ? "view-active" : ""} aria-pressed={viewMode === "globe"} onClick={() => setViewMode("globe")}>
              <Globe size={17} /> 3D globe
            </button>
            <button type="button" className={viewMode === "map" ? "view-active" : ""} aria-pressed={viewMode === "map"} onClick={() => setViewMode("map")}>
              <Map size={17} /> 2D map
            </button>
          </div>

          <div className="stage-world">
            {viewMode === "globe" ? (
              <SkyGlobe
                ra={raNumber}
                dec={decNumber}
                zoom={zoom}
                deep={targetView}
                footprints={footprints}
                targets={knownTargets}
                selectedLabel={targetName}
                path={skyPath}
                onPick={(nextRa, nextDec) => void pickSkyPoint(nextRa, nextDec)}
                onPickTarget={pickTarget}
              />
            ) : (
              <SkyMap ra={raNumber} dec={decNumber} footprints={footprints} path={skyPath} onPick={(nextRa, nextDec) => void pickSkyPoint(nextRa, nextDec)} />
            )}
          </div>

          <div className="stage-footer">
            {mover && !targetView ? (
              <MoverScrubber
                mover={mover.mover}
                path={mover.path}
                day={moverDay}
                onDay={(day) => focusMoverDay(mover.mover.name, mover.path, day)}
                onLook={lookAtMoverDay}
                onClose={() => setMover(null)}
              />
            ) : (
              <div className="view-readout">
                <span>View centre RA {raNumber.toFixed(1)}° · Dec {decNumber >= 0 ? "+" : ""}{decNumber.toFixed(1)}°</span>
                <span>Illustrative star field · click to select a point</span>
              </div>
            )}
            <div className="stage-actions">
              <button type="button" className="copy-link" onClick={copyViewLink}>
                <Link2 size={16} /> {copied ? "Link copied" : "Copy view link"}
              </button>
              <div className="zoom-controls" aria-label="Globe zoom controls">
                <button type="button" aria-label="Zoom in" onClick={() => setZoom((current) => Math.min(1.45, current + 0.1))}><Plus size={19} /></button>
                <button type="button" aria-label="Zoom out" onClick={() => setZoom((current) => Math.max(0.75, current - 0.1))}><Minus size={19} /></button>
              </div>
            </div>
          </div>
        </section>

        {targetView ? (
          <TargetView
            targetName={targetName}
            targetDescription={targetDescription}
            ra={raNumber}
            dec={decNumber}
            fieldSize={Number(size) || 0.1}
            result={result}
            cacheHit={cacheHit}
            error={error}
            loading={loading}
            progressText={progressText}
            statusMessage={statusMessage}
            onLoadObservations={() => void search()}
          />
        ) : (
        <ObservationPanel
          targetName={targetName}
          targetDescription={targetDescription}
          ra={raNumber}
          dec={decNumber}
          result={result}
          cacheHit={cacheHit}
          error={error}
          frameIndex={frameIndex}
          onFrameIndexChange={setFrameIndex}
          playing={playing}
          onPlayingChange={setPlaying}
          falseColor={falseColor}
          onFalseColorChange={setFalseColor}
          failedPreview={failedPreview}
          onPreviewError={setFailedPreview}
        />
        )}
      </div>

      {section === "sky" && !targetView && (
        <MoversPanel
          request={moverRequest}
          active={mover}
          day={moverDay}
          onPath={showMoverPath}
        />
      )}
    </main>
  );
}