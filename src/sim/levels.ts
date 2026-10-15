// What: Level of the stat (docs/01-gdd.md 22.2): level 1 from zero, level 2 from levels.first, each next threshold ×levels.growth; the level a requirement asks for and the progress inside a level for the bar.
// Called by: sim/world.ts (gate requirement snapped to a level threshold), app/level-view.ts (bar, «Level up!»), level/stage-slope.ts and level/validate-stages.ts; tests/sim/levels.test.ts.
// Keep: Pure; thresholds only from balance.json levels; levelOf(levelThreshold(n)) === n for every n ≥ 1; no DOM.

export interface Levels {
  /** Threshold of level 2 (level 1 starts at zero). */
  first: number;
  /** Each next threshold is the previous ×growth. */
  growth: number;
}

/** Relative slack for float noise: a requirement stored with 3 decimals still asks for its own level. */
const EPS = 1e-4;

/** The stat at which level n starts (level 1 — zero). */
export function levelThreshold(n: number, l: Levels): number {
  return n <= 1 ? 0 : l.first * l.growth ** (n - 2);
}

/** The level of a stat: the biggest n with levelThreshold(n) ≤ stat. */
export function levelOf(stat: number, l: Levels): number {
  if (!(stat >= l.first * (1 - EPS))) return 1;
  let n = 2 + Math.floor(Math.log(stat / l.first) / Math.log(l.growth));
  while (n > 1 && levelThreshold(n, l) > stat * (1 + EPS)) n--;
  while (levelThreshold(n + 1, l) <= stat * (1 + EPS)) n++;
  return n;
}

/** The level a requirement asks for: the smallest n whose threshold is at least the requirement. */
export function levelNeeded(requirement: number, l: Levels): number {
  if (requirement <= 0) return 1;
  const n = levelOf(requirement, l);
  return levelThreshold(n, l) >= requirement * (1 - EPS) ? n : n + 1;
}

/** The nearest level to a stat on the log scale (docs/01-gdd.md 22.2: a ridge number becomes a level, ±9%). */
export function nearestLevel(stat: number, l: Levels): number {
  if (stat < l.first) return stat < l.first / Math.sqrt(l.growth) ? 1 : 2;
  return Math.max(2, 2 + Math.round(Math.log(stat / l.first) / Math.log(l.growth)));
}

/** The bar of the level: the level, the stat past its threshold and the step to the next one. */
export function levelProgress(stat: number, l: Levels): { level: number; have: number; need: number; frac: number } {
  const level = levelOf(stat, l);
  const from = levelThreshold(level, l);
  const need = levelThreshold(level + 1, l) - from;
  const have = Math.max(0, stat - from);
  return { level, have, need, frac: need > 0 ? Math.min(1, have / need) : 1 };
}
