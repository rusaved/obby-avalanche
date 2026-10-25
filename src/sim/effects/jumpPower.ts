// What: Stat effect jumpPower: takeoff speed of a jump = min(max, base * (1 + k * log10(1 + stat))) from the data curve jumpCurve.
// Called by: sim/effects/index.ts (statCurves); sim/world.ts (each tick), level/validate.ts (reach of a ledge); tests/sim/jump-power.test.ts.
// Keep: A stat-effect module stays tiny (under 100 lines, docs/01a section 14); the curve comes from balance.json jumpCurve.

/** Stat effect `jumpPower` (docs/01a-content.md 14.2): takeoff speed, units/s — the same form as `moveSpeed`. */
import type { Curve } from '../../content/types.ts';

export function jumpPower(stat: number, curve: Curve): number {
  const s = Math.max(0, stat);
  return Math.min(curve.max, curve.base * (1 + curve.k * Math.log10(1 + s)));
}
