/**
 * «Snowed in!» (docs/01-gdd.md 4.5, GDD-04): the snow wraps the hero into a ball, the ball rolls down to the nearest
 * cave below him (none below — to the camp) in `caught.rollSec`, pops there, controls come back; the whole clip lasts
 * at most `caught.maxSec`. Nothing is lost: only the position changes. Pure TS, no DOM.
 */
import type { BalanceJson, TuningJson } from '../content/types.ts';
import type { LevelData } from '../level/types.ts';
import { entranceX, nicheSign } from './shelter.ts';

/** Where the ball stops inside a cave: this far in from the entrance, clear of the belt at the back wall. */
const INSIDE_ENTRANCE = 2;
/** The ball rolls down the track to the cave's mouth (this far inside the track edge), then turns in. */
const MOUTH_INSET = 2;
/** Share of the roll spent on the track; the rest goes into the cave. */
const TRACK_SHARE = 0.8;
/** Boxes the ball never climbs: the path keeps clear of side borders and cave walls. */
const NOT_GROUND = new Set(['border', 'nicheWall', 'nicheRoof']);

export interface CaughtState {
  /** Seconds since the catch. */
  t: number;
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  /** Cave the ball rolls into, −1 for the camp. */
  niche: number;
  /** Turn point at the cave mouth on the track (same as `to` for the camp). */
  via: { x: number; z: number };
  formSec: number;
  rollSec: number;
  popSec: number;
}

/** Nearest cave below the hero (its z under his), or the camp spawn when there is none. */
export function caughtTarget(level: LevelData, z: number): { niche: number; x: number; y: number; z: number } {
  let best = -1;
  level.niches.forEach((n, i) => {
    if (n.z < z && (best < 0 || n.z > level.niches[best]!.z)) best = i;
  });
  const n = level.niches[best];
  if (!n) return { niche: -1, x: level.spawn[0], y: level.spawn[1], z: level.spawn[2] };
  return { niche: best, x: entranceX(level, n) + nicheSign(n) * INSIDE_ENTRANCE, y: n.y, z: n.z };
}

/** Form, roll and pop phases; the pop shrinks if the three would not fit in maxSec. */
export function createCaught(
  level: LevelData,
  from: { x: number; y: number; z: number },
  caught: BalanceJson['caught'],
  avalanche: Pick<TuningJson['avalanche'], 'caughtFormSec' | 'caughtPopSec'>,
): CaughtState {
  const target = caughtTarget(level, from.z);
  const formSec = Math.min(avalanche.caughtFormSec, caught.maxSec);
  const rollSec = Math.min(caught.rollSec, caught.maxSec - formSec);
  const popSec = Math.max(0, Math.min(avalanche.caughtPopSec, caught.maxSec - formSec - rollSec));
  const n = level.niches[target.niche];
  const via = n ? { x: entranceX(level, n) - nicheSign(n) * MOUTH_INSET, z: n.z } : { x: target.x, z: target.z };
  return { t: 0, from: { ...from }, to: { x: target.x, y: target.y, z: target.z }, via, niche: target.niche, formSec, rollSec, popSec };
}

export function caughtTotalSec(c: CaughtState): number {
  return c.formSec + c.rollSec + c.popSec;
}

/** Feet position of the ball at time `c.t`: still while forming, rolling down the slope with bounces, at the target. */
export function caughtPosition(c: CaughtState, level: LevelData, bounce: number, out: { x: number; y: number; z: number }): void {
  const k = c.rollSec > 0 ? Math.min(1, Math.max(0, (c.t - c.formSec) / c.rollSec)) : 1;
  if (k <= 0) {
    out.x = c.from.x;
    out.y = c.from.y;
    out.z = c.from.z;
    return;
  }
  // Ease in and out: down the track to the cave mouth, then in; the ball hops on bumps and over obstacles (4.5).
  const e = k * k * (3 - 2 * k);
  if (e < TRACK_SHARE) {
    const a = e / TRACK_SHARE;
    out.x = c.from.x + (c.via.x - c.from.x) * a;
    out.z = c.from.z + (c.via.z - c.from.z) * a;
  } else {
    const a = (e - TRACK_SHARE) / (1 - TRACK_SHARE);
    out.x = c.via.x + (c.to.x - c.via.x) * a;
    out.z = c.via.z + (c.to.z - c.via.z) * a;
  }
  const ground = k >= 1 ? c.to.y : Math.max(c.to.y, groundAt(level, out.x, out.z));
  out.y = ground + Math.abs(Math.sin(k * Math.PI * 3)) * bounce * (1 - k);
}

/** Top of the ground under (x, z): the floor or a solid obstacle (ledge, rock) standing on it. */
function groundAt(level: LevelData, x: number, z: number): number {
  let y = level.floorYAt(z);
  for (const b of level.boxes) {
    if (!b.solid || NOT_GROUND.has(b.kind) || b.max[1] <= y) continue;
    if (x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2]) y = b.max[1];
  }
  return y;
}
