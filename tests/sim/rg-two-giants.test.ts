import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { createBoss } from '../../src/sim/boss.ts';
import { createSim } from '../../src/sim/world.ts';
import type { BalanceJson, GameJson, TuningJson, WorldsJson } from '../../src/content/types.ts';
import type { HeroInput } from '../../src/sim/controller.ts';

// RG-11: two giants of mountains 9–10 — data only (docs/01-gdd.md 18.5; docs/01a-content.md 17.4).
const root = resolve(__dirname, '../..');
const read = <T>(f: string): T => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8')) as T;
const balance = mergePatch(read<BalanceJson>('balance.json'), read('pace/open/balance.json'));
const tuning = mergePatch(read<TuningJson>('tuning.json'), read('pace/open/tuning.json'));
const game = read<GameJson>('game.json');
const worlds = read<WorldsJson>('pace/open/worlds.json');
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
const DT = 1 / 60;
const RUN: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };
const w9 = worlds.worlds[8]!;
const level9 = buildLevel(w9);
const zone9 = level9.bosses[0]!;
const cfg = game.threat.boss!;

describe('two giants of mountains 9–10 (RG-11)', () => {
  it('data: two giants with phase 0 and 0.5 at the same speed on mountains 9–10 only; the advice as with one', () => {
    expect(worlds.worlds.map((w) => w.bosses![0]!.giants.length)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 2, 2]);
    for (const w of worlds.worlds.slice(8)) {
      const [a, b] = w.bosses![0]!.giants;
      expect([a!.phase, b!.phase]).toEqual([0, 0.5]);
      expect(b!.speed).toBe(a!.speed);
    }
  });

  it('they start at the two ends of the zone: one going up from its start, the other coming down from its end', () => {
    const b = createBoss([zone9], cfg, () => 1, () => false, () => {});
    const [g0, g1] = b.zones[0]!.giants;
    expect([g0!.z, g0!.dir]).toEqual([zone9.zone[0], 1]);
    expect([g1!.z, g1!.dir]).toEqual([zone9.zone[1], -1]);
  });

  it('faster than V_b × 1.05 the hero passes both; slower — the first one met catches him', () => {
    const vb = zone9.giants[0]!.speed;
    const run = (speed: number): { ev: string[]; chased: Set<number>; by: number } => {
      const ev: string[] = [];
      const b = createBoss([zone9], cfg, () => 1, () => false, (name) => name.startsWith('boss') && ev.push(name));
      // The giants patrol a while before the hero steps in: the one from the start of the zone meets him first.
      const hero = { x: 0, y: 0, z: zone9.zone[0] - 60, speed, vx: 0, vz: speed };
      const chased = new Set<number>();
      let by = -1;
      for (let i = 0; i < 60 * 60 && !ev.includes('bossPassed') && !ev.includes('bossCaught'); i++) {
        const near = b.zones[0]!.giants.map((g) => Math.abs(g.z - hero.z));
        b.step(DT, hero, true, i);
        b.zones[0]!.giants.forEach((g, gi) => g.mode === 'chase' && chased.add(gi));
        if (ev.includes('bossCaught')) by = near.indexOf(Math.min(...near));
        hero.z += speed * DT;
      }
      return { ev, chased, by };
    };
    const fast = run(vb * 1.06);
    expect(fast.ev).toEqual(['bossEnter', 'bossPassed']);
    expect([...fast.chased].sort()).toEqual([0, 1]);
    const slow = run(vb * 0.95);
    expect(slow.ev).toEqual(['bossEnter', 'bossCaught']);
    expect(slow.by).toBe(0);
  });

  it('mountain 9 in the sim: the hero with the Speed of the advice runs straight through both (and the helpers)', () => {
    const s = createSim(level9, tuning, { balance, speedCurve: curve, stat: zone9.requires, boss: cfg });
    const ev: string[] = [];
    s.events.on('bossCaught', () => ev.push('caught'));
    s.events.on('bossPassed', () => ev.push('passed'));
    s.teleport(0, s.level.floorYAt(zone9.zone[0] - 10), zone9.zone[0] - 10);
    for (let i = 0; i < 60 * 30 && ev.length === 0; i++) s.step(RUN, DT);
    expect(ev).toEqual(['passed']);
  });
});
