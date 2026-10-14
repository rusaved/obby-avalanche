// What: Trampoline arc: flies the hero tick by tick from the pad like the controller does, and gives the gift-height band over the pad; pure TS.
// Called by: level/generate.ts and level/open-shapes.ts, level/open-slope.ts (gift placement over the pad, flightBand), level/validate.ts (arc and gift checks)
// Keep: Must integrate exactly like sim/controller.ts (same midpoint step, gravity, fallMult, 1/60 tick) or generator, validator and game disagree on the arc; no DOM.

/**
 * The trampoline arc (docs/01-gdd.md 16.4): the hero leaves the pad at `fun.padSpeed` up and his run speed plus
 * `fun.padForward` along +Z, and flies by the controller's gravity tick by tick, as in the game. The generator places
 * the gift over the trampoline by it, the validator checks the arc and the gift by it (docs/02-tech.md 5.4). Pure TS.
 */
import type { TuningJson } from '../content/types.ts';
import { HERO_HEIGHT } from '../sim/controller.ts';

export const TICK = 1 / 60;
/** The trampoline plate (docs/01-gdd.md 16.4): 4 × 4 units, and the ice slide ribbon 4 × 16. */
export const PAD_SIZE = 4;
export const SLIDE_WIDTH = 4;
export const SLIDE_LENGTH = 16;
/**
 * «Not with a plain jump, yes from the trampoline, 20% to spare both ways»: the feet height the gift needs (its bottom
 * minus the hero's height) is at least this × the plain jump apex and at most the trampoline apex / this.
 */
export const PAD_GIFT_MARGIN = 1.2;

export type ArcTuning = Pick<TuningJson, 'controller' | 'fun'>;

export interface ArcPoint {
  t: number;
  /** Feet height and position along the track. */
  y: number;
  z: number;
}

export interface PadArc {
  points: ArcPoint[];
  /** Where the feet are back on the floor. */
  landZ: number;
  /** Highest feet height above the take-off floor. */
  apex: number;
}

/** Feet apex of a jump at vertical speed `v`: v² / (2g). */
export function apexOf(v: number, tuning: ArcTuning): number {
  return (v * v) / (2 * tuning.controller.gravity);
}

/**
 * Flight from the take-off point (feet at `y`, along +Z at `runSpeed` plus padForward) until the feet meet the floor
 * again, or `maxZ`. The same midpoint step as the controller (src/sim/controller.ts).
 */
export function padArc(z: number, y: number, runSpeed: number, tuning: ArcTuning, floorYAt: (z: number) => number, maxZ = Infinity): PadArc {
  const c = tuning.controller;
  const vz = runSpeed + tuning.fun.padForward;
  let vy = tuning.fun.padSpeed;
  let t = 0;
  let yy = y;
  let zz = z;
  let apex = 0;
  const points: ArcPoint[] = [{ t, y: yy, z: zz }];
  for (let i = 0; i < 600; i++) {
    const vy0 = vy;
    vy -= c.gravity * (vy < 0 ? c.fallMult : 1) * TICK;
    yy += ((vy0 + vy) / 2) * TICK;
    zz += vz * TICK;
    t += TICK;
    apex = Math.max(apex, yy - y);
    const floor = floorYAt(zz);
    if (vy < 0 && yy <= floor) {
      points.push({ t, y: floor, z: zz });
      return { points, landZ: zz, apex };
    }
    points.push({ t, y: yy, z: zz });
    if (zz >= maxZ) break;
  }
  return { points, landZ: zz, apex };
}

/**
 * Heights of the trampoline gift's bottom above the pad floor that keep 20% both ways: [lowest, highest]. Empty
 * (lowest > highest) when the trampoline does not throw high enough above a plain jump.
 */
export function padGiftBand(tuning: ArcTuning): [number, number] {
  return [HERO_HEIGHT + PAD_GIFT_MARGIN * apexOf(tuning.controller.jumpSpeed, tuning), HERO_HEIGHT + apexOf(tuning.fun.padSpeed, tuning) / PAD_GIFT_MARGIN];
}

/** Run speeds a flight band is sampled at, from the slowest to the fastest. */
const BAND_STEPS = 12;
/** Feet slack above and below the band (units). */
const BAND_SLACK = 0.5;

/**
 * Feet heights at `z` of every flight from vmin up to the top speed (Q-068: a faster hero flies higher over the gifts
 * of the slowest arc and missed them): [lowest, highest] with slack, the column in which a gift in the air is taken.
 * Flights that land before `z` do not count.
 */
export function flightBand(fly: (v: number) => PadArc, z: number, vmin: number, vmax: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k <= BAND_STEPS; k++) {
    const arc = fly(vmin + ((Math.max(vmin, vmax) - vmin) * k) / BAND_STEPS);
    const i = arc.points.findIndex((q) => q.z >= z);
    if (i <= 0) continue;
    const a = arc.points[i - 1]!;
    const b = arc.points[i]!;
    const yy = a.y + ((b.y - a.y) * (z - a.z)) / (b.z - a.z || 1);
    lo = Math.min(lo, yy);
    hi = Math.max(hi, yy);
  }
  return [Math.round((lo - BAND_SLACK) * 1000) / 1000, Math.round((hi + BAND_SLACK) * 1000) / 1000];
}
