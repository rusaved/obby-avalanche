// What: Stat effect moveSpeed: run speed = min(max, base * (1 + k * log10(1 + stat))) from a data curve.
// Called by: sim/world.ts, main.ts, level/{generate,validate}.ts, scripts/balance-model.ts; tests/content/*, tests/level/mountain.test.ts, tests/sim/steps.test.ts
// Keep: A stat-effect module stays tiny (under 100 lines, docs/01a section 14); curve base/k/max come from balance.json; generator, validator, model share it.

/** Stat effect `moveSpeed` (docs/02-tech.md 5.3, 6.1): run speed = min(max, base × (1 + k·log10(1 + stat))). */
import type { Curve } from '../../content/types.ts';

export function moveSpeed(stat: number, curve: Curve): number {
  const s = Math.max(0, stat);
  return Math.min(curve.max, curve.base * (1 + curve.k * Math.log10(1 + s)));
}
