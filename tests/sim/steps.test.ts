import { describe, expect, it } from 'vitest';
import { boxTriangles } from '../../src/sim/collision.ts';
import { NO_INPUT, type HeroInput } from '../../src/sim/controller.ts';
import { createSim, type Sim } from '../../src/sim/world.ts';
import { moveSpeed } from '../../src/sim/effects/moveSpeed.ts';
import tuning from '../../content/avalanche/tuning.json' with { type: 'json' };
import balance from '../../content/avalanche/balance.json' with { type: 'json' };
import type { BalanceJson, TuningJson } from '../../src/content/types.ts';
import type { LevelData } from '../../src/level/types.ts';

const DT = 1 / 60;
const RUN: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };
const JUMP: HeroInput = { moveX: 0, moveZ: 0, jump: true, jumpHeld: true };
const bal = balance as BalanceJson;

/** Flat floor (top y = 0) from z = −20 to 200 with one treadmill niche ×3 spanning z 50…70 (M2-01 acceptance). */
function level(): LevelData {
  const tris: number[] = [];
  boxTriangles({ min: [-20, -2, -20], max: [20, 0, 200] }, tris);
  return {
    worldId: 'test',
    worldIndex: 1,
    length: 200,
    width: 40,
    spawn: [0, 0.5, 0],
    killY: -50,
    staticTriangles: new Float32Array(tris),
    boxes: [],
    ramps: [],
    gates: [],
    niches: [{ stretch: 0, z: 60, y: 0, side: 'left', box: { min: [-10, 0, 50], max: [10, 8, 70] }, treadmill: 3 }],
    checkpoints: [],
    points: [{ type: 'treadmill', x: 0, y: 0, z: 60, mult: 3, width: 20, length: 20, inNiche: true }],
    safeZones: [],
    floorYAt: () => 0,
  };
}

function sim(): Sim {
  const s = createSim(level(), tuning as TuningJson, { balance: bal, speedCurve: bal.speedCurve, stat: 0 });
  for (let i = 0; i < 30; i++) s.step(NO_INPUT, DT); // settle on the floor
  expect(s.hero.onGround).toBe(true);
  return s;
}

function runUntilZ(s: Sim, z: number): void {
  let guard = 0;
  while (s.hero.pos.z < z && guard++ < 5000) s.step(RUN, DT);
  expect(s.hero.pos.z).toBeGreaterThanOrEqual(z);
}

describe('steps and the stat (docs/01-gdd.md 3.3, M2-01)', () => {
  it('40 units of running on the ground give exactly 40 / stepLength steps, +gainPerStep each, numbers from balance.json', () => {
    const s = sim();
    const gains: number[] = [];
    s.events.on('gain', (g) => gains.push(g.amount));
    expect(s.progress.steps).toBe(0);
    runUntilZ(s, 40);
    const expected = Math.floor(40 / bal.stepLength);
    expect(expected).toBe(10);
    expect(s.progress.steps).toBe(expected);
    expect(gains).toEqual(Array.from({ length: expected }, () => bal.gainPerStep));
    expect(s.progress.stat).toBe(expected * bal.gainPerStep);
    // The stat drives the run speed through the moveSpeed effect (docs/02-tech.md 6.1).
    expect(s.params.speed).toBeCloseTo(moveSpeed(s.progress.stat, bal.speedCurve), 6);
    expect(s.params.speed).toBeGreaterThan(bal.speedCurve.base);
  });

  it('a jump adds no steps: nothing in the air, the count resumes on the ground', () => {
    const s = sim();
    s.step(JUMP, DT);
    expect(s.hero.jumpedThisTick).toBe(true);
    let guard = 0;
    while (!s.hero.onGround && guard++ < 400) s.step(NO_INPUT, DT);
    expect(s.hero.onGround).toBe(true);
    expect(s.progress.steps).toBe(0);
    // Running and jumping: the path flown is not counted, only the ground path is.
    runUntilZ(s, 20);
    const before = s.progress.steps;
    s.step({ ...RUN, jump: true, jumpHeld: true }, DT);
    guard = 0;
    while (!s.hero.onGround && guard++ < 400) s.step(RUN, DT);
    const flown = s.hero.pos.z - 20;
    expect(flown).toBeGreaterThan(bal.stepLength * 2);
    expect(s.progress.steps - before).toBeLessThan(flown / bal.stepLength - 1);
  });

  it('on a treadmill ×3 every step gives three times more (the belt runs, the hero stays)', () => {
    const s = sim();
    s.teleport(0, 0.3, 52);
    for (let i = 0; i < 30; i++) s.step(NO_INPUT, DT);
    expect(s.treadmillAt()).toBe(3);
    const gains: number[] = [];
    s.events.on('gain', (g) => gains.push(g.amount));
    const steps0 = s.progress.steps;
    const carry0 = s.progress.carry;
    const ticks = Math.ceil(((bal.stepLength * 2 - carry0) / s.params.speed) * 60);
    for (let i = 0; i < ticks; i++) s.step(NO_INPUT, DT);
    expect(s.progress.steps - steps0).toBe(2);
    expect(gains).toEqual([bal.gainPerStep * 3, bal.gainPerStep * 3]);
    expect(s.hero.pos.z).toBeCloseTo(52, 1);
  });
});
