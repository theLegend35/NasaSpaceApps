"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SkyPath } from "../lib/movers";
import type { KnownTarget } from "../lib/spherex";
import { SKY_FIGURES } from "../lib/skyFigures";

type Vec = [number, number, number];

type SkyGlobeProps = {
  ra: number;
  dec: number;
  zoom: number;
  deep: boolean;
  footprints: number[][][];
  targets: KnownTarget[];
  selectedLabel: string;
  path?: SkyPath | null;
  onPick: (ra: number, dec: number) => void;
  onPickTarget: (targetId: string) => void;
};

type SkyMapProps = {
  ra: number;
  dec: number;
  footprints: number[][][];
  path?: SkyPath | null;
  onPick: (ra: number, dec: number) => void;
};

const PATH_COLOR = "#ff9d5c";

function mapPathRuns(points: SkyPath["points"]) {
  const runs: string[][] = [];
  let run: string[] = [];
  points.forEach((point, index) => {
    if (index > 0 && Math.abs(point.ra - points[index - 1].ra) > 180) {
      runs.push(run);
      run = [];
    }
    run.push(`${mapX(point.ra)},${90 - point.dec}`);
  });
  runs.push(run);
  return runs.filter((item) => item.length > 1);
}

type Pin = { x: number; y: number; front: boolean; id: string };

const DEG = Math.PI / 180;
const DEEP_ZOOM = 2.3;
const FLY_MS = 900;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const RA_LINES = Array.from({ length: 12 }, (_, index) => index * 30);
const DEC_LINES = [-60, -30, 0, 30, 60];
const decText = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value)}°`;

function formatSkyPoint(ra: number, dec: number) {
  const totalMinutes = Math.round((((ra % 360) + 360) % 360) / 15 * 60) % (24 * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const sign = dec >= 0 ? "+" : "−";
  return `RA ${hours}h ${String(minutes).padStart(2, "0")}m (${ra.toFixed(1)}°) · Dec ${sign}${Math.abs(dec).toFixed(1)}°`;
}

type Hover = { x: number; y: number; ra: number; dec: number; flip: boolean };

function HoverReadout({ hover }: { hover: Hover | null }) {
  if (!hover) return null;
  return (
    <span className={hover.flip ? "sky-hover is-flipped" : "sky-hover"} style={{ left: hover.x, top: hover.y }}>
      {formatSkyPoint(hover.ra, hover.dec)}
    </span>
  );
}

function SkyKey() {
  return (
    <div className="sky-key" aria-hidden="true">
      <span><b>RA</b> 0h–24h around the sky, increasing to the left as seen from Earth · 1h = 15°</span>
      <span><b>Dec</b> −90° south pole to +90° north pole</span>
      <span><i className="sky-key-line" /> Celestial equator, Dec 0°</span>
    </div>
  );
}

const mapX = (ra: number) => 360 - ra;

function seededRandom(seed: number) {
  let state = seed;
  return () => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;
}

function skyVec(ra: number, dec: number): Vec {
  const a = ra * DEG;
  const d = dec * DEG;
  return [Math.cos(d) * Math.cos(a), Math.sin(d), Math.cos(d) * Math.sin(a)];
}

// Illustrative star field: a uniform scatter plus a denser band tilted like the Milky Way.
const globeStars = (() => {
  const random = seededRandom(5);
  const tilt = 62.9 * DEG;
  const stars: { v: Vec; size: number; alpha: number }[] = [];
  for (let index = 0; index < 1500; index++) {
    const lon = random() * 2 * Math.PI;
    const uniform = index < 700;
    const lat = uniform ? Math.asin(random() * 2 - 1) : ((random() + random() + random()) / 3 - 0.5) * 0.7;
    const x = Math.cos(lat) * Math.cos(lon);
    const y = Math.sin(lat);
    const z = Math.cos(lat) * Math.sin(lon);
    stars.push(uniform
      ? { v: [x, y, z], size: Math.pow(random(), 4) * 1.5 + 0.4, alpha: 0.35 + random() * 0.6 }
      : { v: [x, y * Math.cos(tilt) - z * Math.sin(tilt), y * Math.sin(tilt) + z * Math.cos(tilt)], size: random() * 0.7 + 0.3, alpha: 0.2 + random() * 0.4 });
  }
  return stars;
})();

const mapStars = Array.from({ length: 420 }, (_, index) => {
  const fraction = (value: number) => value - Math.floor(value);
  return {
    x: fraction(Math.sin(index * 127.1) * 43758.5453),
    y: fraction(Math.sin(index * 311.7) * 24634.6345),
    size: index % 19 === 0 ? 2.4 : index % 5 === 0 ? 1.6 : 1,
    opacity: 0.24 + fraction(Math.sin(index * 17.31) * 15.7) * 0.65,
  };
});

export function SkyMap({ ra, dec, footprints, path = null, onPick }: SkyMapProps) {
  const [hover, setHover] = useState<Hover | null>(null);

  function skyAt(event: React.MouseEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    const y = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top, ra: (1 - x) * 360 % 360, dec: 90 - y * 180, flip: x > 0.6 };
  }

  function pickPosition(event: React.MouseEvent<HTMLDivElement>) {
    const point = skyAt(event);
    onPick(point.ra, point.dec);
  }

  return (
    <div
      className="sky-map"
      role="application"
      aria-label="Interactive all-sky map with right ascension and declination grid and constellation outlines. Click to set the selected coordinate."
      tabIndex={0}
      onClick={pickPosition}
      onMouseMove={(event) => setHover(skyAt(event))}
      onMouseLeave={() => setHover(null)}
    >
      <svg className="map-grid" viewBox="0 0 360 180" preserveAspectRatio="none" aria-hidden="true">
        {RA_LINES.slice(1).map((line) => <line key={`ra-${line}`} x1={line} y1={0} x2={line} y2={180} />)}
        {DEC_LINES.map((line) => <line key={`dec-${line}`} className={line === 0 ? "is-equator" : ""} x1={0} y1={90 - line} x2={360} y2={90 - line} />)}
      </svg>
      {RA_LINES.map((line) => (
        <span key={`ra-label-${line}`} className={line === 0 ? "map-axis-ra map-axis-end" : "map-axis-ra"} style={line === 0 ? undefined : { left: `${(mapX(line) / 360) * 100}%` }}>
          {line / 15}h<small>{line}°</small>
        </span>
      ))}
      <span className="map-axis-ra map-axis-start" style={{ left: 0 }}>24h<small>360°</small></span>
      {[90, ...DEC_LINES, -90].map((line) => (
        <span key={`dec-label-${line}`} className={line === 90 ? "map-axis-dec map-axis-top" : line === -90 ? "map-axis-dec map-axis-bottom" : "map-axis-dec"} style={{ top: `${((90 - line) / 180) * 100}%` }}>{decText(line)}</span>
      ))}
      <span className="map-axis-title map-axis-title-ra">← Right ascension increases to the left, as seen from Earth · 1h = 15°</span>
      <span className="map-axis-title map-axis-title-dec">Declination ↑</span>
      <span className="map-equator-label">Celestial equator · Dec 0°</span>
      <svg className="footprint-layer" viewBox="0 0 360 180" preserveAspectRatio="none" aria-hidden="true">
        {SKY_FIGURES.map((figure) => figure.lines.map((line, index) => (
          <polyline key={`${figure.name}-${index}`} className="constellation-line" points={line.map(([figureRa, figureDec]) => `${mapX(figureRa)},${90 - figureDec}`).join(" ")} />
        )))}
        {footprints.map((polygon, index) => (
          <polygon key={index} points={polygon.map(([longitude, latitude]) => `${mapX(longitude)},${90 - latitude}`).join(" ")} />
        ))}
        {path && mapPathRuns(path.points).map((run, index) => (
          <polyline key={`path-${index}`} className="map-path-line" points={run.join(" ")} />
        ))}
      </svg>
      {path?.points.map((point, index) => (
        <span
          key={point.date}
          className={index === path.active ? "map-path-dot is-active" : "map-path-dot"}
          style={{ left: `${(mapX(point.ra) / 360) * 100}%`, top: `${((90 - point.dec) / 180) * 100}%` }}
          title={`${path.name} · ${point.date}`}
        />
      ))}
      {path && [0, path.points.length - 1].filter((index) => index !== path.active).map((index) => (
        <span
          key={`path-label-${index}`}
          className="map-path-label"
          style={{ left: `${(mapX(path.points[index].ra) / 360) * 100}%`, top: `${((90 - path.points[index].dec) / 180) * 100}%` }}
        >
          {path.points[index].date}
        </span>
      ))}
      <span className="map-path-name" style={path ? { left: `${(mapX(path.points[path.active].ra) / 360) * 100}%`, top: `${((90 - path.points[path.active].dec) / 180) * 100}%` } : { display: "none" }}>
        {path ? `${path.name} · ${path.points[path.active].date}` : ""}
      </span>
      {SKY_FIGURES.map((figure) => (
        <span
          key={figure.name}
          className="map-figure-label"
          style={{ left: `${(mapX(figure.label[0]) / 360) * 100}%`, top: `${((90 - figure.label[1]) / 180) * 100}%` }}
        >
          {figure.name}
        </span>
      ))}
      {mapStars.map((star, index) => (
        <span
          className="map-star"
          key={index}
          style={{
            left: `${star.x * 100}%`,
            top: `${star.y * 100}%`,
            width: `${star.size}px`,
            height: `${star.size}px`,
            opacity: star.opacity,
          }}
        />
      ))}
      <span
        className="map-selected-point"
        style={{ left: `${(mapX(ra) / 360) * 100}%`, top: `${((90 - dec) / 180) * 100}%` }}
      />
      <HoverReadout hover={hover} />
    </div>
  );
}

export default function SkyGlobe({ ra, dec, zoom, deep, footprints, targets, selectedLabel, path = null, onPick, onPickTarget }: SkyGlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // View state: lon/tilt in radians (view centre RA = lon + 90°, Dec = tilt), scale multiplier.
  const viewRef = useRef({ lon: (ra - 90) * DEG, tilt: dec * DEG, scale: zoom * (deep ? DEEP_ZOOM : 1) });
  const rafRef = useRef(0);
  const pinsRef = useRef<Pin[]>([]);
  const dataRef = useRef({ ra, dec, footprints, targets, selectedLabel, path });
  dataRef.current = { ra, dec, footprints, targets, selectedLabel, path };
  const handlersRef = useRef({ onPick, onPickTarget });
  handlersRef.current = { onPick, onPickTarget };
  const [hover, setHover] = useState<Hover | null>(null);

  const geometry = (canvas: HTMLCanvasElement) => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    return { w, h, R: Math.min(w, h) * 0.34 * viewRef.current.scale, cx: w / 2, cy: h / 2 + 40 };
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.clientWidth || !canvas.clientHeight) return;
    const { w, h, R, cx, cy } = geometry(canvas);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const { lon, tilt, scale } = viewRef.current;
    const cl = Math.cos(lon), sl = Math.sin(lon), ct = Math.cos(tilt), st = Math.sin(tilt);
    const project = (v: Vec): Vec => {
      const x = v[0] * cl + v[2] * sl;
      const z = -v[0] * sl + v[2] * cl;
      const y = v[1] * ct - z * st;
      return [cx + R * x, cy - R * y, v[1] * st + z * ct];
    };

    // Halo and sphere body.
    const halo = ctx.createRadialGradient(cx, cy, R, cx, cy, R * 1.14);
    halo.addColorStop(0, "rgba(145,132,217,.22)");
    halo.addColorStop(1, "rgba(145,132,217,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.14, 0, Math.PI * 2);
    ctx.fill();

    const body = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R);
    body.addColorStop(0, "#353b80");
    body.addColorStop(0.55, "#262a60");
    body.addColorStop(1, "#161826");
    ctx.fillStyle = "#161826";
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = body;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();

    const strokeFront = (points: Vec[], color: string, width = 1) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let index = 1; index < points.length; index++) {
        const a = points[index - 1], b = points[index];
        if (a[2] <= 0 && b[2] <= 0) continue;
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
      }
      ctx.stroke();
    };

    // Graticule: meridians every 30° of RA (2 hours), parallels every 30° of Dec.
    for (const meridian of RA_LINES) {
      const points: Vec[] = [];
      for (let d = -90; d <= 90; d += 5) points.push(project(skyVec(meridian, d)));
      strokeFront(points, meridian === 0 ? "rgba(181,171,252,.5)" : "rgba(181,171,252,.24)", meridian === 0 ? 1.3 : 1);
    }
    for (const parallel of DEC_LINES) {
      const points: Vec[] = [];
      for (let a = 0; a <= 360; a += 5) points.push(project(skyVec(a, parallel)));
      strokeFront(points, parallel === 0 ? "rgba(143,211,255,.75)" : "rgba(181,171,252,.24)", parallel === 0 ? 1.8 : 1);
    }

    const figureLabels: { name: string; at: Vec }[] = [];
    for (const figure of SKY_FIGURES) {
      for (const line of figure.lines) {
        strokeFront(line.map(([figureRa, figureDec]) => project(skyVec(figureRa, figureDec))), "rgba(240,195,106,.9)", 1.4);
      }
      figureLabels.push({ name: figure.name, at: project(skyVec(figure.label[0], figure.label[1])) });
    }

    const starScale = Math.sqrt(scale);
    for (const star of globeStars) {
      const p = project(star.v);
      if (p[2] <= 0) continue;
      ctx.fillStyle = `rgba(233,233,237,${star.alpha})`;
      ctx.beginPath();
      ctx.arc(p[0], p[1], star.size * starScale, 0, Math.PI * 2);
      ctx.fill();
    }

    // Observation footprints returned by the lookup.
    const data = dataRef.current;
    for (const polygon of data.footprints) {
      if (polygon.length < 3) continue;
      const points = [...polygon, polygon[0]].map(([pRa, pDec]) => project(skyVec(pRa, pDec)));
      strokeFront(points, "rgba(210,206,253,.55)");
    }

    const pathPoints = data.path ? data.path.points.map((point) => project(skyVec(point.ra, point.dec))) : [];
    if (pathPoints.length > 1) {
      strokeFront(pathPoints, PATH_COLOR, 2);
      ctx.fillStyle = PATH_COLOR;
      for (const p of pathPoints) {
        if (p[2] <= 0) continue;
        ctx.beginPath();
        ctx.arc(p[0], p[1], 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    if (data.path && pathPoints.length > 1) {
      const active = pathPoints[Math.min(data.path.active, pathPoints.length - 1)];
      if (active[2] > 0) {
        ctx.strokeStyle = PATH_COLOR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(active[0], active[1], 7, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.font = `600 11px "DM Sans", "Helvetica Neue", sans-serif`;
      ctx.fillStyle = PATH_COLOR;
      for (const index of [0, pathPoints.length - 1]) {
        const p = pathPoints[index];
        if (index !== data.path.active && p[2] > 0.05) ctx.fillText(data.path.points[index].date, p[0] - 30, p[1] - 10);
      }
    }

    ctx.fillStyle = "rgba(246,231,193,.95)";
    ctx.font = `600 12px "DM Sans", "Helvetica Neue", sans-serif`;
    for (const figure of figureLabels) {
      if (figure.at[2] > 0.05) ctx.fillText(figure.name, figure.at[0] + 8, figure.at[1] - 8);
    }

    // Grid numbers: RA hours along the celestial equator, Dec degrees along one meridian beside the view centre.
    ctx.font = `500 11px "DM Mono", ui-monospace, monospace`;
    ctx.textAlign = "center";
    for (const meridian of RA_LINES) {
      const at = project(skyVec(meridian, 0));
      if (at[2] < 0.25) continue;
      ctx.fillStyle = "rgba(143,211,255,.95)";
      ctx.fillText(`${meridian / 15}h`, at[0], at[1] - 6);
      ctx.fillStyle = "rgba(190,186,220,.8)";
      ctx.fillText(`${meridian}°`, at[0], at[1] + 14);
    }
    const centreRa = lon / DEG + 90;
    const labelRa = Math.round((centreRa + 45) / 30) * 30;
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(220,216,245,.9)";
    for (const parallel of DEC_LINES) {
      if (parallel === 0) continue;
      const at = project(skyVec(labelRa, parallel));
      if (at[2] > 0.2) ctx.fillText(decText(parallel), at[0] + 4, at[1] - 4);
    }
    for (const [poleDec, name] of [[90, "North celestial pole · +90°"], [-90, "South celestial pole · −90°"]] as const) {
      const pole = project(skyVec(0, poleDec));
      if (pole[2] < 0.05) continue;
      ctx.fillStyle = "#8fd3ff";
      ctx.beginPath();
      ctx.arc(pole[0], pole[1], 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `600 11px "DM Sans", "Helvetica Neue", sans-serif`;
      ctx.fillText(name, pole[0] + 8, pole[1] + 4);
    }
    ctx.textAlign = "left";

    ctx.strokeStyle = "rgba(181,171,252,.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();

    // Known-target pins.
    const font = (size: number) => `500 ${size}px "DM Sans", "Helvetica Neue", sans-serif`;
    ctx.font = font(11);
    pinsRef.current = data.targets.map((target) => {
      const p = project(skyVec(target.ra, target.dec));
      const front = p[2] > 0.05;
      const isSelected = Math.abs(target.ra - data.ra) < 1e-4 && Math.abs(target.dec - data.dec) < 1e-4;
      if (front) {
        ctx.fillStyle = "#b5abfc";
        ctx.beginPath();
        ctx.arc(p[0], p[1], 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(181,171,252,.4)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p[0], p[1], 8, 0, Math.PI * 2);
        ctx.stroke();
        if (!isSelected) {
          ctx.fillStyle = "#cfd3e5";
          ctx.fillText(target.name, p[0] + 13, p[1] + 4);
        }
      }
      return { x: p[0], y: p[1], front, id: target.id };
    });

    // Selected-position crosshair.
    const sel = project(skyVec(data.ra, data.dec));
    if (sel[2] > 0) {
      const [x, y] = sel;
      const reveal = clamp((scale - 1.3) / 0.8, 0, 1);
      if (reveal > 0) {
        ctx.globalAlpha = reveal;
        ctx.strokeStyle = "#d2cefd";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(x - 44, y - 44, 88, 88);
        ctx.setLineDash([]);
        ctx.fillStyle = "#cfd3e5";
        ctx.fillText("Image area", x - 44, y + 60);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = "#f5f4ff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 13, 0, Math.PI * 2);
      ctx.moveTo(x - 24, y); ctx.lineTo(x - 13, y);
      ctx.moveTo(x + 13, y); ctx.lineTo(x + 24, y);
      ctx.moveTo(x, y - 24); ctx.lineTo(x, y - 13);
      ctx.moveTo(x, y + 13); ctx.lineTo(x, y + 24);
      ctx.stroke();
      ctx.fillStyle = "#f5f4ff";
      ctx.fillText(data.selectedLabel, x + 30, y - 2);
      ctx.fillStyle = "#b5abfc";
      ctx.font = font(9);
      ctx.fillText("SELECTED", x + 30, y + 11);
    }
  }, []);

  const fly = useCallback((toLon: number, toTilt: number, toScale: number) => {
    cancelAnimationFrame(rafRef.current);
    const view = viewRef.current;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const l0 = view.lon, t0 = view.tilt, s0 = view.scale;
    let dl = (toLon - l0) % (2 * Math.PI);
    if (dl > Math.PI) dl -= 2 * Math.PI;
    if (dl < -Math.PI) dl += 2 * Math.PI;
    const start = performance.now();
    const step = (now: number) => {
      const k = reduceMotion ? 1 : Math.min(1, (now - start) / FLY_MS);
      const eased = 1 - Math.pow(1 - k, 3);
      view.lon = l0 + dl * eased;
      view.tilt = t0 + (toTilt - t0) * eased;
      view.scale = s0 + (toScale - s0) * eased;
      draw();
      if (k < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [draw]);

  // Fly to the selection whenever it changes or we enter/leave the target view.
  useEffect(() => {
    fly((ra - 90) * DEG, dec * DEG, zoom * (deep ? DEEP_ZOOM : 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ra, dec, deep]);

  // Zoom buttons only change scale and keep the current orientation.
  useEffect(() => {
    const view = viewRef.current;
    fly(view.lon, view.tilt, zoom * (deep ? DEEP_ZOOM : 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  useEffect(() => { draw(); }, [draw, footprints, targets, selectedLabel, path]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    draw();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [draw]);

  function skyAt(canvas: HTMLCanvasElement, px: number, py: number) {
    const view = viewRef.current;
    const { R, cx, cy } = geometry(canvas);
    const x = (px - cx) / R, y2 = -(py - cy) / R, depth = 1 - x * x - y2 * y2;
    if (depth < 0) return null;
    const z2 = Math.sqrt(depth);
    const ct = Math.cos(view.tilt), st = Math.sin(view.tilt);
    const y = y2 * ct + z2 * st, z = -y2 * st + z2 * ct;
    const cl = Math.cos(view.lon), sl = Math.sin(view.lon);
    return {
      ra: (Math.atan2(x * sl + z * cl, x * cl - z * sl) / DEG + 360) % 360,
      dec: Math.asin(clamp(y, -1, 1)) / DEG,
    };
  }

  function handleHover(event: React.PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - bounds.left, py = event.clientY - bounds.top;
    const point = skyAt(event.currentTarget, px, py);
    setHover(point ? { x: px, y: py, ...point, flip: px > bounds.width * 0.6 } : null);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) return;
    cancelAnimationFrame(rafRef.current);
    const canvas = event.currentTarget;
    canvas.setPointerCapture(event.pointerId);
    const view = viewRef.current;
    const startX = event.clientX, startY = event.clientY, l0 = view.lon, t0 = view.tilt;
    let moved = 0;

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
      view.lon = l0 - (dx * 0.006) / view.scale;
      view.tilt = clamp(t0 + (dy * 0.006) / view.scale, -1.45, 1.45);
      draw();
    };
    const up = (ev: PointerEvent) => {
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      if (ev.type === "pointercancel" || moved > 5) return;

      const bounds = canvas.getBoundingClientRect();
      const px = ev.clientX - bounds.left, py = ev.clientY - bounds.top;
      const pin = pinsRef.current.find((p) => p.front && Math.hypot(p.x - px, p.y - py) < 16);
      if (pin) {
        handlersRef.current.onPickTarget(pin.id);
        return;
      }

      const picked = skyAt(canvas, px, py);
      if (picked) handlersRef.current.onPick(picked.ra, picked.dec);
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
  }

  return (
    <div className="globe-host">
      <canvas
        ref={canvasRef}
        className="globe-canvas"
        role="application"
        aria-label="Sky globe. Drag to rotate; click a target or any spot to open the target view."
        style={{ touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handleHover}
        onPointerLeave={() => setHover(null)}
      />
      <HoverReadout hover={hover} />
      <SkyKey />
    </div>
  );
}
