import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSim } from '../../src/sim/world.ts';
import { NO_INPUT } from '../../src/sim/controller.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { levelThreshold } from '../../src/sim/levels.ts';
import { migrateStageTrophies } from '../../src/meta/trophies.ts';
import { buyNextShoes, shoesPrice } from '../../src/meta/shoes.ts';
import type { BalanceJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

// SD-03 (docs/01-gdd.md 23.3): the stage trophies — small numbers, their own wallet, once a run, then back to the camp.
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const tuning = mergePatch(read('tuning.json'), read('pace/stages/tuning.json')) as unknown as TuningJson;
const balance = mergePatch(read('balance.json'), read('pace/stages/balance.json')) as unknown as BalanceJson;
const worlds = read('pace/stages/worlds.json') as WorldsJson;
const DT = 1 / 60;

describe('stage trophies (SD-03)', () => {
  it('mountain 1 pays 1, 3, 10, 20 … trophies, growing stage by stage on every mountain', () => {
    expect(worlds.worlds[0]!.stages!.filter((s) => s.trophies > 0).map((s) => s.trophies)).toEqual([1, 3, 10, 20, 30, 40, 50, 60, 70]);
    for (const w of worlds.worlds) {
      const paid = w.stages!.filter((s) => s.trophies > 0).map((s) => s.trophies);
      for (let k = 1; k < paid.length; k++) expect(paid[k]!, w.id).toBeGreaterThan(paid[k - 1]!);
    }
  });

  it('a button pays trophies, not coins; the hero flies to the camp; the same button again only on the next run', () => {
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
    expect(got).toEqual([{ amount: st.trophies, trophies: true }]);
    expect(sim.coins).toBe(coins0);
    for (let i = 0; i < 120 && camp === 0; i++) sim.step(NO_INPUT, DT);
    expect(camp).toBe(1);
    expect(sim.hero.pos.z).toBeLessThan(w.stages![1]!.z0);
    // A new run: the button pays again.
    sim.teleport(st.pad.x, st.pad.y + 0.05, st.pad.z);
    for (let i = 0; i < 5; i++) sim.step(NO_INPUT, DT);
    expect(got).toHaveLength(2);
  });

  it('the shoes are priced in trophies over upgrade.trophyRate; bought from the trophy wallet', () => {
    const tiers = balance.upgrade.tiers;
    const rate = balance.upgrade.trophyRate!;
    expect(balance.upgrade.currency).toBe('trophies');
    expect(shoesPrice(tiers[1]!, 0, balance.rebirth, balance.upgrade)).toBe(Math.round(tiers[1]!.price / rate));
    const wallet = { coins: 3, level: 0 };
    expect(buyNextShoes(wallet, tiers, 0, balance.rebirth, balance.upgrade)).toBeNull();
    wallet.coins = 10;
    expect(buyNextShoes(wallet, tiers, 0, balance.rebirth, balance.upgrade)?.id).toBe(tiers[1]!.id);
    expect(wallet.coins).toBe(10 - shoesPrice(tiers[1]!, 0, balance.rebirth, balance.upgrade));
  });

  it('migration: coins stay, the stages passed bring their trophies once', () => {
    const save = { coins: 5000, trophies: 2, stageBest: { '1': 5 } } as { coins: number; trophies?: number; stageBest?: Record<string, number>; flags?: Record<string, boolean> };
    const add = migrateStageTrophies(save, worlds);
    expect(add).toBe(1 + 3 + 10);
    expect(save.trophies).toBe(2 + 14);
    expect(save.coins).toBe(5000);
    expect(migrateStageTrophies(save, worlds)).toBe(0);
    expect(save.trophies).toBe(16);
  });
});
