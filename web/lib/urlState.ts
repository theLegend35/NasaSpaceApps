"use client";

// Every view writes its state to the URL with history.replaceState (debounced),
// so a link restores the exact view (design doc Feature 1 step 7, Feature 15).

export type ViewState = {
  ra?: number;
  dec?: number;
  fov?: number; // globe field of view, degrees
  target?: string; // name or id, e.g. "WISE 0855"
  panel?: "closed" | "compact" | "deep";
  tab?: string;
  det?: string;
  cfov?: number; // cutout field of view, arcmin
  mode?: "blink" | "difference" | "stack" | "coadd" | "rgb";
  baseline?: "none" | "allwise";
  mask?: boolean;
  frame?: number;
  src?: string;
  mission?: string;
};

const NUM = new Set(["ra", "dec", "fov", "cfov", "frame"]);
const BOOL = new Set(["mask"]);

export function readUrlState(search: string): ViewState {
  const p = new URLSearchParams(search);
  const out: Record<string, unknown> = {};
  p.forEach((v, k) => {
    if (NUM.has(k)) {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
    } else if (BOOL.has(k)) out[k] = v === "1" || v === "true";
    else out[k] = v;
  });
  return out as ViewState;
}

export function toQuery(s: ViewState): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(s)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    if (typeof v === "number") p.set(k, k === "frame" ? String(v) : v.toFixed(k === "ra" || k === "dec" ? 5 : 2));
    else if (v === true) p.set(k, "1");
    else p.set(k, String(v));
  }
  return p.toString();
}

let timer: ReturnType<typeof setTimeout> | undefined;
export function writeUrlState(s: ViewState, delay = 300) {
  if (typeof window === "undefined") return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const q = toQuery(s);
    const url = window.location.pathname + (q ? "?" + q : "");
    window.history.replaceState(null, "", url);
  }, delay);
}
