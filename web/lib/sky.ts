// Small sky helpers used for overlays. Every number they draw comes from catalog
// values the API returned (SIMBAD/Gaia proper motion) or our own measurements.

export const PIXEL_ARCSEC = 6.15;

export function mjdToJyear(mjd: number): number {
  return 2000 + (mjd - 51544.5) / 365.25;
}

export function isoToJyear(iso: string): number {
  const ms = Date.parse(iso);
  return 2000 + (ms / 86400000 + 40587 - 51544.5) / 365.25;
}

/** Linear proper-motion propagation. pmRa is mu_alpha* (includes cos dec), mas/yr. */
export function propagate(ra: number, dec: number, pmRa: number, pmDec: number, from: number, to: number) {
  const dt = to - from;
  const cosd = Math.max(Math.cos((dec * Math.PI) / 180), 1e-6);
  return { ra: ra + (pmRa * dt) / 3.6e6 / cosd, dec: dec + (pmDec * dt) / 3.6e6 };
}

/** Sky position -> fraction of the PNG (0..1, origin top-left, north up, east left). */
export function skyToUv(ra: number, dec: number, centre: { ra: number; dec: number }, fovArcmin: number) {
  const cosd = Math.cos((centre.dec * Math.PI) / 180);
  let dra = ra - centre.ra;
  if (dra > 180) dra -= 360;
  if (dra < -180) dra += 360;
  const x = dra * cosd * 3600; // arcsec east
  const y = (dec - centre.dec) * 3600; // arcsec north
  const size = fovArcmin * 60;
  return { u: 0.5 - x / size, v: 0.5 - y / size };
}

export function fmtRa(ra: number) {
  return ra.toFixed(4) + "°";
}

export function fmtDec(dec: number) {
  return (dec < 0 ? "−" : "+") + Math.abs(dec).toFixed(4) + "°";
}

export function fmtDate(iso: string, short = false) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const y = short ? String(d.getUTCFullYear()).slice(2) : d.getUTCFullYear();
  return `${d.getUTCDate()} ${m} ${y}`;
}

export function daysBetween(a: string, b: string) {
  return Math.abs(Math.round((Date.parse(b) - Date.parse(a)) / 864e5));
}

/** Parse what the search box accepts so we can skip the round-trip for plain coordinates. */
export function looksLikeCoords(q: string) {
  return /^\s*[+]?\d[\d.:hHmMsS\s]*[\s,]+[+\-−]?\d[\d.:dD°'"mMsS\s]*$/.test(q.trim());
}
