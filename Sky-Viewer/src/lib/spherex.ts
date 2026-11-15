export type Measurement = {
  time_mjd: number;
  detector: string;
  wavelength_um: number;
  bandwidth_um: number;
  flux: number | null;
  variance: number | null;
  flag: number;
  flux_unit: string;
  cutout_url: string;
  preview_x: number;
  preview_y: number;
};

export type LookupResponse = {
  ra: number;
  dec: number;
  discovery_source: "TAP" | "SIA" | "unknown";
  cache_hit?: boolean;
  images_found: number;
  images_measured: number;
  measurements: Measurement[];
  footprints: number[][][];
};

export type KnownTarget = {
  id: string;
  name: string;
  description: string;
  ra: number;
  dec: number;
};

export type LookupJobStatus = {
  status: "queued" | "searching" | "measuring" | "completed" | "failed";
  completed: number;
  total: number | null;
  result: LookupResponse | null;
  error: string | null;
  cache_hit?: boolean;
};

export async function fetchCachedLookup(
  ra: number,
  dec: number,
  size: number,
  detector: string,
): Promise<LookupResponse | null> {
  const params = new URLSearchParams({ ra: ra.toString(), dec: dec.toString(), size: size.toString() });
  if (detector) params.set("detector", detector);
  const response = await fetch(`/api/point/cache?${params}`, { cache: "no-store" });
  if (!response.ok) return null;
  return await response.json() as LookupResponse;
}

export async function fetchKnownTargets(): Promise<KnownTarget[]> {
  const response = await fetch("/api/targets", { cache: "no-store" });
  if (!response.ok) return [];
  return await response.json() as KnownTarget[];
}

export async function loadObservations(
  ra: string,
  dec: string,
  size: string,
  detector: string,
  onProgress: (progress: LookupJobStatus) => void,
): Promise<LookupJobStatus> {
  const params = new URLSearchParams({ ra, dec, size });
  if (detector) params.set("detector", detector);

  const startResponse = await fetch(`/api/point/jobs?${params}`, {
    method: "POST",
    cache: "no-store",
  });
  const startPayload: unknown = await startResponse.json().catch(() => null);
  if (!startResponse.ok || !startPayload || typeof startPayload !== "object" || !("job_id" in startPayload)) {
    throw new Error(`Could not start lookup (${startResponse.status}). Check the FastAPI server.`);
  }

  const jobId = String(startPayload.job_id);
  while (true) {
    await new Promise((resolve) => window.setTimeout(resolve, 1200));
    const statusResponse = await fetch(`/api/point/jobs/${jobId}`, { cache: "no-store" });
    const job: LookupJobStatus = await statusResponse.json();
    if (!statusResponse.ok) throw new Error(`Could not read lookup status (${statusResponse.status}).`);
    onProgress(job);
    if (job.status === "failed") throw new Error(job.error || "The archive lookup failed.");
    if (job.status === "completed" && job.result) return job;
  }
}

export function formatNumber(value: number | null, digits = 3) {
  return value !== null && Number.isFinite(value) ? value.toExponential(digits) : "Unavailable";
}

export function formatMjd(mjd: number) {
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date((mjd - 40587) * 86_400_000));
}