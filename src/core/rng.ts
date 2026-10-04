/** Seeded RNG, mulberry32 (docs/02-tech.md 4.2). `Math.random` is forbidden in sim and meta. */
export interface Rng {
  readonly seed: number;
  /** Uniform in [0, 1). */
  next(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** Float in [a, b). */
  range(a: number, b: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Current internal state, for replays and tests. */
  state(): number;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed: seed >>> 0,
    next,
    int: (n) => Math.floor(next() * n),
    range: (a, b) => a + next() * (b - a),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error('rng.pick: empty list');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    state: () => s,
  };
}

/** Numeric seed from `?seed=` (number or any string, FNV-1a) or from the clock. */
export function seedFrom(value: string | number | null | undefined, fallback = Date.now()): number {
  if (value === null || value === undefined || value === '') return fallback >>> 0;
  if (typeof value === 'number') return value >>> 0;
  if (/^-?\d+$/.test(value)) return Number(value) >>> 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
