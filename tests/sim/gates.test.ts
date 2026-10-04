import { describe, expect, it } from 'vitest';
import { boxTriangles } from '../../src/sim/collision.ts';
import { NO_INPUT, type HeroInput } from '../../src/sim/controller.ts';
import { createSim } from '../../src/sim/world.ts';
import { gateIsOpen, gateRequirement } from '../../src/sim/gates.ts';
import tuning from '../../content/avalanche/tuning.json' with { type: 'json' };
import balance from '../../content/avalanche/balance.json' with { type: 'json' };
import type { BalanceJson, TuningJson } from '../../src/content/types.ts';
import type { LevelData } from '../../src/level/types.ts';

const bal = balance as BalanceJson;
const DT = 1 / 60;
const RUN: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };
const STRAFE: HeroInput = { moveX: 1, moveZ: 0, jump: false, jumpHeld: false };

describe('gate requirement and openness (docs/01-gdd.md 3.3, 8.1; M2-02)', () => {
  it('closed one below the requirement, open when equal', () => {
    const req = gateRequirement(20, 1, 1, 0, bal.rebirth);
    expect(req).toBe(20);
    expect(gateIsOpen(req - 1, req)).toBe(false);
    expect(gateIsOpen(req, req)).toBe(true);
  });

  it('tiers 0 and 3: requirement = wall(p) × wallScale[n] (no ease before wall 37)', () => {
    for (const [world, wall] of [
      [1, 1],
      [2, 7],
      [3, 12],
    ] as const) {
      const base = 1000;
      expect(gateRequirement(base, world, wall, 0, bal.rebirth)).toBe(base * bal.rebirth.wallScale[0]!);
      expect(gateRequirement(base, world, wall, 3, bal.rebirth)).toBe(base * bal.rebirth.wallScale[3]!);
    }
    // Late ease on tier ≥ 1: wall 60 is ×toFactor, wall 36 untouched, tier 0 never eased.
    expect(gateRequirement(1, 5, 12, 1, bal.rebirth)).toBeCloseTo(bal.rebirth.wallScale[1]! * bal.rebirth.lateEase.toFactor, 9);
    expect(gateRequirement(1, 3, 12, 1, bal.rebirth)).toBe(bal.rebirth.wallScale[1]!);
    expect(gateRequirement(1, 5, 12, 0, bal.rebirth)).toBe(1);
  });

  it('in the simulation a closed gate blocks the hero; once the stat reaches the number it melts and lets the hero through', () => {
    const tris: number[] = [];
    boxTriangles({ min: [-20, -2, -20], max: [20, 0, 200] }, tris);
    const gateZ = 12;
    const level: LevelData = {
      worldId: 'test',
      worldIndex: 1,
      length: 200,
      width: 40,
      spawn: [0, 0.5, 0],
      killY: -50,
      staticTriangles: new Float32Array(tris),
      boxes: [],
      ramps: [],
      gates: [{ index: 1, z: gateZ, y: 0, requires: 5, rewardCoins: 0, box: { min: [-20, 0, gateZ - 0.5], max: [20, 12, gateZ + 0.5] }, height: 12, signHeight: 7, rarity: 'common' }],
      niches: [],
      checkpoints: [],
      points: [],
      safeZones: [],
      floorYAt: () => 0,
    };
    const s = createSim(level, tuning as TuningJson, { balance: bal, speedCurve: bal.speedCurve });
    for (let i = 0; i < 30; i++) s.step(NO_INPUT, DT);
    for (let i = 0; i < 240; i++) s.step(RUN, DT);
    expect(s.gatesOpen[0]).toBe(false);
    expect(s.hero.pos.z).toBeLessThan(gateZ - 0.5);
    const opened: number[] = [];
    s.events.on('gateOpen', (e) => opened.push(e.wall));
    // Collect the number along the wall (any ground path counts, docs/01-gdd.md 3.3).
    let guard = 0;
    while (s.progress.stat < 5 && guard++ < 2000) s.step(STRAFE, DT);
    expect(s.progress.stat).toBeGreaterThanOrEqual(5);
    expect(s.gatesOpen[0]).toBe(true);
    expect(opened).toEqual([1]);
    for (let i = 0; i < 240; i++) s.step(RUN, DT);
    expect(s.hero.pos.z).toBeGreaterThan(gateZ + 1);
  });
});
