import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HeroInput } from '../../src/sim/controller.ts';
import { createSim } from '../../src/sim/world.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import type { BalanceJson, TuningJson, World, WorldsJson } from '../../src/content/types.ts';

// PS-05: the section multiplier of the open slope (docs/01-gdd.md 17.4; Q-033, A).
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const balance = mergePatch(read('balance.json') as BalanceJson, read('pace/open/balance.json'));
const tuning = mergePatch(read('tuning.json') as TuningJson, read('pace/open/tuning.json'));
const open = (read('pace/open/worlds.json') as WorldsJson).worlds;
const classic = (read('worlds.json') as WorldsJson).worlds;
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
const DT = 1 / 60;
const RUN: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };

/** Gains of the hero running up from z0 to z1 at x: [z, amount] of every step. */
function gainsOn(world: World, x: number, z0: number, z1: number): Array<[number, number]> {
  const level = buildLevel(world);
  const s = createSim(level, tuning, { balance, speedCurve: curve });
  const out: Array<[number, number]> = [];
  s.events.on('gain', ({ amount }) => out.push([s.hero.pos.z, amount]));
  s.teleport(x, level.floorAt(x, z0), z0);
  for (let i = 0; i < 2000 && s.hero.pos.z < z1; i++) s.step(RUN, DT);
  return out;
}

describe('section multiplier (PS-05)', () => {
  it('a step on a section of stepMult 1.5 gives ×1.5; in the camp ×1', () => {
    const w = JSON.parse(JSON.stringify(open[0])) as World;
    w.zones[0]!.stepMult = 1.5;
    const gains = gainsOn(w, 0, 10, 80);
    const camp = gains.filter(([z]) => z < 39);
    const section = gains.filter(([z]) => z > 41);
    expect(camp.length).toBeGreaterThan(3);
    expect(section.length).toBeGreaterThan(3);
    for (const [, a] of camp) expect(a).toBe(balance.gainPerStep);
    for (const [, a] of section) expect(a).toBeCloseTo(1.5 * balance.gainPerStep, 9);
  });

  it('section 2 of mountain 1 (×1.2): the run gives ×1.2; the belt of its ridge grotto gives ×1.2 too, not the product', () => {
    const w = open[0]!;
    const zone = w.zones[1]!;
    expect(zone.stepMult).toBe(1.2);
    const run = gainsOn(w, 16, zone.zStart + 12, zone.zStart + 60);
    expect(run.length).toBeGreaterThan(3);
    for (const [, a] of run) expect(a).toBeCloseTo(1.2, 9);
    // On the belt of the grotto under ridge 2.
    const level = buildLevel(w);
    // The grotto with the belt of section 2 (SP-04: on mountain 1 a rock by the run, nearRun).
    const grotto = level.niches.findIndex((n) => n.treadmill > 0 && n.zone === 2);
    const belt = level.points.find((p) => p.type === 'treadmill' && p['niche'] === grotto)!;
    expect(belt['mult']).toBe(1.2);
    const s = createSim(level, tuning, { balance, speedCurve: curve });
    const amounts: number[] = [];
    s.events.on('gain', ({ amount, belt: onBelt }) => onBelt && amounts.push(amount));
    s.teleport(belt.x, belt.y, belt.z);
    for (let i = 0; i < 240; i++) s.step({ moveX: 0, moveZ: 0, jump: false, jumpHeld: false }, DT);
    expect(amounts.length).toBeGreaterThan(3);
    for (const a of amounts) expect(a).toBeCloseTo(1.2, 9);
    const n = level.niches[grotto]!;
    expect(belt.x).toBeGreaterThan(n.box.min[0]);
    expect(belt.x).toBeLessThan(n.box.max[0]);
  });

  it('classic and fast have no section multipliers: ×1 on the whole slope', () => {
    const level = buildLevel(classic[0]!);
    expect(level.sections).toEqual([]);
    const gains = gainsOn(classic[0]!, -4, 45, 70);
    expect(gains.length).toBeGreaterThan(3);
    for (const [, a] of gains) expect(a).toBe(balance.gainPerStep);
  });
});
