// Shapes returned by the FastAPI backend (/api/v1). Keep in step with api/app/routers/v1.py.

export type Pos = { ra: number; dec: number };

export type SimbadInfo = {
  name: string;
  ra: number;
  dec: number;
  otype: string | null;
  spType: string | null;
  pmRa: number | null;
  pmDec: number | null;
  plx: number | null;
  epoch: number;
};

export type Resolved = {
  pos: Pos;
  posNow?: Pos & { epoch: number };
  name: string | null;
  source: string;
  target?: string | null;
  simbad?: SimbadInfo;
};

export type TargetItem = {
  id: string;
  name: string;
  kind: string;
  expected_class?: string;
  fast_mover?: boolean;
  detector?: string;
  pos: Pos | null;
  source?: string;
  simbad?: SimbadInfo | null;
  error?: string;
};

export type Frame = {
  id: string;
  kind: "spherex" | "coadd" | "stack" | "allwise" | "rgb";
  obsId: string | null;
  dateIso: string;
  mjd?: number;
  mjdRange?: [number, number];
  pass: number;
  detector: string;
  wavelengthUm: number | null;
  wavelengthRangeUm?: [number, number] | null;
  bandwidthUm?: number | null;
  release: string;
  flaggedFraction: number | null;
  nExposures: number | null;
  pngUrl: string;
  maskPngUrl?: string;
  epochLabel?: string;
};

export type CutoutsResponse = {
  field: { ra: number; dec: number; fovArcmin: number; n: number; pixelArcsec: number; orientation: string };
  mode: string;
  frames: Frame[];
  skipped: { obsId: string; detector: string; dateIso: string; reason: string }[];
  stretch: Record<string, unknown>;
  counts?: Record<string, number>;
  cached?: { date: string; source: string };
};

export type ScorePart = { name: string; weight: number; value: number | null; points: number; text: string };
export type ClassScore = { class: string; label: string; score: number; parts: ScorePart[]; missing: string[] };
export type Decision = { class: string; label: string; score: number; level: string; uncertain: boolean; wording: string };

export type Motion = {
  pmRaArcsecYr: number;
  pmDecArcsecYr: number;
  pmArcsecYr: number;
  errArcsecYr: number;
  significance: number | null;
  baselineYears: number;
  shiftPx: number;
  nEpochs: number;
  track: { t: number; uv: [number, number]; source: string }[];
};

export type Source = {
  id: string;
  ra: number;
  dec: number;
  uv: [number, number];
  gaia: { sourceId: string; g: number | null; sepArcsec: number } | null;
  gaiaStatus: "match" | "dark" | "unavailable";
  allwise: { designation: string; w1: number | null; w2: number | null; w1_w2: number | null; association: string } | null;
  motion: Motion | null;
  variabilitySigma: number | null;
  flaggedFraction: number;
  topFlag: string | null;
  clean: { rejected: boolean; reason: string | null; confidence: number | null; detail: string | null };
  tags: string[];
  topClass: Decision;
};

export type SourcesResponse = {
  field: { ra: number; dec: number; fovArcmin: number; detector: string; n: number };
  sources: Source[];
  capped: boolean;
  catalogs: { gaia: boolean; allwise: boolean };
  notes: string[];
  cached?: { date: string };
};

export type SpecPoint = {
  lambdaUm: number;
  bandwidthUm: number | null;
  fluxUjy: number;
  errUjy: number;
  upperLimit: boolean;
  detector: string;
  dateIso: string;
};

export type SpectrumResponse = {
  points: SpecPoint[];
  binned: (SpecPoint & { channel: number })[] | null;
  binnedTo102: boolean;
  summary: { nExposures: number; nMeasured: number; nUpperLimits: number; nDropped: number };
  indices: Record<string, number | null>;
  templateFits: { template: string; scale: number; redChi2: number }[];
  method: string;
  caveats: string[];
  cached?: { date: string };
};

export type ClassifyResponse = {
  decision: Decision;
  scores: ClassScore[];
  source: Source;
  spectrum: SpectrumResponse["summary"] | { error: string } | null;
  model: null | Record<string, number>;
  modelNote: string;
};

export type Fact = { id: string; text: string; source: string; url: string | null };
export type TutorResponse = {
  answer: string | null;
  citations: string[];
  facts: Fact[];
  droppedSentences: number;
  model: string | null;
  offline?: string;
  disclaimer?: string;
};

export type ApiErrorBody = { code: string; message: string; retryable: boolean };
