/**
 * Fun between the gates in the simulation (docs/01-gdd.md 16.4): a step onto a trampoline throws the hero up at
 * `fun.padSpeed` with `fun.padForward` more along +Z until he lands — no jump key, steering in the air stays; on an ice
 * slide the run is × `fun.slideMult` and stays so `fun.slideSec` after it. In the air no steps count (world.ts, as a
 * jump); on the slide they count by the path, as the run. Reads `tuning.fun` every tick: the ?debug=1 sliders apply
 * at once. Pure TS, no DOM.
 */
import type { TuningJson } from '../content/types.ts';
import type { LevelData, LevelPoint } from '../level/types.ts';
import type { ControllerParams, HeroInput, HeroState } from './controller.ts';

/** The hero moving faster than this steps onto a trampoline (standing on one after a respawn does nothing). */
const PAD_MOVE_SPEED = 1;
/** Feet this close above a plate or a slide stand on it. */
const ON_TOP = 1;

export interface FunState {
  readonly pads: LevelPoint[];
  readonly slides: LevelPoint[];
  /** In the air after a trampoline: padForward is added until the landing. */
  padFlight: boolean;
  /** Seconds of the slide boost left (slideSec after leaving it); index of the slide under the feet, −1 off it. */
  slideLeft: number;
  onSlide: number;
  /** Trampoline launches of this sim and the highest the feet rose over the plate in the last flight (test API). */
  launches: number;
  top: number;
  launchY: number;
}

export function createFun(level: LevelData): FunState {
  return {
    pads: level.points.filter((p) => p.type === 'jumpPad'),
    slides: level.points.filter((p) => p.type === 'slide'),
    padFlight: false,
    slideLeft: 0,
    onSlide: -1,
    launches: 0,
    top: 0,
    launchY: 0,
  };
}

function under(p: LevelPoint, x: number, y: number, z: number): boolean {
  const w = typeof p['width'] === 'number' ? (p['width'] as number) : 0;
  const l = typeof p['length'] === 'number' ? (p['length'] as number) : 0;
  return Math.abs(x - p.x) <= w / 2 && Math.abs(z - p.z) <= l / 2 && y >= p.y - ON_TOP && y <= p.y + ON_TOP;
}

/** The input of this tick with the fun applied: × slideMult while the boost lasts, + padForward in a trampoline flight. */
export function funInput(f: FunState, input: HeroInput, p: ControllerParams, fun: TuningJson['fun']): HeroInput {
  if (f.slideLeft <= 0 && !f.padFlight) return input;
  const mult = f.slideLeft > 0 ? fun.slideMult : 1;
  return {
    ...input,
    moveX: input.moveX * mult,
    moveZ: input.moveZ * mult + (f.padFlight ? fun.padForward / Math.max(1e-3, p.speed) : 0),
  };
}

/** After the hero moved this tick: −1 or the index of the trampoline that threw him and of the slide he got onto. */
export function stepFun(f: FunState, hero: HeroState, fun: TuningJson['fun'], dt: number): { pad: number; slide: number } {
  const out = { pad: -1, slide: -1 };
  const { x, y, z } = hero.pos;
  if (f.padFlight) f.top = Math.max(f.top, y - f.launchY);
  if (hero.onGround) {
    f.padFlight = false;
    const pad = hero.speed > PAD_MOVE_SPEED ? f.pads.findIndex((p) => under(p, x, y, z)) : -1;
    if (pad >= 0) {
      hero.vel.y = fun.padSpeed;
      hero.vel.z += fun.padForward;
      hero.onGround = false;
      hero.coyoteLeft = 0;
      hero.jumpBufferLeft = 0;
      f.padFlight = true;
      f.launches++;
      f.launchY = y;
      f.top = 0;
      out.pad = pad;
    }
  }
  const slide = hero.onGround ? f.slides.findIndex((p) => under(p, x, y, z)) : -1;
  if (slide >= 0) {
    if (f.onSlide !== slide) out.slide = slide;
    f.slideLeft = fun.slideSec;
  } else f.slideLeft = Math.max(0, f.slideLeft - dt);
  f.onSlide = slide;
  return out;
}

/** Teleport, respawn, a new load: no flight and no boost. */
export function resetFun(f: FunState): void {
  f.padFlight = false;
  f.slideLeft = 0;
  f.onSlide = -1;
}
