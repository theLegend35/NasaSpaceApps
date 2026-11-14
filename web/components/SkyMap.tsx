"use client";

// Sky globe (design doc Feature 1). One wrapper owns the Aladin Lite v3 instance
// and exposes goTo(ra, dec, fov). Aladin needs `window`, so this file is only
// ever loaded with next/dynamic(ssr: false).

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { TargetItem } from "@/lib/types";
import { apiGet } from "@/lib/api";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { A?: any }
}

const ALADIN_SRC = "https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js";

export const SURVEYS = [
  { id: "spherex", label: "SPHEREx quick-look", url: "https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube" },
  { id: "allwise", label: "AllWISE", url: "P/allWISE/color" },
  { id: "2mass", label: "2MASS", url: "P/2MASS/color" },
] as const;

export type SkyMapHandle = { goTo: (ra: number, dec: number, fovDeg?: number) => void };

type Props = {
  targets: TargetItem[];
  selected: { ra: number; dec: number } | null;
  initial?: { ra?: number; dec?: number; fov?: number };
  survey: string;
  showCoverage: boolean;
  onPick: (p: { ra: number; dec: number; targetId?: string }) => void;
  onView: (v: { ra: number; dec: number; fov: number }) => void;
  onCursor: (p: { ra: number; dec: number } | null) => void;
  onError: (msg: string) => void;
};

let loading: Promise<void> | null = null;
function loadAladin(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject();
  if (window.A) return Promise.resolve();
  if (!loading) {
    loading = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = ALADIN_SRC;
      s.async = true;
      s.onload = () => res();
      s.onerror = () => { loading = null; rej(new Error("Aladin Lite didn't load")); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

const SkyMap = forwardRef<SkyMapHandle, Props>(function SkyMap(p, ref) {
  const host = useRef<HTMLDivElement>(null);
  const al = useRef<any>(null);
  const pins = useRef<any>(null);
  const sel = useRef<any>(null);
  const cov = useRef<any>(null);
  const cb = useRef(p);
  cb.current = p;
  const [ready, setReady] = useState(false);

  useImperativeHandle(ref, () => ({
    goTo(ra, dec, fov) {
      if (!al.current) return;
      al.current.gotoRaDec(ra, dec);
      if (fov) al.current.setFoV(fov);
    },
  }));

  useEffect(() => {
    let dead = false;
    loadAladin()
      .then(() => window.A.init)
      .then(() => {
        if (dead || !host.current) return;
        const A = window.A;
        const init = p.initial || {};
        const a = A.aladin(host.current, {
          survey: SURVEYS.find((s) => s.id === p.survey)?.url ?? SURVEYS[0].url,
          fov: init.fov ?? 180,
          target: init.ra !== undefined && init.dec !== undefined ? `${init.ra} ${init.dec}` : "133.7578 -7.2420",
          projection: "SIN", // reads as a globe when zoomed out
          cooFrame: "ICRSd",
          showReticle: false,
          showZoomControl: false,
          showFullscreenControl: false,
          showLayersControl: false,
          showGotoControl: false,
          showFrame: false,
          showCooGridControl: false,
          showSimbadPointerControl: false,
          showProjectionControl: false,
          showContextMenu: false,
          showCooGrid: true,
        });
        al.current = a;
        pins.current = A.catalog({ name: "Targets", sourceSize: 14, color: "#b5abfc", shape: "circle", displayLabel: true, labelColumn: "name", labelColor: "#cfd3e5", labelFont: "12px Inter" });
        a.addCatalog(pins.current);
        sel.current = A.graphicOverlay({ color: "#f5f4ff", lineWidth: 1.5 });
        a.addOverlay(sel.current);
        cov.current = A.graphicOverlay({ color: "#b5abfc", lineWidth: 1 });
        a.addOverlay(cov.current);

        a.on("objectClicked", (o: any) => {
          if (!o) return;
          const d = o.data || {};
          cb.current.onPick({ ra: o.ra, dec: o.dec, targetId: d.id });
        });
        a.on("click", (e: any) => {
          if (!e || e.isDragging) return;
          let ra = e.ra, dec = e.dec;
          if ((ra === undefined || dec === undefined) && e.x !== undefined) {
            const w = a.pix2world(e.x, e.y);
            if (w) [ra, dec] = w;
          }
          if (ra !== undefined && dec !== undefined) cb.current.onPick({ ra: ((ra % 360) + 360) % 360, dec });
        });
        a.on("mouseMove", (e: any) => cb.current.onCursor(e && e.ra !== undefined ? { ra: e.ra, dec: e.dec } : null));
        const report = () => {
          const [ra, dec] = a.getRaDec();
          const fov = (a.getFov() || [180])[0];
          cb.current.onView({ ra, dec, fov });
        };
        a.on("positionChanged", report);
        a.on("zoomChanged", report);
        setReady(true);
      })
      .catch(() => p.onError("The sky viewer (Aladin Lite) couldn't load. Search and the panel still work."));
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Survey switch.
  useEffect(() => {
    if (!ready) return;
    const url = SURVEYS.find((s) => s.id === p.survey)?.url;
    try { al.current.setImageSurvey(url); } catch { p.onError("That background layer didn't load."); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.survey, ready]);

  // Target pins.
  useEffect(() => {
    if (!ready || !pins.current) return;
    const A = window.A;
    pins.current.removeAll();
    pins.current.addSources(
      p.targets.filter((t) => t.pos).map((t) => A.source(t.pos!.ra, t.pos!.dec, { name: t.name, id: t.id, kind: t.kind })),
    );
  }, [p.targets, ready]);

  // Selected spot: a reticle circle.
  useEffect(() => {
    if (!ready || !sel.current) return;
    sel.current.removeAll();
    if (p.selected) sel.current.add(window.A.circle(p.selected.ra, p.selected.dec, 0.1, { color: "#f5f4ff" }));
  }, [p.selected, ready]);

  // SPHEREx footprints near the view, only when zoomed in (FOV under ~10 deg), debounced 500 ms.
  useEffect(() => {
    if (!ready || !al.current) return;
    let t: ReturnType<typeof setTimeout>;
    let ctl: AbortController | null = null;
    const update = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        cov.current?.removeAll();
        if (!cb.current.showCoverage) return;
        const fov = (al.current.getFov() || [180])[0];
        if (fov > 10) return;
        const [ra, dec] = al.current.getRaDec();
        ctl?.abort();
        ctl = new AbortController();
        apiGet<{ footprints: { polygon: number[][] }[] }>("/coverage", { ra, dec, radius: Math.min(fov / 2, 3) }, ctl.signal)
          .then((r) => {
            cov.current?.removeAll();
            for (const f of r.footprints.slice(0, 400)) cov.current.add(window.A.polygon(f.polygon));
          })
          .catch(() => { /* never block the map on IRSA; the layer stays empty */ });
      }, 500);
    };
    al.current.on("positionChanged", update);
    al.current.on("zoomChanged", update);
    update();
    return () => { clearTimeout(t); ctl?.abort(); };
  }, [ready, p.showCoverage]);

  return <div ref={host} className="aladin-host" aria-label="Sky globe. Drag to spin, scroll to zoom, click a spot to open it." />;
});

export default SkyMap;
