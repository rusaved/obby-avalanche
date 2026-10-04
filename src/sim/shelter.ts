/**
 * Ice caves and treadmills (docs/01-gdd.md 4.3; docs/02-tech.md 8.2): the shelter is the whole cave volume (AABB)
 * plus `niche.graceDist` past the entrance onto the slope; a treadmill belt makes the hero run in place by himself.
 * Pure TS, no DOM.
 */
import type { LevelData, LevelNiche, LevelPoint } from '../level/types.ts';

/** Feet may be this much below the cave floor (step-up, snap) and still count as inside. */
const FEET_SLACK = 0.5;
/** A belt holds the hero while his feet are this close above it. */
const BELT_HEIGHT = 1.5;

/** −1 for a cave on the left edge of the track, +1 on the right. */
export function nicheSign(n: LevelNiche): number {
  return n.side === 'left' ? -1 : 1;
}

/** x of the cave entrance: the track edge the cave opens onto. */
export function entranceX(level: LevelData, n: LevelNiche): number {
  return nicheSign(n) * (level.width / 2);
}

/** Is the point inside cave `n` or within `graceDist` past its entrance onto the slope. */
export function inNiche(level: LevelData, n: LevelNiche, graceDist: number, x: number, y: number, z: number): boolean {
  const ex = entranceX(level, n);
  const lo = n.side === 'left' ? n.box.min[0] : ex - graceDist;
  const hi = n.side === 'left' ? ex + graceDist : n.box.max[0];
  return x >= lo && x <= hi && z >= n.box.min[2] && z <= n.box.max[2] && y >= n.box.min[1] - FEET_SLACK && y <= n.box.max[1];
}

/** Index of the cave sheltering the point, −1 when none. */
export function shelterIndex(level: LevelData, graceDist: number, x: number, y: number, z: number): number {
  return level.niches.findIndex((n) => inNiche(level, n, graceDist, x, y, z));
}

/** Distance on the ground plane from the point to the entrance opening of cave `n` (0 inside the opening line). */
export function distToEntrance(level: LevelData, n: LevelNiche, x: number, z: number): { dist: number; tx: number; tz: number } {
  const ex = entranceX(level, n);
  const tz = Math.min(n.box.max[2], Math.max(n.box.min[2], z));
  const outside = nicheSign(n) * (ex - x) > 0; // still on the track side of the entrance
  const dx = outside ? ex - x : 0;
  return { dist: Math.hypot(dx, tz - z), tx: ex, tz };
}

/** Camp or summit (worlds.json safeZones): the avalanche never catches there and pays nothing there. */
export function inSafeZone(level: LevelData, z: number): boolean {
  return level.safeZones.some(([a, b]) => z >= a && z <= b);
}

/** Treadmill belts of the mountain: in caves, in the camp and on the summit (docs/01-gdd.md 5.2). */
export function belts(level: LevelData): LevelPoint[] {
  return level.points.filter((p) => p.type === 'treadmill');
}

/** The belt under the feet, or null. */
export function beltAt(list: readonly LevelPoint[], x: number, y: number, z: number): LevelPoint | null {
  for (const p of list) {
    const w = typeof p['width'] === 'number' ? (p['width'] as number) : 0;
    const l = typeof p['length'] === 'number' ? (p['length'] as number) : 0;
    if (Math.abs(x - p.x) <= w / 2 && Math.abs(z - p.z) <= l / 2 && y >= p.y - FEET_SLACK && y <= p.y + BELT_HEIGHT) return p;
  }
  return null;
}
