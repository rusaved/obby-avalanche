import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BORDER_WIDTH, buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { validateOpenFun, validateOpenShapes } from '../../src/level/validate-open.ts';
import { createSim } from '../../src/sim/world.ts';
import { moveSpeed } from '../../src/sim/effects/moveSpeed.ts';
import type { BalanceJson, BotsJson, OpenSpecJson, TuningJson, WorldsJson } from '../../src/content/types.ts';
import type { HeroInput } from '../../src/sim/controller.ts';

// RG-03: the throat and the field — mountain 3 (docs/01-gdd.md 18.3; docs/01a-content.md 17.2).
const root = resolve(__dirname, '../..');
const read = <T>(f: string): T => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8')) as T;
const balance = mergePatch(read<BalanceJson>('balance.json'), read('pace/open/balance.json'));
const tuning = mergePatch(read<TuningJson>('tuning.json'), read('pace/open/tuning.json'));
const spec = read<OpenSpecJson>('pace/open/worlds-spec.json');
const worlds = read<WorldsJson>('pace/open/worlds.json');
const bots = read<BotsJson>('bots.json');
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
const speedAt = (st: number): number => moveSpeed(st, curve);
const DT = 1 / 60;
const RUN: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };
const w3 = worlds.worlds[2]!;
const level = buildLevel(w3);
const throat = level.shapes!.find((c) => c.kind === 'throat' && c.section === 2)!;
const stat = spec.mountains[2]!.ridges[0]!.requires;
const half = w3.width / 2;

describe('throat and field (RG-03)', () => {
  it('mountain 3: a throat 20 wide and 60 long at the start of section 2; its walls are cliffs within the track and its borders', () => {
    expect(throat.x1 - throat.x0).toBe(20);
    expect(throat.z1 - throat.z0).toBe(60);
    const walls = level.boxes.filter((b) => b.kind === 'throatWall' && b.min[2] >= throat.z0 - 1e-6 && b.max[2] <= throat.z1 + 1e-6);
    expect(walls.length).toBeGreaterThanOrEqual(2);
    for (const b of walls) {
      expect(b.material).toBe('rock');
      expect(b.min[0]).toBeGreaterThanOrEqual(-half - BORDER_WIDTH - 1e-6);
      expect(b.max[0]).toBeLessThanOrEqual(half + BORDER_WIDTH + 1e-6);
      expect(b.max[1] - throat.y).toBeGreaterThanOrEqual(10);
    }
    // In its middle the floor between the walls is 20 wide.
    const mid = (throat.z0 + throat.z1) / 2;
    const inner = walls.filter((b) => mid >= b.min[2] && mid <= b.max[2]).map((b) => (b.min[0] < 0 ? b.max[0] : b.min[0]));
    expect(inner.sort((a, b) => a - b)).toEqual([-10, 10]);
  });

  it('inside the throat the run is × its slideMult (1.6): its ice the whole width', () => {
    const s = createSim(level, tuning, { balance, speedCurve: curve, stat });
    const v = speedAt(stat);
    s.teleport(6, throat.y, throat.z0 + 10);
    let fast = 0;
    for (let i = 0; i < 60; i++) {
      s.step(RUN, DT);
      if (s.hero.pos.z > throat.z0 + 20 && s.hero.pos.z < throat.z1 - 5) fast = Math.max(fast, s.hero.vel.z);
    }
    expect(fast).toBeCloseTo(1.6 * v, 0);
    expect(s.fun.slideMult).toBe(1.6);
  });

  it('a hero pressing sideways keeps inside the throat: the walls stop him at its floor', () => {
    const s = createSim(level, tuning, { balance, speedCurve: curve, stat });
    s.teleport(0, throat.y, throat.z0 + 25);
    for (let i = 0; i < 60; i++) s.step({ moveX: 1, moveZ: 0.2, jump: false, jumpHeld: false }, DT);
    expect(Math.abs(s.hero.pos.x)).toBeLessThanOrEqual(10);
  });

  it('a bot whose lane is out by the edge squeezes in between the walls and runs on through', () => {
    const s = createSim(level, tuning, { balance, speedCurve: curve, stat, bots: { cfg: bots, count: 1, seed: 5 } });
    const b = s.bots!.list[0]!;
    b.mode = 'up';
    b.lane = 22;
    b.x = 22;
    b.z = throat.z0 - 15;
    b.path = [[22, throat.z1 + 30]];
    let worst = 0;
    for (let i = 0; i < 360; i++) {
      s.step({ moveX: 0, moveZ: 0, jump: false, jumpHeld: false }, DT);
      if (b.z > throat.z0 + 8 && b.z < throat.z1 - 8) worst = Math.max(worst, Math.abs(b.x));
    }
    expect(worst).toBeLessThanOrEqual(8 + 1e-6);
    expect(b.z).toBeGreaterThan(throat.z1);
  });

  it('validator: the field grotto right past every throat; the way from its entry ≤ warnSec × 0.8; a missing one is an error', () => {
    expect(validateOpenShapes(worlds, spec)).toEqual([]);
    expect(validateOpenFun(worlds, tuning, speedAt)).toEqual([]);
    const bad = JSON.parse(JSON.stringify(worlds)) as WorldsJson;
    const segs = bad.worlds[2]!.segments;
    const exit = throat.z1;
    for (let i = segs.length - 1; i >= 0; i--) if (segs[i]!.type === 'niche' && segs[i]!.z > exit && segs[i]!.z < exit + 20) segs.splice(i, 1);
    expect(validateOpenShapes(bad, spec).some((e) => e.includes('(pass)') && e.includes('no field grotto'))).toBe(true);
  });
});
