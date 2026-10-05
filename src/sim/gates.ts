/**
 * Ice walls with a number (docs/01-gdd.md 3.3, 8.1; GDD-07): a gate is open when the stat is at least its requirement.
 * Requirement of wall p (1…60 through all mountains of classic, 1…195 of the fast pace) on rebirth tier n:
 * wall(p) × wallScale[n] × ease(p); ease softens walls from `lateEase.fromWall` on tiers ≥ 1 (×toFactor at the last
 * wall). Pure TS.
 */
import type { BalanceJson } from '../content/types.ts';

export const WALLS_PER_WORLD = 12;
export const WALLS_TOTAL = 60;

/** Walls of the mountains before this one and of all of them (worlds.json); absent — 12 a mountain, 60 in all. */
export interface WallCount {
  before: number;
  total: number;
}

export function wallScale(tier: number, rebirth: BalanceJson['rebirth']): number {
  const table = rebirth.wallScale;
  const last = table.length - 1;
  if (tier <= last) return table[Math.max(0, tier)] ?? 1;
  return (table[last] ?? 1) * Math.pow(rebirth.wallScaleGrowth, tier - last);
}

export function lateEase(p: number, tier: number, rebirth: BalanceJson['rebirth'], total = WALLS_TOTAL): number {
  const { fromWall, toFactor } = rebirth.lateEase;
  if (tier < 1 || p < fromWall) return 1;
  const span = total - (fromWall - 1);
  return 1 - (1 - toFactor) * ((p - (fromWall - 1)) / span);
}

/** Requirement of a gate from its base number `wall(p)` (worlds.json `requires`). */
export function gateRequirement(baseRequires: number, worldIndex: number, wall: number, tier: number, rebirth: BalanceJson['rebirth'], walls?: WallCount): number {
  const p = (walls ? walls.before : WALLS_PER_WORLD * (worldIndex - 1)) + wall;
  return baseRequires * wallScale(tier, rebirth) * lateEase(p, tier, rebirth, walls?.total ?? WALLS_TOTAL);
}

export function gateIsOpen(stat: number, requirement: number): boolean {
  return stat >= requirement;
}
