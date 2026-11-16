"use client";

import { useEffect, useState } from "react";
import { Pause, Play, Telescope, X } from "lucide-react";
import { fetchMoverPath } from "../lib/spherex";
import { MOVERS, SPANS, formatAngle, formatKm, todayUtc, type Mover, type MoverPath } from "../lib/movers";

type MoversPanelProps = {
  request: { command: string; nonce: number } | null;
  active: { mover: Mover; path: MoverPath } | null;
  day: number;
  onPath: (mover: Mover, path: MoverPath) => void;
};

export function MoversPanel({ request, active, day, onPath }: MoversPanelProps) {
  const [start, setStart] = useState("");
  const [span, setSpan] = useState<(typeof SPANS)[number]>(30);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => setStart(todayUtc()), []);

  async function follow(mover: Mover, days = span, from = start || todayUtc()) {
    setBusy(mover.command);
    setError("");
    try {
      onPath(mover, await fetchMoverPath(mover.command, from, days));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Horizons did not return a path.");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (!request) return;
    const mover = MOVERS.find((item) => item.command === request.command);
    if (mover) void follow(mover);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.nonce]);

  function changeSpan(next: (typeof SPANS)[number]) {
    setSpan(next);
    if (active) void follow(active.mover, next);
  }

  const point = active?.path.points[Math.min(day, active.path.points.length - 1)];

  return (
    <section className="movers" id="movers" aria-labelledby="movers-title">
      <header className="movers-head">
        <div>
          <p className="eyebrow">Solar system movers</p>
          <h2 id="movers-title">Follow a visited asteroid across the sky</h2>
          <p>Every world here has had a spacecraft fly past, orbit, or land. Pick one and its path is drawn on the globe and the map, one dot per day, from live JPL Horizons positions.</p>
        </div>
        <div className="movers-controls">
          <label>
            From
            {start ? <input type="date" value={start} min="2025-05-01" onChange={(event) => setStart(event.target.value)} /> : <span>today</span>}
          </label>
          <div className="movers-span" role="group" aria-label="Path length">
            {SPANS.map((option) => (
              <button key={option} type="button" aria-pressed={span === option} onClick={() => changeSpan(option)}>{option} days</button>
            ))}
          </div>
        </div>
      </header>

      <div className="movers-grid">
        {MOVERS.map((mover) => {
          const isActive = active?.mover.command === mover.command;
          return (
            <button key={mover.command} type="button" className={isActive ? "mover is-on" : "mover"} aria-pressed={isActive} onClick={() => void follow(mover)}>
              <strong>{mover.name}</strong>
              <span>{busy === mover.command ? "Asking Horizons…" : mover.visit}</span>
            </button>
          );
        })}
      </div>

      {error && <p className="movers-error">{error}</p>}
      {active && point && (
        <p className="movers-summary">
          <strong>{active.mover.name}</strong> crosses {formatAngle(active.path.travelled_deg)} of sky in {active.path.points.length - 1} steps of {active.path.step_days} {active.path.step_days === 1 ? "day" : "days"}, about {formatAngle(active.path.per_day_deg)} a day.
          On {point.date} it is {formatKm(point.earth_km)} from Earth and {point.closing_km_s >= 0 ? "closing in" : "pulling away"} at {Math.abs(point.closing_km_s).toFixed(1)} km/s.
        </p>
      )}
    </section>
  );
}

type MoverScrubberProps = {
  mover: Mover;
  path: MoverPath;
  day: number;
  onDay: (day: number) => void;
  onLook: () => void;
  onClose: () => void;
};

export function MoverScrubber({ mover, path, day, onDay, onLook, onClose }: MoverScrubberProps) {
  const [playing, setPlaying] = useState(false);
  const last = path.points.length - 1;
  const point = path.points[Math.min(day, last)];

  useEffect(() => {
    if (!playing) return;
    if (day >= last) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => onDay(day + 1), 450);
    return () => window.clearTimeout(timer);
  }, [playing, day, last, onDay]);

  return (
    <div className="mover-scrub" role="group" aria-label={`${mover.name} path`}>
      <button type="button" className="mover-scrub-icon" aria-label={playing ? "Pause" : "Play the path"} onClick={() => { if (day >= last) onDay(0); setPlaying((value) => !value); }}>
        {playing ? <Pause size={15} /> : <Play size={15} />}
      </button>
      <div className="mover-scrub-track">
        <span><strong>{mover.name}</strong> · {point.date}</span>
        <input type="range" min={0} max={last} value={day} aria-label="Day along the path" onChange={(event) => { setPlaying(false); onDay(Number(event.target.value)); }} />
      </div>
      <button type="button" className="mover-scrub-look" onClick={onLook}><Telescope size={15} /> SPHEREx here</button>
      <button type="button" className="mover-scrub-icon" aria-label="Hide path" onClick={onClose}><X size={15} /></button>
    </div>
  );
}
