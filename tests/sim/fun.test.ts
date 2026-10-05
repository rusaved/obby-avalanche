import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NO_INPUT, type HeroInput } from '../../src/sim/controller.ts';
import { createSim, type Sim } from '../../src/sim/world.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import type { BalanceJson, TuningJson, World, WorldsJson } from '../../src/content/types.ts';

const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const worlds = read('pace/fast/worlds.json') as WorldsJson;
const tuning = read('tuning.json') as TuningJson;
const balance = mergePatch(read('balance.json') as BalanceJson, read('pace/fast/balance.json'));
const DT = 1 / 60;
const RUN: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };

/** Mountain 1 of the fast pace with the stat that opened the gate below stretch `stretch`. */
function sim(stretch: number): Sim {
  const level = buildLevel(worlds.worlds[0]!);
  const stat = level.gates[stretch - 2]?.requires ?? 0;
  const s = createSim(level, tuning, { balance, speedCurve: { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed }, stat });
  for (let k = 0; k < 2; k++) s.step(NO_INPUT, DT);
  return s;
}

const point = (s: Sim, type: string, n = 0) => s.level.points.filter((p) => p.type === type)[n]!;

// PR-04: fun between the gates (docs/01-gdd.md 16.4; tuning.json fun.*).
describe('trampolines and ice slides (PR-04)', () => {
  it('a step onto the trampoline throws up at fun.padSpeed without the jump key; its gift is taken in flight; no steps in the air', () => {
    const s = sim(2);
    const pad = point(s, 'jumpPad');
    const giftIndex = s.gifts.findIndex((g, i) => s.level.points.filter((p) => p.type === 'gift')[i]!['pad'] === true && g.z > pad.z);
    const gift = s.gifts[giftIndex]!;
    const floor = s.level.floorYAt(pad.z);
    s.teleport(0, floor + 0.05, pad.z - 8);
    for (let k = 0; k < 10; k++) s.step(NO_INPUT, DT);
    const launches: number[] = [];
    let takenInAir = false;
    let vyAtLaunch = 0;
    s.events.on('padLaunch', () => {
      launches.push(s.tick);
      vyAtLaunch = s.hero.vel.y;
    });
    s.events.on('giftTake', ({ index, path }) => {
      if (index === giftIndex) {
        takenInAir = !s.hero.onGround;
        expect(path).toBe(true);
      }
    });
    let stepsAtLaunch = -1;
    let airSteps = 0;
    let top = 0;
    for (let k = 0; k < 120; k++) {
      s.step(RUN, DT);
      if (launches.length && stepsAtLaunch < 0) stepsAtLaunch = s.progress.steps;
      if (stepsAtLaunch >= 0 && !s.hero.onGround) airSteps = s.progress.steps - stepsAtLaunch;
      top = Math.max(top, s.hero.pos.y - floor);
      if (launches.length && s.hero.onGround) break;
    }
    expect(launches).toHaveLength(1);
    expect(vyAtLaunch).toBe(tuning.fun.padSpeed);
    expect(top).toBeGreaterThan(10);
    expect(gift.taken).toBe(true);
    expect(takenInAir).toBe(true);
    expect(airSteps).toBe(0);
    expect(s.hero.pos.z).toBeLessThan(s.level.gates[1]!.z);
  });

  it('standing on the trampoline (a respawn, a stop) does not throw; the flag of its stretch is beside it', () => {
    const s = sim(2);
    const pad = point(s, 'jumpPad');
    s.teleport(0, s.level.floorYAt(pad.z) + 0.05, pad.z);
    for (let k = 0; k < 60; k++) s.step(NO_INPUT, DT);
    expect(s.fun.launches).toBe(0);
    expect(s.hero.onGround).toBe(true);
    const flag = s.level.checkpoints.find((c) => c.z > s.level.gates[0]!.z && c.z < pad.z + 2)!;
    expect(Math.abs(flag.x - pad.x)).toBeGreaterThan((pad['width'] as number) / 2);
  });

  it('on the ice slide the run is × fun.slideMult, it stays so fun.slideSec after it, then back; steps go by the path', () => {
    // A long flat track with one slide (nothing else in the way of the run after it).
    const world = { ...worlds.worlds[0]!, length: 400, wallCount: 0, safeZones: [[0, 1]], segments: [{ type: 'floor', z: 0, length: 400, y: 0 }, { type: 'slide', z: 30, x: 0, y: 0, width: 4, length: 16 }] } as World;
    const s = createSim(buildLevel(world), tuning, { balance, speedCurve: balance.speedCurve, stat: 100 });
    s.teleport(0, 0.05, 10);
    for (let k = 0; k < 10; k++) s.step(NO_INPUT, DT);
    let onSpeed = 0;
    let offAt = -1;
    let afterSpeed = 0;
    let backSpeed = 0;
    const entered: number[] = [];
    s.events.on('slideEnter', ({ index }) => entered.push(index));
    let stepsOn = 0;
    for (let k = 0; k < 240; k++) {
      const before = s.progress.steps;
      s.step(RUN, DT);
      if (s.fun.onSlide >= 0) stepsOn += s.progress.steps - before;
      if (s.fun.onSlide >= 0 && s.hero.pos.z > 34) onSpeed = s.hero.speed / s.params.speed;
      if (offAt < 0 && s.hero.pos.z > 38.5) offAt = k;
      if (offAt >= 0 && k === offAt + Math.round(tuning.fun.slideSec / 2 / DT)) afterSpeed = s.hero.speed / s.params.speed;
      if (offAt >= 0 && k === offAt + Math.round((tuning.fun.slideSec + 0.5) / DT)) backSpeed = s.hero.speed / s.params.speed;
    }
    expect(entered).toEqual([0]);
    // Run speed of the stat now (it grows with the steps) × the slide.
    expect(onSpeed).toBeCloseTo(tuning.fun.slideMult, 2);
    expect(afterSpeed).toBeCloseTo(tuning.fun.slideMult, 2);
    expect(backSpeed).toBeCloseTo(1, 2);
    expect(s.fun.slideLeft).toBe(0);
    // 16 units at the slide speed, one step per stepLength of the path.
    expect(stepsOn).toBeGreaterThanOrEqual(Math.floor(16 / balance.stepLength) - 1);
  });
});
