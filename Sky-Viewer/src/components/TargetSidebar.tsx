import type { FormEvent } from "react";
import { ArrowRight, Search, Star } from "lucide-react";
import type { KnownTarget } from "../lib/spherex";

type TargetSidebarProps = {
  knownTargets: KnownTarget[];
  selectedTargetId: string;
  targetQuery: string;
  onTargetQueryChange: (value: string) => void;
  ra: string;
  dec: string;
  onRaChange: (value: string) => void;
  onDecChange: (value: string) => void;
  size: string;
  onSizeChange: (value: string) => void;
  detector: string;
  onDetectorChange: (value: string) => void;
  loading: boolean;
  progressText: string;
  statusMessage: string;
  onSearchKnownTarget: (event: FormEvent<HTMLFormElement>) => void;
  onLocateInSky: (event: FormEvent<HTMLFormElement>) => void;
  onLoadObservations: () => void;
  onChooseTarget: (targetId: string) => void;
};

export default function TargetSidebar({
  knownTargets,
  selectedTargetId,
  targetQuery,
  onTargetQueryChange,
  ra,
  dec,
  onRaChange,
  onDecChange,
  size,
  onSizeChange,
  detector,
  onDetectorChange,
  loading,
  progressText,
  statusMessage,
  onSearchKnownTarget,
  onLocateInSky,
  onLoadObservations,
  onChooseTarget,
}: TargetSidebarProps) {
  return (
    <aside className="target-sidebar" aria-label="Find a target or coordinate">
      <div className="sidebar-intro">
        <h2>Pick a spot.<br />Watch it change.</h2>
        <p>Search for an object or enter a position. Then watch real observations over time.</p>
      </div>

      <form className="target-search" onSubmit={onSearchKnownTarget}>
        <label htmlFor="target-query">Search the sky</label>
        <div className="target-search-row">
          <input id="target-query" value={targetQuery} onChange={(event) => onTargetQueryChange(event.target.value)} placeholder="Object name" />
          <button type="submit" aria-label="Find target"><Search size={17} /></button>
        </div>
      </form>

      <p className="sidebar-divider">Or go to coordinates</p>
      <form className="coordinate-form" onSubmit={onLocateInSky}>
        <div className="coordinate-fields">
          <label>
            <span>Right ascension</span>
            <input name="ra" type="number" min="0" max="360" step="any" required value={ra} onChange={(event) => onRaChange(event.target.value)} />
            <small>degrees</small>
          </label>
          <label>
            <span>Declination</span>
            <input name="dec" type="number" min="-90" max="90" step="any" required value={dec} onChange={(event) => onDecChange(event.target.value)} />
            <small>degrees</small>
          </label>
        </div>
        <div className="query-options">
          <label>
            <span>Cutout size</span>
            <input name="size" type="number" min="0.001" max="1" step="any" required value={size} onChange={(event) => onSizeChange(event.target.value)} />
          </label>
          <label>
            <span>Detector</span>
            <select name="detector" value={detector} onChange={(event) => onDetectorChange(event.target.value)}>
              <option value="">All</option>
              {[1, 2, 3, 4, 5, 6].map((number) => <option value={number} key={number}>D{number}</option>)}
            </select>
          </label>
        </div>
        <div className="coordinate-actions">
          <button className="load-button" type="submit">Locate in sky <ArrowRight size={17} /></button>
          <button className="archive-button" type="button" disabled={loading} onClick={onLoadObservations}>
            {loading ? <><span className="button-spinner" /> {progressText}</> : "Load observations"}
          </button>
        </div>
      </form>
      <p className="coordinate-hint">Enter coordinates in decimal degrees.</p>
      {statusMessage && <p className="action-message" role="status">{statusMessage}</p>}

      <section className="example-targets" aria-label="Example targets">
        <h3>Example targets</h3>
        <div>
          {knownTargets.map((target) => (
            <button
              type="button"
              className={`example-target${selectedTargetId === target.id ? " example-target-selected" : ""}`}
              key={target.id}
              onClick={() => onChooseTarget(target.id)}
            >
              <Star size={18} aria-hidden="true" />
              <span><strong>{target.name}</strong><small>{target.description}</small></span>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}