/**
 * Number display (docs/01-gdd.md 10.4): 999 → "999", 1234 → "1.23K" (ru "1,23K"), suffix letters come from i18n keys
 * num.K … num.Dc, the decimal separator from Intl.NumberFormat of the interface language.
 */
/** Formatter of the interface language: up to 2 fraction digits, no grouping (the suffix carries the size). */
let nf = makeFormat('en');

function makeFormat(lang: string): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(lang, { maximumFractionDigits: 2, useGrouping: false });
  } catch {
    return new Intl.NumberFormat('en', { maximumFractionDigits: 2, useGrouping: false });
  }
}

/** Picks the number format of `lang` (ru → "1,23K", en → "1.23K"). */
export function setNumberLocale(lang: string): void {
  nf = makeFormat(lang);
}

export const SUFFIX_KEYS = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'] as const;

/** Float slack: 1e33 / 1000^11 may land a hair under 1, the display must still read «1Dc». */
const EPS = 1e-12;

/**
 * 999 → "999"; from 1000 on — 3 significant digits, cut down (never rounded up: 1999 is «1.99K», so a price or a
 * requirement never looks reached before it is) and a suffix K … Dc; past Dc the number before Dc grows.
 */
export function formatNumber(n: number, suffix: (key: string) => string = (k) => k): string {
  if (!Number.isFinite(n)) return '0';
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(n);
  if (v < 1000) return sign + String(Math.floor(v));
  let group = 0;
  while (group < SUFFIX_KEYS.length && v >= Math.pow(1000, group + 1) * (1 - EPS)) group++;
  const m = v / Math.pow(1000, group);
  const intDigits = m >= 100 * (1 - EPS) ? 3 : m >= 10 * (1 - EPS) ? 2 : 1;
  const scale = Math.pow(10, Math.max(0, 3 - intDigits));
  const cut = Math.floor(m * scale * (1 + EPS)) / scale;
  return sign + nf.format(cut) + suffix(SUFFIX_KEYS[group - 1] as string);
}

/** A multiplier (×1.1, ×1.65, ×12.5): 3 significant digits below 1000 too, cut down; from 1000 on as formatNumber. */
export function formatMult(n: number, suffix: (key: string) => string = (k) => k): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n >= 1000) return formatNumber(n, suffix);
  const intDigits = n >= 100 * (1 - EPS) ? 3 : n >= 10 * (1 - EPS) ? 2 : 1;
  const scale = Math.pow(10, 3 - intDigits);
  return nf.format(Math.floor(n * scale * (1 + EPS)) / scale);
}

/** Timer of docs/01-gdd.md 10.4: «2:41», over an hour «1:05:00». */
export function formatTimer(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
