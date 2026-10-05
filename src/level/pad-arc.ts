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
