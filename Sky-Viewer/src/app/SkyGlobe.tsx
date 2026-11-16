"use client";

import { useCallback, useEffect, useRef } from "react";
import type { KnownTarget } from "../lib/spherex";

type Vec = [number, number, number];

type SkyGlobeProps = {
  ra: number;
  dec: number;
  zoom: number;
  deep: boolean;
  footprints: number[][][];
  targets: KnownTarget[];
  selectedLabel: string;
  onPick: (ra: number, dec: number) => void;
  onPickTarget: (targetId: string) => void;
};

type SkyMapProps = {
  ra: number;
  dec: number;
  footprints: number[][][];
  onPick: (ra: number, dec: number) => void;
};

type Pin = { x: number; y: number; front: boolean; id: string };

const DEG = Math.PI / 180;
const DEEP_ZOOM = 2.3;
const FLY_MS = 900;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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

export function SkyMap({ ra, dec, footprints, onPick }: SkyMapProps) {
  function pickPosition(event: React.MouseEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    const y = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
    onPick(x * 360, 90 - y * 180);
  }

  return (
    <div
      className="sky-map"
      role="application"
      aria-label="Interactive all-sky map. Click to set the selected coordinate."
      tabIndex={0}
      onClick={pickPosition}
    >
      <div className="map-graticule" />
      <svg className="footprint-layer" viewBox="0 0 360 180" preserveAspectRatio="none" aria-hidden="true">
        {footprints.map((polygon, index) => (
          <polygon key={index} points={polygon.map(([longitude, latitude]) => `${longitude},${90 - latitude}`).join(" ")} />
        ))}
      </svg>
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
      <span className="map-ra-label map-ra-left">0°</span>
      <span className="map-ra-label map-ra-right">360°</span>
      <span className="map-dec-label map-dec-top">+90°</span>
      <span className="map-dec-label map-dec-bottom">−90°</span>
      <span
        className="map-selected-point"
        style={{ left: `${(ra / 360) * 100}%`, top: `${((90 - dec) / 180) * 100}%` }}
      />
    </div>
  );
}

export default function SkyGlobe({ ra, dec, zoom, deep, footprints, targets, selectedLabel, onPick, onPickTarget }: SkyGlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // View state: lon/tilt in radians (view centre RA = lon + 90°, Dec = tilt), scale multiplier.
  const viewRef = useRef({ lon: (ra - 90) * DEG, tilt: dec * DEG, scale: zoom * (deep ? DEEP_ZOOM : 1) });
  const rafRef = useRef(0);
  const pinsRef = useRef<Pin[]>([]);
  const dataRef = useRef({ ra, dec, footprints, targets, selectedLabel });
  dataRef.current = { ra, dec, footprints, targets, selectedLabel };
  const handlersRef = useRef({ onPick, onPickTarget });
  handlersRef.current = { onPick, onPickTarget };

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

    // Graticule: meridians every 30° of RA, parallels every 30° of Dec.
    for (let meridian = 0; meridian < 360; meridian += 30) {
      const points: Vec[] = [];
      for (let d = -90; d <= 90; d += 5) points.push(project(skyVec(meridian, d)));
      strokeFront(points, "rgba(181,171,252,.24)");
    }
    for (let parallel = -60; parallel <= 60; parallel += 30) {
      const points: Vec[] = [];
      for (let a = 0; a <= 360; a += 5) points.push(project(skyVec(a, parallel)));
      strokeFront(points, "rgba(181,171,252,.24)");
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
    ctx.restore();

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

  useEffect(() => { draw(); }, [draw, footprints, targets, selectedLabel]);

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

      const { R, cx, cy } = geometry(canvas);
      const x = (px - cx) / R, y2 = -(py - cy) / R, depth = 1 - x * x - y2 * y2;
      if (depth < 0) return;
      const z2 = Math.sqrt(depth);
      const ct = Math.cos(view.tilt), st = Math.sin(view.tilt);
      const y = y2 * ct + z2 * st, z = -y2 * st + z2 * ct;
      const cl = Math.cos(view.lon), sl = Math.sin(view.lon);
      const pickedRa = (Math.atan2(x * sl + z * cl, x * cl - z * sl) / DEG + 360) % 360;
      const pickedDec = Math.asin(clamp(y, -1, 1)) / DEG;
      handlersRef.current.onPick(pickedRa, pickedDec);
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
      />
    </div>
  );
}
