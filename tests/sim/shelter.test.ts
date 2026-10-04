import { describe, expect, it } from 'vitest';
import { NO_INPUT } from '../../src/sim/controller.ts';
import { createSim, type Sim } from '../../src/sim/world.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { belts, entranceX } from '../../src/sim/shelter.ts';
import tuning from '../../content/avalanche/tuning.json' with { type: 'json' };
import balance from '../../content/avalanche/balance.json' with { type: 'json' };
import worlds from '../../content/avalanche/worlds.json' with { type: 'json' };
import type { BalanceJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

const DT = 1 / 60;
const bal = balance as BalanceJson;
const level = buildLevel((worlds as unknown as WorldsJson).worlds[0]!);

function sim(): Sim {
  return createSim(level, tuning as TuningJson, { balance: bal, speedCurve: bal.speedCurve, stat: 0 });
}
function settle(s: Sim, x: number, z: number, y = level.floorYAt(z)): void {
  s.teleport(x, y + 0.05, z);
  for (let i = 0; i < 20; i++) s.step(NO_INPUT, DT);
  expect(s.hero.onGround).toBe(true);
}

// M2-05: ice caves with a treadmill ×N (docs/01-gdd.md 4.3; docs/02-tech.md 8.2).
describe('caves and treadmills (M2-05)', () => {
  const cave = level.niches[0]!; // cave 1 of mountain 1, left side, treadmill ×5
  const sign = cave.side === 'left' ? -1 : 1;
  const ex = entranceX(level, cave);

  it('the hero inside the cave AABB is in shelter (inShelter), also within graceDist past the entrance, not further', () => {
    const s = sim();
    const deep = (cave.box.min[0] + cave.box.max[0]) / 2;
    settle(s, deep, cave.z, cave.y);
    expect(s.inShelter()).toBe(true);
    expect(s.shelterIndex()).toBe(0);
    // On the slope, 2 units out of the entrance: still the shelter (niche.graceDist = 3).
    settle(s, ex - sign * 2, cave.z);
    expect(bal.niche.graceDist).toBe(3);
    expect(s.inShelter()).toBe(true);
    // 4 units out — outside; the middle of the track and another z — outside.
    settle(s, ex - sign * 4, cave.z);
    expect(s.inShelter()).toBe(false);
    settle(s, 0, cave.z);
    expect(s.inShelter()).toBe(false);
    settle(s, ex - sign * 1, cave.z + 20);
    expect(s.inShelter()).toBe(false);
  });

  it('every cave of mountain 1 has a belt with its treadmill multiplier from worlds.json', () => {
    const inCaves = belts(level).filter((p) => p['inNiche'] === true);
    expect(inCaves).toHaveLength(12);
    inCaves.forEach((b, i) => expect(b['mult']).toBe(level.niches[i]!.treadmill));
  });

  it('on the belt steps go without any input, each one × the treadmill multiplier; the hero stays in place', () => {
    const s = sim();
    const belt = belts(level).find((p) => p['niche'] === 0)!;
    settle(s, belt.x, belt.z, belt.y);
    expect(s.onBelt).toBe(true);
    expect(s.treadmillAt()).toBe(cave.treadmill);
    const gains: Array<{ amount: number; belt: boolean }> = [];
    s.events.on('gain', (g) => gains.push({ amount: g.amount, belt: g.belt }));
    const z0 = s.hero.pos.z;
    for (let i = 0; i < 120; i++) s.step(NO_INPUT, DT); // 2 s, no input at all
    // 2 s at run speed 16 → 32 units of belt → 8 steps.
    expect(gains.length).toBeGreaterThanOrEqual(7);
    expect(gains.every((g) => g.amount === bal.gainPerStep * cave.treadmill && g.belt)).toBe(true);
    expect(Math.abs(s.hero.pos.z - z0)).toBeLessThan(0.1);
    // Off the belt, standing still: no steps.
    settle(s, ex - sign * 2, cave.z);
    const n = gains.length;
    for (let i = 0; i < 60; i++) s.step(NO_INPUT, DT);
    expect(gains.length).toBe(n);
  });
});
