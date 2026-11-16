import type { MoverPath } from "./movers";

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
  wcs?: SkyGrid | null;
};

export type SkyGrid = {
  crpix: [number, number];
  crval: [number, number];
  cd: [[number, number], [number, number]];
  width: number;
  height: number;
};

export type CatalogSource = {
  catalog: string;
  name: string;
  ra: number;
  dec: number;
  brightness: number | null;
  brightness_label: string;
};

export type CatalogResponse = {
  radius_deg: number;
  gaia: CatalogSource[];
  wise: CatalogSource[];
  errors: string[];
};

export type ClassScores = {
  label: string;
  scores: Record<string, number>;
  detector?: string;
  a_mjd?: number;
  b_mjd?: number;
  bands_used?: number;
};

export type Classification = {
  blink: ClassScores | null;
  spectrum: ClassScores | null;
  shift_px: number | null;
  trained_on: string;
  notes?: string[];
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

/* Saved sky: lookups, previews and scores shipped as static files next to the site. */
type SeedIndex = { lookups: Set<string>; previews: Set<string>; scores: Set<string>; targets: KnownTarget[] };
let seedIndexPromise: Promise<SeedIndex> | null = null;
const staticPreviews = new Map<string, string>();
const seededScores = new WeakMap<Measurement[], string>();

function seedIndex(): Promise<SeedIndex> {
  seedIndexPromise ??= fetch("/seed/index.json")
    .then((response) => (response.ok ? response.json() : {}))
    .catch(() => ({}))
    .then((raw: { lookups?: string[]; previews?: string[]; scores?: string[]; targets?: KnownTarget[] }) => ({
      lookups: new Set<string>(raw.lookups ?? []),
      previews: new Set<string>(raw.previews ?? []),
      scores: new Set<string>(raw.scores ?? []),
      targets: (raw.targets ?? []) as KnownTarget[],
    }));
  return seedIndexPromise;
}

async function sha256Hex(text: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Same text the API hashes: a float rounded to 6 places, written the way Python writes it. */
function keyNumber(value: number) {
  const rounded = Number(value.toFixed(6));
  return Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded);
}

async function seededLookup(ra: number, dec: number, size: number, detector: string): Promise<LookupResponse | null> {
  const index = await seedIndex();
  if (index.lookups.size === 0) return null;
  const key = `{"dec":${keyNumber(dec)},"detector":${detector ? Number(detector) : "null"},"ra":${keyNumber(ra)},"size":${keyNumber(size)}}`;
  const digest = await sha256Hex(key);
  if (!index.lookups.has(digest)) return null;
  const response = await fetch(`/seed/lookups/${digest}.json`);
  if (!response.ok) return null;
  const result = await response.json() as LookupResponse;
  result.cache_hit = true;
  await Promise.all(result.measurements.map(async (item) => {
    if (staticPreviews.has(item.cutout_url)) return;
    const preview = await sha256Hex(item.cutout_url);
    if (index.previews.has(preview)) staticPreviews.set(item.cutout_url, `/seed/previews/${preview}.png`);
  }));
  if (index.scores.has(digest)) seededScores.set(result.measurements, digest);
  return result;
}

/** Address of a preview picture: the saved file when the site ships it, the API otherwise. */
export function previewSrc(cutoutUrl: string) {
  return staticPreviews.get(cutoutUrl) ?? `/api/point/image?cutout_url=${encodeURIComponent(cutoutUrl)}`;
}

export async function fetchCachedLookup(
  ra: number,
  dec: number,
  size: number,
  detector: string,
): Promise<LookupResponse | null> {
  const seeded = await seededLookup(ra, dec, size, detector).catch(() => null);
  if (seeded) return seeded;
  const params = new URLSearchParams({ ra: ra.toString(), dec: dec.toString(), size: size.toString() });
  if (detector) params.set("detector", detector);
  const response = await fetch(`/api/point/cache?${params}`, { cache: "no-store" }).catch(() => null);
  if (!response?.ok) return null;
  return await response.json() as LookupResponse;
}

/** Reads "17:57:48.5 +04:41:36", "17h57m48.5s +4d41m36s" or "269.45 4.69" as degrees. */
export function parseCoordinates(text: string): { ra: number; dec: number } | null {
  const clean = text.trim().replace(/−/g, "-");
  const pair = clean.match(/^(\d+(?:\.\d+)?)\s*[,\s]\s*([+-]?\d+(?:\.\d+)?)$/);
  if (pair) {
    const ra = Number(pair[1]), dec = Number(pair[2]);
    return ra >= 0 && ra < 360 && Math.abs(dec) <= 90 ? { ra, dec } : null;
  }
  const sexa = clean.match(/^(\d{1,2})[h:\s]+(\d{1,2})[m:\s]+(\d+(?:\.\d+)?)s?[,\s]+([+-]?)(\d{1,2})[d°:\s]+(\d{1,2})[m'′:\s]+(\d+(?:\.\d+)?)["″s]?$/i);
  if (!sexa) return null;
  const ra = (Number(sexa[1]) + Number(sexa[2]) / 60 + Number(sexa[3]) / 3600) * 15;
  const dec = (sexa[4] === "-" ? -1 : 1) * (Number(sexa[5]) + Number(sexa[6]) / 60 + Number(sexa[7]) / 3600);
  return ra < 360 && Math.abs(dec) <= 90 ? { ra, dec } : null;
}

export async function resolveName(name: string): Promise<{ name: string; ra: number; dec: number; typed?: boolean } | null> {
  const typed = parseCoordinates(name);
  if (typed) return { name: name.trim(), ...typed, typed: true };
  const response = await fetch(`/api/resolve?name=${encodeURIComponent(name)}`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("The name service did not answer.");
  return await response.json();
}

export async function fetchCatalogs(ra: number, dec: number, radius: number): Promise<CatalogResponse | null> {
  const params = new URLSearchParams({ ra: ra.toString(), dec: dec.toString(), radius: radius.toString() });
  const response = await fetch(`/api/catalogs?${params}`, { cache: "no-store" });
  if (!response.ok) return null;
  return await response.json() as CatalogResponse;
}

export async function classifyLookup(measurements: Measurement[]): Promise<Classification | null> {
  const digest = seededScores.get(measurements);
  if (digest) {
    const saved = await fetch(`/seed/scores/${digest}.json`).catch(() => null);
    if (saved?.ok) return await saved.json() as Classification;
  }
  const response = await fetch("/api/classify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ measurements }),
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) return null;
  return await response.json() as Classification;
}

/** Asks the API for a Gemini-written summary of numbers the app already measured. */
export async function explainTarget(facts: Record<string, unknown>): Promise<string> {
  const response = await fetch("/api/explain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ facts }),
    cache: "no-store",
  }).catch(() => null);
  const payload = await response?.json().catch(() => null);
  if (!response?.ok || !payload?.text) {
    throw new Error(payload?.detail ? String(payload.detail) : "The AI summary did not answer. The measured answers above still work.");
  }
  return String(payload.text);
}

export type HorizonsPoint = {
  name: string;
  date: string;
  when: string;
  ra: number;
  dec: number;
  note: string;
};

export async function fetchHorizons(name: string, when: string): Promise<HorizonsPoint> {
  const params = new URLSearchParams({ name, when });
  const response = await fetch(`/api/horizons?${params}`, { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "detail" in payload ? String(payload.detail) : "Horizons did not return a position.";
    throw new Error(detail);
  }
  return payload;
}

export async function fetchMoverPath(command: string, start: string, days: number): Promise<MoverPath> {
  const params = new URLSearchParams({ command, start, days: days.toString() });
  const response = await fetch(`/api/horizons/path?${params}`, { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "detail" in payload ? String(payload.detail) : "Horizons did not return a path.";
    throw new Error(detail);
  }
  return payload as MoverPath;
}

export async function fetchKnownTargets(): Promise<KnownTarget[]> {
  const saved = (await seedIndex()).targets;
  if (saved.length) return saved;
  const response = await fetch("/api/targets", { cache: "no-store" }).catch(() => null);
  if (!response?.ok) return [];
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