// What: The portals of the base (docs/01-gdd.md 19.3–19.4): which open arch (passed or own mountain) the hero walked into between two positions — across its opening, the way in.
// Called by: main.ts (every tick on the base, after the sim step); tests/level/base.test.ts.
// Keep: Pure TS, no DOM; a locked arch is never entered (its ice is a collider of the hero); the arch geometry comes from level/base-layout.ts.

import type { BasePortal } from '../level/base-layout.ts';

/** How deep past the arch's plane the hero may be on the tick he crosses it (a fast run moves about 1 unit a tick). */
const CROSS_DEPTH = 2;

/**
 * The mountain of the open portal the hero crossed from (px, pz) to (x, z) — through its opening (|across| ≤ half its
 * width), from the field side into it; null — none. The way in of an arch is its yaw from +z.
 */
export function basePortalEntered(portals: readonly BasePortal[], px: number, pz: number, x: number, z: number): number | null {
  for (const p of portals) {
    if (p.state === 'locked') continue;
    const s = Math.sin(p.yaw);
    const c = Math.cos(p.yaw);
    const v0 = (px - p.x) * s + (pz - p.z) * c;
    const v1 = (x - p.x) * s + (z - p.z) * c;
    const u = (x - p.x) * c - (z - p.z) * s;
    if (v0 < 0 && v1 >= 0 && v1 <= CROSS_DEPTH && Math.abs(u) <= p.width / 2) return p.world;
  }
  return null;
}
