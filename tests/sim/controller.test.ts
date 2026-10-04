import { describe, expect, it } from 'vitest';
import { boxTriangles, createCollisionWorld } from '../../src/sim/collision.ts';
import { createHero, stepHero, type ControllerParams, type HeroInput, NO_INPUT } from '../../src/sim/controller.ts';
import { createRng } from '../../src/core/rng.ts';
import tuning from '../../content/avalanche/tuning.json' with { type: 'json' };
import { controllerParams } from '../../src/sim/world.ts';
import type { TuningJson } from '../../src/content/types.ts';

const DT = 1 / 60;
const params: ControllerParams = controllerParams(tuning as TuningJson, 16);

/** Flat floor 200×200 with its top at y = 0, plus optional extra boxes. */
function world(extra: Array<{ min: [number, number, number]; max: [number, number, number] }> = []) {
  const tris: number[] = [];
  boxTriangles({ min: [-100, -2, -100], max: [100, 0, 100] }, tris);
  for (const b of extra) boxTriangles(b, tris);
  return createCollisionWorld(tris);
}

function settle(hero: ReturnType<typeof createHero>, w: ReturnType<typeof world>, ticks = 30): void {
  for (let i = 0; i < ticks; i++) stepHero(hero, NO_INPUT, DT, w, params, -50);
}

const jumpInput: HeroInput = { moveX: 0, moveZ: 0, jump: true, jumpHeld: true };

describe('hero controller (docs/02-tech.md 6.1)', () => {
  it('jump height 6.4 ±2% and flight time 0.51 s ±2% (v0 = 50, g = 196.2)', () => {
    const w = world();
    const hero = createHero([0, 0.5, 0]);
    settle(hero, w);
    expect(hero.onGround).toBe(true);
    expect(hero.pos.y).toBeCloseTo(0, 2);
    stepHero(hero, jumpInput, DT, w, params, -50);
    expect(hero.jumpedThisTick).toBe(true);
    let apex = 0;
    let ticks = 1;
    while (!hero.onGround && ticks < 200) {
      apex = Math.max(apex, hero.pos.y);
      stepHero(hero, NO_INPUT, DT, w, params, -50);
      ticks++;
    }
    expect(hero.onGround).toBe(true);
    expect(apex).toBeGreaterThan(6.4 * 0.98);
    expect(apex).toBeLessThan(6.4 * 1.02);
    const flight = ticks * DT;
    expect(flight).toBeGreaterThan(0.51 * 0.98);
    expect(flight).toBeLessThan(0.51 * 1.02);
  });

  it('coyote time: a jump within 0.10 s after leaving the ledge works, after it does not', () => {
    for (const [delayTicks, shouldJump] of [
      [3, true],
      [5, true],
      [8, false],
    ] as const) {
      const w = createCollisionWorld(boxTriangles({ min: [-20, -2, -20], max: [10, 0, 20] }));
      const hero = createHero([9.2, 0.5, 0]);
      settle(hero, w);
      const run: HeroInput = { moveX: 1, moveZ: 0, jump: false, jumpHeld: false };
      let left = 0;
      while (hero.onGround && left < 100) {
        stepHero(hero, run, DT, w, params, -50);
        left++;
      }
      expect(hero.onGround).toBe(false);
      for (let i = 0; i < delayTicks; i++) stepHero(hero, run, DT, w, params, -50);
      stepHero(hero, { ...run, jump: true, jumpHeld: true }, DT, w, params, -50);
      expect(hero.jumpedThisTick, `delay ${delayTicks} ticks`).toBe(shouldJump);
    }
  });

  it('jump buffer: a press up to 0.12 s before landing jumps on landing, earlier presses are dropped', () => {
    for (const [leadTicks, shouldJump] of [
      [2, true],
      [6, true],
      [10, false],
    ] as const) {
      const w = world();
      const hero = createHero([0, 6, 0]);
      hero.vel.y = -10;
      // find landing tick with no input
      const probe = createHero([0, 6, 0]);
      probe.vel.y = -10;
      let landTick = 0;
      while (!probe.onGround && landTick < 200) {
        stepHero(probe, NO_INPUT, DT, w, params, -50);
        landTick++;
      }
      let jumped = false;
      for (let t = 1; t <= landTick + 1; t++) {
        const press = t === landTick - leadTicks;
        stepHero(hero, { moveX: 0, moveZ: 0, jump: press, jumpHeld: press }, DT, w, params, -50);
        if (hero.jumpedThisTick) jumped = true;
      }
      expect(jumped, `lead ${leadTicks} ticks`).toBe(shouldJump);
    }
  });

  it('no tunnelling through a 1-unit wall at 64 units/s', () => {
    const w = world([{ min: [10, 0, -20], max: [11, 12, 20] }]);
    const fast = { ...params, speed: 64 };
    const hero = createHero([0, 0.5, 0]);
    settle(hero, w);
    const run: HeroInput = { moveX: 1, moveZ: 0, jump: false, jumpHeld: false };
    for (let i = 0; i < 120; i++) {
      stepHero(hero, run, DT, w, fast, -50);
      expect(hero.pos.x).toBeLessThan(10.01);
    }
    expect(hero.pos.x).toBeGreaterThan(8.5);
    expect(hero.vel.x).toBeCloseTo(0, 3);
  });

  it('steps up ledges up to stepUp and is stopped by higher ones', () => {
    const low = world([{ min: [5, 0, -20], max: [30, 0.9, 20] }]);
    const high = world([{ min: [5, 0, -20], max: [30, 2.0, 20] }]);
    const run: HeroInput = { moveX: 1, moveZ: 0, jump: false, jumpHeld: false };
    const a = createHero([0, 0.5, 0]);
    settle(a, low);
    for (let i = 0; i < 90; i++) stepHero(a, run, DT, low, params, -50);
    expect(a.pos.x).toBeGreaterThan(8);
    expect(a.pos.y).toBeCloseTo(0.9, 1);
    const b = createHero([0, 0.5, 0]);
    settle(b, high);
    for (let i = 0; i < 90; i++) stepHero(b, run, DT, high, params, -50);
    expect(b.pos.x).toBeLessThan(5.01);
  });

  it('replay: the same recorded input gives the same position in a fresh simulation', () => {
    const w = world([{ min: [10, 0, -20], max: [11, 12, 20] }, { min: [-30, 0, 5], max: [30, 0.8, 8] }]);
    const rng = createRng(7);
    const inputs: HeroInput[] = [];
    for (let i = 0; i < 600; i++) {
      inputs.push({
        moveX: Math.round(rng.range(-1, 1) * 10) / 10,
        moveZ: Math.round(rng.range(-1, 1) * 10) / 10,
        jump: rng.chance(0.03),
        jumpHeld: false,
      });
    }
    const run = () => {
      const hero = createHero([0, 0.5, 0]);
      for (const inp of inputs) stepHero(hero, inp, DT, w, params, -50);
      return [hero.pos.x, hero.pos.y, hero.pos.z, hero.vel.x, hero.vel.y, hero.vel.z];
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(Math.hypot(a[0]!, a[2]!)).toBeGreaterThan(0.5);
  });

  it('accelerates to the run speed in about 0.10 s and stops in about 0.06 s', () => {
    const w = world();
    const hero = createHero([0, 0.5, 0]);
    settle(hero, w);
    const run: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };
    for (let i = 0; i < 6; i++) stepHero(hero, run, DT, w, params, -50);
    expect(hero.speed).toBeCloseTo(16, 1);
    for (let i = 0; i < 4; i++) stepHero(hero, NO_INPUT, DT, w, params, -50);
    expect(hero.speed).toBeLessThan(0.01);
  });
});
