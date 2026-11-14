"use client";

// /embed: just the player with compact controls and an "Open in SolaraX" link.

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import BlinkPlayer, { type PlayerSettings } from "@/components/BlinkPlayer";
import { apiGet, ApiError } from "@/lib/api";
import type { CutoutsResponse } from "@/lib/types";

function Embed() {
  const q = useSearchParams();
  const ra = Number(q.get("ra")), dec = Number(q.get("dec"));
  const settings: PlayerSettings = {
    det: q.get("det") ?? "D1", cfov: Number(q.get("fov") ?? 12), mode: "blink", diffRef: "median",
    baseline: q.get("baseline") === "allwise" ? "allwise" : "none", mask: false,
  };
  const [cut, setCut] = useState<CutoutsResponse | null>(null);
  const [err, setErr] = useState<{ message: string; retryable?: boolean } | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) { setErr({ message: "This embed needs ra and dec." }); return; }
    setErr(null);
    apiGet<CutoutsResponse>("/cutouts", { ra, dec, fov: settings.cfov, detector: settings.det, mode: "single", baseline: settings.baseline })
      .then(setCut).catch((e) => setErr({ message: e instanceof ApiError ? e.message : "Couldn't load.", retryable: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ra, dec, n]);
  const open = `/?${new URLSearchParams({ ra: String(ra), dec: String(dec), panel: "deep", det: settings.det, baseline: settings.baseline })}`;
  return (
    <main style={{ padding: "var(--space-4)", height: "100dvh", overflow: "auto" }}>
      <BlinkPlayer compact cut={cut} loading={!cut && !err} error={err} settings={settings} onSettings={() => {}} onStack={() => {}}
        onRetry={() => setN(n + 1)} counts={cut?.counts} motion={null} sources={null} selectedSource={null} />
      <div className="row" style={{ marginTop: "var(--space-3)" }}>
        <span className="small muted grow">Data: NASA SPHEREx/IRSA</span>
        <a className="btn btn-secondary small" href={open} target="_blank" rel="noreferrer">Open in SolaraX</a>
      </div>
    </main>
  );
}

export default function EmbedPage() {
  return <Suspense><Embed /></Suspense>;
}
