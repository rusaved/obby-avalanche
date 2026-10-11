import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HeroInput } from '../../src/sim/controller.ts';
import { createSim } from '../../src/sim/world.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { OPEN_SLOPE } from '../../src/level/open-slope.ts';
import type { BalanceJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

// PS-04: the ridge of the open slope in the simulation (docs/01-gdd.md 17.3).
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const balance = mergePatch(read('balance.json') as BalanceJson, read('pace/open/balance.json'));
const tuning = mergePatch(read('tuning.json') as TuningJson, read('pace/open/tuning.json'));
const worlds = read('pace/open/worlds.json') as WorldsJson;
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
const DT = 1 / 60;
const RUN: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };
const JUMP: HeroInput = { moveX: 0, moveZ: 1, jump: true, jumpHeld: true };
const level = buildLevel(worlds.worlds[0]!);
const ridge = level.gates[0]!;
/** The frontier as main.ts keeps it in the save: the highest wall passed. */
const frontier = (s: ReturnType<typeof createSim>): number => s.level.gates.reduce((m, g, i) => (s.gatesPassed[i] ? Math.max(m, g.index) : m), 0);

describe('ridge (PS-04)', () => {
  it('at its number the ice of every passage melts at once; up the middle passage onto the next terrace, the ridge gift paid', () => {
    const s = createSim(level, tuning, { balance, speedCurve: curve, stat: ridge.requires });
    let paid = -1;
    s.events.on('gatePass', ({ coins }) => void (paid = coins));
    s.teleport(0, level.floorYAt(ridge.z - 30), ridge.z - 30);
    for (let i = 0; i < 180 && !s.gatesPassed[0]; i++) s.step(RUN, DT);
    expect(s.gatesOpen[0]).toBe(true);
    expect(s.gatesPassed[0]).toBe(true);
    expect(paid).toBe(balance.coins.gatePass * worlds.worlds[0]!.zones[0]!.gift);
    for (let i = 0; i < 30; i++) s.step(RUN, DT);
    expect(s.hero.pos.y).toBeCloseTo(ridge.y + OPEN_SLOPE.ridgeRise, 1);
    expect(frontier(s)).toBe(1);
  });

  it('below its number the ridge stops the hero in every passage and over the carniz, a jump included', () => {
    for (const x of [-18, 0, 18, -26, 9]) {
      const s = createSim(level, tuning, { balance, speedCurve: curve, stat: ridge.requires - 1 });
      s.teleport(x, level.floorAt(x, ridge.z - 20), ridge.z - 20);
      for (let i = 0; i < 240; i++) s.step(i % 20 === 0 ? JUMP : RUN, DT);
      expect(s.hero.pos.z, `x ${x}`).toBeLessThan(ridge.z);
      expect(s.gatesOpen[0]).toBe(false);
    }
  });

  it('the open ridge is kept by frontierWall: back after F5 the hero stands at its flag, the ridge open; the giant’s line stays closed', () => {
    const s = createSim(level, tuning, { balance, speedCurve: curve, stat: 1e12, resume: { frontierWall: 1 } });
    expect(s.gatesOpen[0]).toBe(true);
    expect(s.gatesPassed[0]).toBe(true);
    expect(s.hero.pos.z).toBeGreaterThan(ridge.z);
    expect(s.hero.pos.z).toBeLessThan(ridge.z + 16);
    const boss = level.gates.length - 1;
    expect(level.gates[boss]!.kind).toBe('boss');
    expect(s.gatesOpen[boss]).toBe(false);
    s.step(RUN, DT);
    expect(s.gatesOpen[boss]).toBe(false);
  });
});
