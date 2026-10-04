/** Number display (docs/01-gdd.md 10.4): 999 → "999", 1200 → "1.2K", suffix letters come from i18n keys num.K … num.Dc. */
export const SUFFIX_KEYS = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'] as const;

export function formatNumber(n: number, suffix: (key: string) => string = (k) => k): string {
  if (!Number.isFinite(n)) return '0';
  const neg = n < 0;
  let v = Math.abs(n);
  if (v < 1000) return (neg ? '-' : '') + String(Math.floor(v));
  let i = -1;
  while (v >= 1000 && i < SUFFIX_KEYS.length - 1) {
    v /= 1000;
    i++;
  }
  const digits = v < 10 ? 1 : v < 100 ? 1 : 0;
  let s = v.toFixed(digits);
  if (s.endsWith('.0')) s = s.slice(0, -2);
  if (digits === 1 && s.includes('.') && v >= 100) s = String(Math.floor(v));
  return (neg ? '-' : '') + s + suffix(SUFFIX_KEYS[i] as string);
}
