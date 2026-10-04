/** Stat effect `moveSpeed` (docs/02-tech.md 5.3, 6.1): run speed = min(max, base × (1 + k·log10(1 + stat))). */
import type { Curve } from '../../content/types.ts';

export function moveSpeed(stat: number, curve: Curve): number {
  const s = Math.max(0, stat);
  return Math.min(curve.max, curve.base * (1 + curve.k * Math.log10(1 + s)));
}
