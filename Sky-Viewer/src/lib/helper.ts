import { formatMjd, type CatalogResponse, type Classification, type LookupResponse } from "./spherex";

export type HelperContext = {
  name: string;
  ra: number;
  dec: number;
  result: LookupResponse | null;
  score: Classification | null;
  catalogs: CatalogResponse | null;
};

const pct = (scores: Record<string, number> | undefined, label: string | undefined) =>
  label && scores ? `${Math.round((scores[label] ?? 0) * 100)}%` : "";

function vision(ctx: HelperContext) {
  const blink = ctx.score?.blink;
  if (!blink) return "The vision network has not looked at a pair of cutouts yet. Load the observations first.";
  const confidence = pct(blink.scores, blink.label);
  const shift = ctx.score?.shift_px;
  const moved = shift === null || shift === undefined ? "" : ` The center of light in those two previews moved ${shift.toFixed(1)} px.`;
  const caution = ctx.score?.notes?.[0] ? ` ${ctx.score.notes[0]}` : "";
  return `BlinkNet looked at the earliest and latest ${blink.detector ?? "cutout"} previews and reads ${blink.label} (${confidence}).${moved}${caution}`;
}

function spectrum(ctx: HelperContext) {
  const spec = ctx.score?.spectrum;
  if (!spec) return "SpecNet needs fluxes from several detectors. This lookup does not have enough bands yet.";
  return `SpecNet read the center pixel in ${spec.bands_used ?? "the"} detectors as ${spec.label} (${pct(spec.scores, spec.label)}). That pixel includes the sky around the object, so this is a candidate, not a separated spectrum.`;
}

export function askHelper(question: string, ctx: HelperContext): string {
  const q = question.toLowerCase();
  const frames = ctx.result?.measurements ?? [];
  const times = frames.map((item) => item.time_mjd).filter((value) => Number.isFinite(value));
  const flagged = frames.filter((item) => item.flag !== 0).length;

  if (/see|look|image|describe|vision|cutout/.test(q)) return vision(ctx);
  if (/move|blink|jump|chang/.test(q)) return vision(ctx);
  if (/spectrum|kind|dwarf|star|galaxy/.test(q)) return spectrum(ctx);
  if (/gaia|wise|source|catalog/.test(q)) {
    const gaia = ctx.catalogs?.gaia.length;
    const wise = ctx.catalogs?.wise.length;
    if (gaia === undefined || wise === undefined) return "The Gaia and AllWISE lists are still loading.";
    return `Inside this field, Gaia DR3 lists ${gaia} stars brighter than G = 18, and AllWISE lists ${wise} infrared sources. Those are published positions, drawn on the image when the cutout saved its sky grid.`;
  }
  if (/flag|quality|contamin/.test(q)) {
    if (!frames.length) return "No images are loaded, so there are no quality flags yet.";
    return `${flagged} of ${frames.length} measured images have a non-zero quality flag. A flag means that pixel is marked contaminated or unusable. It is not a discovery.`;
  }
  if (/how many|when|date|visit|image/.test(q)) {
    if (!times.length) return `${ctx.name} has no measured images loaded yet.`;
    const first = Math.min(...times);
    const last = Math.max(...times);
    return `${ctx.name} has ${frames.length} measured images, from ${formatMjd(first)} to ${formatMjd(last)}. The archive reported ${ctx.result?.images_found ?? frames.length} images via ${ctx.result?.discovery_source ?? "IRSA"}.`;
  }
  if (/how|blink|subtract|help|what can/.test(q)) {
    return "Play Timelapse for the dates, Blink to flip image A and B, and Subtract or Heatmap to see what changed. I use BlinkNet on those cutouts and SpecNet on the detector fluxes.";
  }
  return `${vision(ctx)} ${spectrum(ctx)} Ask what I see, whether it moved, which sources are here, or what the quality flags say.`;
}
