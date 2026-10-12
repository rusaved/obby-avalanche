// What: Ice cave geometry queries: is a point sheltered (cave volume plus graceDist), distance to the entrance, safe zones, treadmill belt lookup.
// Called by: sim/world.ts, sim/threat.ts, sim/bots.ts, sim/caught.ts, sim/bonus.ts, app/ftue-view.ts; tests/sim/shelter, threat, caught, bonus tests
// Keep: Pure TS, no DOM; graceDist comes from the caller (balance.niche); a cave counts by its whole AABB, so level/builder.ts niche boxes and this module must agree.

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

/** x of the cave entrance: the track edge the cave opens onto — its box's inner face (SP-04: every section its own width);
 * a grotto in a rock opens towards the camp: its middle. */
export function entranceX(level: LevelData, n: LevelNiche): number {
  if (n.kind === 'island') return (n.box.min[0] + n.box.max[0]) / 2;
  if (n.box.max[0] - n.box.min[0] > 0) return n.side === 'left' ? n.box.max[0] : n.box.min[0];
  return nicheSign(n) * (level.width / 2);
}

/** The first shelter of stretch `stretch` up the slope (the lowest, the lower index on a tie), ledges aside; −1 none. The
 * grottos in rocks (SP-04) come after the grottos of the edges in level.niches, so the order there is not the slope's. */
export function firstShelter(level: LevelData, stretch: number): number {
  let best = -1;
  level.niches.forEach((n, i) => {
    if (n.stretch !== stretch || n.kind === 'ledge') return;
    if (best < 0 || n.z < level.niches[best]!.z) best = i;
  });
  return best;
}

/** Is the point inside cave `n` or within `graceDist` past its entrance onto the slope; on a ledge — on its top. */
export function inNiche(level: LevelData, n: LevelNiche, graceDist: number, x: number, y: number, z: number): boolean {
  // A ledge on a cliff and a tunnel (docs/01-gdd.md 18.3) shelter by their volume: the front passes over them.
  if (n.kind === 'ledge' || n.kind === 'tunnel') return x >= n.box.min[0] && x <= n.box.max[0] && z >= n.box.min[2] && z <= n.box.max[2] && y >= n.box.min[1] - FEET_SLACK && y <= n.box.max[1];
  // A grotto in a rock (SP-04): its volume and graceDist out of its mouth towards the camp.
  if (n.kind === 'island') return x >= n.box.min[0] && x <= n.box.max[0] && z >= n.box.min[2] - graceDist && z <= n.box.max[2] && y >= n.box.min[1] - FEET_SLACK && y <= n.box.max[1];
  const ex = entranceX(level, n);
  const lo = n.side === 'left' ? n.box.min[0] : ex - graceDist;
  const hi = n.side === 'left' ? ex + graceDist : n.box.max[0];
  return x >= lo && x <= hi && z >= n.box.min[2] && z <= n.box.max[2] && y >= n.box.min[1] - FEET_SLACK && y <= n.box.max[1];
}

/** Index of the cave sheltering the point, −1 when none. */
export function shelterIndex(level: LevelData, graceDist: number, x: number, y: number, z: number): number {
  return level.niches.findIndex((n) => inNiche(level, n, graceDist, x, y, z));
}

/** Distance on the ground plane from the point to the entrance opening of cave `n` (0 inside the opening line); across
 * the cliff of a fork (open slope, docs/01-gdd.md 17.7) the way goes round its nearer end. */
export function distToEntrance(level: LevelData, n: LevelNiche, x: number, z: number): { dist: number; tx: number; tz: number } {
  if (n.kind === 'tunnel') {
    // A tunnel opens at both ends of its hall: inside — 0, else the nearer mouth by the ground.
    const mx = (n.box.min[0] + n.box.max[0]) / 2;
    if (x >= n.box.min[0] && x <= n.box.max[0] && z >= n.box.min[2] && z <= n.box.max[2]) return { dist: 0, tx: x, tz: z };
    const lo = { dist: groundPath(level, x, z, mx, n.box.min[2]), tx: mx, tz: n.box.min[2] };
    const hi = { dist: groundPath(level, x, z, mx, n.box.max[2]), tx: mx, tz: n.box.max[2] };
    return lo.dist <= hi.dist ? lo : hi;
  }
  if (n.kind === 'island') {
    // Its mouth faces the camp: inside — 0, else to the nearest point of the mouth by the ground.
    if (x >= n.box.min[0] && x <= n.box.max[0] && z >= n.box.min[2] && z <= n.box.max[2]) return { dist: 0, tx: x, tz: z };
    const tx = Math.min(n.box.max[0] - 1, Math.max(n.box.min[0] + 1, x));
    // Beside or above the rock: round its nearer corner first.
    if (z > n.box.min[2]) {
      const cx = x < (n.box.min[0] + n.box.max[0]) / 2 ? n.box.min[0] - 1 : n.box.max[0] + 1;
      return { dist: groundPath(level, x, z, cx, n.box.min[2] - 1) + Math.hypot(cx - tx, 1), tx, tz: n.box.min[2] };
    }
    return { dist: groundPath(level, x, z, tx, n.box.min[2]), tx, tz: n.box.min[2] };
  }
  const ex = entranceX(level, n);
  const tz = Math.min(n.box.max[2], Math.max(n.box.min[2], z));
  const outside = nicheSign(n) * (ex - x) > 0; // still on the track side of the entrance
  const dx = outside ? ex - x : 0;
  return { dist: groundPath(level, x, z, x + dx, tz), tx: ex, tz };
}

const cliffCache = new WeakMap<LevelData, Array<{ x0: number; x1: number; z0: number; z1: number }>>();

/** Ground distance from (x, z) to (tx, tz): straight, or round the end of a fork cliff that stands between them, or
 * through the gap of a throat (docs/01-gdd.md 18.3: its walls reach the track edge, the only way past is between them). */
export function groundPath(level: LevelData, x: number, z: number, tx: number, tz: number): number {
  for (const t of level.shapes ?? []) {
    if (t.kind !== 'throat') continue;
    const lo = Math.max(t.z0, Math.min(z, tz));
    const hi = Math.min(t.z1, Math.max(z, tz));
    if (lo >= hi) continue;
    const at = (zz: number): number => (tz === z ? x : x + ((tx - x) * (zz - z)) / (tz - z));
    if (Math.abs(at(lo)) <= t.x1 && Math.abs(at(hi)) <= t.x1) continue;
    // Into the gap at the near end (or where the point already is), out of it at the far end towards the target.
    const clampX = (v: number): number => Math.max(t.x0, Math.min(t.x1, v));
    const up = tz >= z;
    const inZ = (zz: number): boolean => zz > t.z0 && zz < t.z1;
    const a: [number, number] = inZ(z) ? [x, z] : [clampX(x), up ? t.z0 : t.z1];
    const b: [number, number] = inZ(tz) ? [tx, tz] : [clampX(tx), up ? t.z1 : t.z0];
    return Math.hypot(a[0] - x, a[1] - z) + Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(tx - b[0], tz - b[1]);
  }
  let cliffs = cliffCache.get(level);
  if (!cliffs) {
    cliffs = level.boxes.filter((b) => b.kind === 'cliff').map((b) => ({ x0: b.min[0], x1: b.max[0], z0: b.min[2], z1: b.max[2] }));
    cliffCache.set(level, cliffs);
  }
  const straight = Math.hypot(tx - x, tz - z);
  for (const c of cliffs) {
    const left = x <= c.x0 && tx >= c.x1;
    const right = x >= c.x1 && tx <= c.x0;
    if (!left && !right) continue;
    // Where the straight way crosses the middle of the cliff: past either end it does not touch it.
    const cx = (c.x0 + c.x1) / 2;
    const zc = tx === x ? z : z + ((tz - z) * (cx - x)) / (tx - x);
    if (zc < c.z0 || zc > c.z1) continue;
    const near = left ? c.x0 : c.x1;
    const far = left ? c.x1 : c.x0;
    const round = (e: number): number => Math.hypot(near - x, e - z) + Math.abs(far - near) + Math.hypot(tx - far, tz - e);
    return Math.min(round(c.z0), round(c.z1));
  }
  return straight;
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
