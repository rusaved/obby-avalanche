// What: Picks what the stat drives by game.json stat.effect: the run-speed curve and, for jumpPower, the jump curve.
// Called by: main.ts (speedCurve, createSim options); level/validate.ts (reach of a ledge); tests/sim/jump-power.test.ts.
// Keep: The only place that knows the list of effects besides the validator's STAT_EFFECTS; a new effect is a module here.

/**
 * The stat effect of a pack (docs/02-tech.md 5.3; docs/01a-content.md 14): `moveSpeed` — the run follows the stat by
 * speedCurve, the jump is the tuning's; `jumpPower` — the run stays at the base speed (a flat curve), the takeoff speed
 * follows the stat by jumpCurve; `gateOnly` — the stat only opens walls.
 */
import type { Curve, StatEffect } from '../../content/types.ts';
import { jumpPower } from './jumpPower.ts';

export interface StatCurves {
  speed: Curve;
  /** The takeoff speed by the stat; null — the jump of tuning.controller.jumpSpeed. */
  jump: Curve | null;
}

export function statCurves(effect: StatEffect, speed: Curve, jump: Curve | undefined): StatCurves {
  if (effect === 'moveSpeed') return { speed, jump: null };
  const flat = { base: speed.base, k: 0, max: speed.base };
  return { speed: flat, jump: effect === 'jumpPower' && jump ? jump : null };
}

/** Takeoff speed at `stat`: by the jump curve of the effect, else the tuning's constant. */
export function takeoffSpeed(curves: StatCurves, stat: number, tuningJump: number): number {
  return curves.jump ? jumpPower(stat, curves.jump) : tuningJump;
}
