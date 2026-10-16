import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSim } from '../../src/sim/world.ts';
import { NO_INPUT } from '../../src/sim/controller.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { levelThreshold } from '../../src/sim/levels.ts';
import { migrateStageTrophies, migrateStageTrophiesBack, STAGE_TROPHY_COINS } from '../../src/meta/trophies.ts';
import { buyNextShoes, shoesPrice } from '../../src/meta/shoes.ts';
import type { BalanceJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

// SD-03 (docs/01-gdd.md 23.3): the stage trophies — small numbers, their own wallet, once a run, then back to the camp.
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const tuning = mergePatch(read('tuning.json'), read('pace/stages/tuning.json')) as unknown as TuningJson;
const balance = mergePatch(read('balance.json'), read('pace/stages/balance.json')) as unknown as BalanceJson;
const worlds = read('pace/stages/worlds.json') as WorldsJson;
const DT = 1 / 60;

describe('the stage button (SD-03, SD-11 — Q-088: it pays coins)', () => {
  it('the reward of a button grows stage by stage on every mountain', () => {
    for (const w of worlds.worlds) {
      const paid = w.stages!.filter((s) => s.trophies > 0).map((s) => s.trophies);
      for (let k = 1; k < paid.length; k++) expect(paid[k]!, w.id).toBeGreaterThan(paid[k - 1]!);
    }
  });

  it('a button pays coins; the hero flies to the camp; the same button again only on the next run', () => {
    const w = worlds.worlds[0]!;
    const level = buildLevel(w);
    const st = w.stages!.find((s) => s.n === 3)!;
    const sim = createSim(level, tuning, { balance, speedCurve: balance.speedCurve, stat: levelThreshold(st.level, balance.levels!) });
    const got: Array<{ amount: number; trophies: boolean }> = [];
    let camp = 0;
    sim.events.on('trophyTake', (p) => void got.push({ amount: p.amount, trophies: p.trophies }));
    sim.events.on('campReturn', () => void camp++);
    const coins0 = sim.coins;
    sim.teleport(st.pad.x, st.pad.y + 0.05, st.pad.z);
    for (let i = 0; i < 5; i++) sim.step(NO_INPUT, DT);
    expect(got).toEqual([{ amount: st.trophies, trophies: false }]);
    expect(sim.coins - coins0).toBe(st.trophies);
    for (let i = 0; i < 120 && camp === 0; i++) sim.step(NO_INPUT, DT);
    expect(camp).toBe(1);
    expect(sim.hero.pos.z).toBeLessThan(w.stages![1]!.z0);
    // A new run: the button pays again.
    sim.teleport(st.pad.x, st.pad.y + 0.05, st.pad.z);
    for (let i = 0; i < 5; i++) sim.step(NO_INPUT, DT);
    expect(got).toHaveLength(2);
  });

  it('the shoes are priced and bought in coins (no trophy wallet on the stages pace)', () => {
    const tiers = balance.upgrade.tiers;
    expect(balance.upgrade.currency).toBeUndefined();
    expect(shoesPrice(tiers[1]!, 0, balance.rebirth, balance.upgrade)).toBe(tiers[1]!.price);
    const wallet = { coins: tiers[1]!.price, level: 0 };
    expect(buyNextShoes(wallet, tiers, 0, balance.rebirth, balance.upgrade)?.id).toBe(tiers[1]!.id);
    expect(wallet.coins).toBe(0);
  });

  it('migration back (SD-11): the stage trophies of an SD-03 save become coins, summit trophies stay; once', () => {
    const save: { coins?: number; trophies?: number; trophiesTotal?: number; flags?: Record<string, boolean> } = { coins: 100, trophies: 50, trophiesTotal: 6, flags: { stageTrophies: true } };
    expect(migrateStageTrophiesBack(save)).toBe(44 * STAGE_TROPHY_COINS);
    expect(save.trophies).toBe(6);
    expect(save.coins).toBe(100 + 44 * STAGE_TROPHY_COINS);
    expect(migrateStageTrophiesBack(save)).toBe(0);
    // A save that never ran the SD-03 build: left as it is (the starter pack trophies are spendable only).
    const old: typeof save = { coins: 5, trophies: 10, trophiesTotal: 0 };
    expect(migrateStageTrophiesBack(old)).toBe(0);
    expect(old.trophies).toBe(10);
  });

  it('the SD-03 migration (kept for a trophy wallet): the stages passed bring their trophies once', () => {
    const save = { coins: 5000, trophies: 2, stageBest: { '1': 3 } } as { coins: number; trophies?: number; stageBest?: Record<string, number>; flags?: Record<string, boolean> };
    const st = worlds.worlds[0]!.stages!;
    const add = migrateStageTrophies(save, worlds);
    expect(add).toBe(st[0]!.trophies + st[1]!.trophies);
    expect(migrateStageTrophies(save, worlds)).toBe(0);
  });
});
