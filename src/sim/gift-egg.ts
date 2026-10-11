// What: The free "Mountain Gift" egg of the first minute: finds its spot beside the cave treadmill (or in a grotto), wobbles and cracks on touch, then the pet hatches.
// Called by: sim/world.ts, render/ftue.ts; tests/sim/ftue.test.ts
// Keep: Once in a player life (caller passes it only while save.flags.giftEgg is unset); not shown until the scripted wave is over; hatch time ftue.eggHatchSec; pure TS.

/**
 * The free egg «Mountain Gift» of the first minute (docs/01-gdd.md 6.2): it stands beside the treadmill of cave
 * `ftue.scriptedWaveWall`, a touch makes it wobble and crack for `ftue.eggHatchSec`, then the pet jumps out.
 * Once in the life of the player (the caller passes it only while `save.flags.giftEgg` is not set). Before the scripted
 * wave is over it is not there (`shown` false: not drawn, a touch does nothing); the app shows it with «Phew, made it!»
 * (docs/01-gdd.md 16.6, playtest M3). Pure TS, no DOM.
 */
import type { LevelData } from '../level/types.ts';

/** Gap between the belt edge and the egg, units: the egg sits off the belt on the mouth side, in the downhill corner
 * (clear of the way from the mouth to the belt centre). */
const EGG_GAP = 1.3;
const EGG_CORNER = 1.5;
/** From the back wall of a grotto with no belt, units. */
const EGG_BACK = 1.5;
/** The hero touches the egg within this horizontal distance of its centre and this height. */
export const EGG_TOUCH_DIST = 1.4;
const EGG_TOUCH_HEIGHT = 2.5;

export type GiftEggPhase = 'idle' | 'hatching' | 'done';

export interface GiftEggState {
  x: number;
  y: number;
  z: number;
  phase: GiftEggPhase;
  /** Seconds since the touch. */
  t: number;
  hatchSec: number;
  pet: string;
  /** Index of the cave the egg stands in. */
  niche: number;
  /** On its stand and takeable (after the scripted wave). */
  shown: boolean;
}

/** Where the egg stands: in the first cave of stretch `wall` (the cave of the scripted wave); null — no such cave. */
export function giftEggSpot(level: LevelData, wall: number): { x: number; y: number; z: number; niche: number } | null {
  const niche = level.niches.findIndex((n) => n.stretch === wall && n.kind !== 'ledge');
  return niche < 0 ? null : eggSpotIn(level, niche);
}

/** The egg's spot in cave `niche`: next to its belt, or by the back wall in the downhill corner of a grotto with no belt
 * (the open slope, docs/01-gdd.md 17.8); null on a ledge. */
export function eggSpotIn(level: LevelData, niche: number): { x: number; y: number; z: number; niche: number } | null {
  const n = level.niches[niche];
  if (!n || n.kind === 'ledge') return null;
  const belt = level.points.find((p) => p.type === 'treadmill' && p['inNiche'] === true && p['niche'] === niche);
  if (!belt) {
    const x = n.side === 'right' ? n.box.max[0] - EGG_BACK : n.box.min[0] + EGG_BACK;
    return { x, y: n.y, z: n.box.min[2] + EGG_CORNER, niche };
  }
  const len = typeof belt['length'] === 'number' ? (belt['length'] as number) : 0;
  const width = typeof belt['width'] === 'number' ? (belt['width'] as number) : 0;
  const inward = n.side === 'right' ? 1 : -1;
  return { x: belt.x - inward * (width / 2 + EGG_GAP), y: belt.y, z: belt.z - len / 2 + EGG_CORNER, niche };
}

export function createGiftEgg(level: LevelData, wall: number, pet: string, hatchSec: number, shown = true): GiftEggState | null {
  const spot = giftEggSpot(level, wall);
  return spot ? { ...spot, phase: 'idle', t: 0, hatchSec, pet, shown } : null;
}

/** One tick: returns 'touch' on the touch and 'hatch' when the pet jumps out, otherwise null. */
export function stepGiftEgg(egg: GiftEggState, x: number, y: number, z: number, dt: number): 'touch' | 'hatch' | null {
  if (!egg.shown) return null;
  if (egg.phase === 'idle') {
    if (Math.hypot(x - egg.x, z - egg.z) <= EGG_TOUCH_DIST && Math.abs(y - egg.y) <= EGG_TOUCH_HEIGHT) {
      egg.phase = 'hatching';
      egg.t = 0;
      return 'touch';
    }
    return null;
  }
  if (egg.phase === 'hatching') {
    egg.t += dt;
    if (egg.t >= egg.hatchSec - 1e-9) {
      egg.phase = 'done';
      return 'hatch';
    }
  }
  return null;
}
