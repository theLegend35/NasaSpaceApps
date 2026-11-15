import type { Dispatch, SetStateAction } from "react";
import { ArrowRight, Palette, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { formatMjd, formatNumber, type LookupResponse } from "../lib/spherex";

type ObservationPanelProps = {
  targetName: string;
  targetDescription: string;
  ra: number;
  dec: number;
  result: LookupResponse | null;
  cacheHit: boolean;
  error: string;
  frameIndex: number;
  onFrameIndexChange: Dispatch<SetStateAction<number>>;
  playing: boolean;
  onPlayingChange: Dispatch<SetStateAction<boolean>>;
  falseColor: boolean;
  onFalseColorChange: (enabled: boolean) => void;
  failedPreview: string | null;
  onPreviewError: (src: string) => void;
};

export default function ObservationPanel({
  targetName,
  targetDescription,
  ra,
  dec,
  result,
  cacheHit,
  error,
  frameIndex,
  onFrameIndexChange,
  playing,
  onPlayingChange,
  falseColor,
  onFalseColorChange,
  failedPreview,
  onPreviewError,
}: ObservationPanelProps) {
  const timeline = result ? [...result.measurements].sort((a, b) => a.time_mjd - b.time_mjd) : [];
  const activeMeasurement = timeline[frameIndex] ?? null;
  const imageSrc = activeMeasurement
    ? `/api/point/image?cutout_url=${encodeURIComponent(activeMeasurement.cutout_url)}&false_color=${falseColor}`
    : null;
  const visitCount = new Set(timeline.map((measurement) => Math.floor(measurement.time_mjd))).size;

  function moveFrame(direction: number) {
    if (timeline.length === 0) return;
    onFrameIndexChange((current) => (current + direction + timeline.length) % timeline.length);
  }

  return (
    <aside className="location-panel" id="target-panel" aria-label="Selected location and observations">
      <div className="location-heading">
        <p className="eyebrow">Location panel</p>
        <h2>{targetName}</h2>
        <p className="location-coordinates">RA {ra.toFixed(3)}° · Dec {dec >= 0 ? "+" : ""}{dec.toFixed(3)}°</p>
        <p>{targetDescription}</p>
      </div>

      {error && <div className="notice" role="alert">{error}</div>}

      <section className="timeline-panel" id="timeline" aria-label="Observation timeline">
        <div className="image-frame">
          {imageSrc && failedPreview !== imageSrc ? (
            <div className="cutout-image-wrap">
              <img className="cutout-image" src={imageSrc} alt={`SPHEREx cutout for ${activeMeasurement?.detector}`} onError={() => onPreviewError(imageSrc)} />
              <span
                className="cutout-marker"
                style={{ left: `${activeMeasurement.preview_x * 100}%`, top: `${activeMeasurement.preview_y * 100}%` }}
                aria-hidden="true"
              />
            </div>
          ) : (
            <div className="image-empty">
              <span className="image-empty-grid" aria-hidden="true" />
              <strong>{result ? "No cutout preview available" : "No observation loaded"}</strong>
              <span>{result ? "Choose another frame or open its FITS file." : "Select a point and load its SPHEREx observations."}</span>
            </div>
          )}
          {activeMeasurement && <span className="frame-counter">Image {frameIndex + 1} of {timeline.length}</span>}
          {activeMeasurement && (
            <div className="image-mode-switch" role="group" aria-label="Image color mode">
              <button type="button" aria-pressed={!falseColor} onClick={() => onFalseColorChange(false)}>Grayscale</button>
              <button type="button" aria-pressed={falseColor} onClick={() => onFalseColorChange(true)}><Palette size={13} /> False color</button>
            </div>
          )}
          {activeMeasurement && <span className="image-label">{falseColor ? "False color · single band" : "Grayscale · single band"}</span>}
        </div>

        <div className="transport-row">
          <div className="transport-controls">
            <button type="button" aria-label="Previous image" disabled={timeline.length < 2} onClick={() => moveFrame(-1)}><SkipBack size={17} /></button>
            <button type="button" className="play-button" aria-label={playing ? "Pause timeline" : "Play timeline"} disabled={timeline.length < 2} onClick={() => onPlayingChange((current) => !current)}>
              {playing ? <Pause size={17} /> : <Play size={17} />}
            </button>
            <button type="button" aria-label="Next image" disabled={timeline.length < 2} onClick={() => moveFrame(1)}><SkipForward size={17} /></button>
          </div>
          <time>{activeMeasurement ? formatMjd(activeMeasurement.time_mjd) : "No date"}</time>
        </div>

        <input
          className="timeline-slider"
          aria-label="Select image from timeline"
          type="range"
          min="0"
          max={Math.max(timeline.length - 1, 0)}
          value={Math.min(frameIndex, Math.max(timeline.length - 1, 0))}
          disabled={timeline.length < 2}
          onChange={(event) => { onPlayingChange(false); onFrameIndexChange(Number(event.target.value)); }}
        />

        {activeMeasurement && (
          <div className="frame-details">
            <div><span>Wavelength</span><strong>{activeMeasurement.wavelength_um.toFixed(3)} µm</strong></div>
            <div><span>Flux</span><strong>{formatNumber(activeMeasurement.flux)} <small>{activeMeasurement.flux_unit}</small></strong></div>
            <div><span>Quality</span><strong className={activeMeasurement.flag === 0 ? "quality-clear" : "quality-flagged"}>{activeMeasurement.flag === 0 ? "Clear" : `Flag ${activeMeasurement.flag}`}</strong></div>
          </div>
        )}
      </section>

      {activeMeasurement ? (
        <a className="open-target" href={activeMeasurement.cutout_url} target="_blank" rel="noreferrer">
          Open FITS cutout <ArrowRight size={18} />
        </a>
      ) : (
        <button className="open-target" type="button" disabled>Open target view <ArrowRight size={18} /></button>
      )}

      <div className="location-stats">
        <div><span>Right ascension</span><strong>{ra.toFixed(3)}°</strong></div>
        <div><span>Declination</span><strong>{dec.toFixed(3)}°</strong></div>
      </div>

      {result && (
        <p className="result-caption">
          {result.images_found} images · {visitCount} visits · {timeline.length} measured frames
          {timeline.length > 1 && ` · ${formatMjd(timeline[0].time_mjd)} to ${formatMjd(timeline[timeline.length - 1].time_mjd)}`}
          {` · ${result.discovery_source}${result.discovery_source === "SIA" ? " (may lag ~1 day)" : ""}`}
          {cacheHit ? " · Redis cache hit" : " · saved in Redis"}
        </p>
      )}
    </aside>
  );
}