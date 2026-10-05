import { describe, expect, it } from 'vitest';
import { lcg, runCycle, type ModelPack } from '../../scripts/balance-model.ts';
import game from '../../content/avalanche/game.json' with { type: 'json' };
import balance from '../../content/avalanche/balance.json' with { type: 'json' };
import tuning from '../../content/avalanche/tuning.json' with { type: 'json' };
import pets from '../../content/avalanche/pets.json' with { type: 'json' };
import eggs from '../../content/avalanche/eggs.json' with { type: 'json' };
import worldsJson from '../../content/avalanche/worlds.json' with { type: 'json' };
import type { BalanceJson, EggsJson, GameJson, PetsJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

const pack: ModelPack = {
  game: game as unknown as GameJson,
  balance: balance as BalanceJson,
  tuning: tuning as TuningJson,
  pets: pets as PetsJson,
  eggs: eggs as EggsJson,
  worlds: (worldsJson as unknown as WorldsJson).worlds,
};

// M2-11: sim:balance checks 1, 2, 4 and 7 of docs/01-gdd.md 8.5 on the content pack.
describe('balance model (M2-11)', () => {
  it('greedy, tier 0: walls 1 / 3 / 6 ≤ 10 / 30 / 150 s, mountain 1 in 4.5–5.5 min, the longest wall ≤ 75 s', () => {
    const r = runCycle(pack, { profile: 'greedy' });
    const sec = (w: number): number => r.walls.find((x) => x.mountain === 1 && x.wall === w)!.sec;
    expect(sec(1)).toBeLessThanOrEqual(10);
    expect(sec(3)).toBeLessThanOrEqual(30);
    expect(sec(6)).toBeLessThanOrEqual(150);
    expect(r.mountains[0]! / 60).toBeGreaterThanOrEqual(4.5);
    expect(r.mountains[0]! / 60).toBeLessThanOrEqual(5.5);
    expect(r.walls).toHaveLength(60);
    expect(Math.max(...r.walls.map((w) => w.took))).toBeLessThanOrEqual(75);
    expect(r.caught).toBe(0);
  });

  it('lazy, tier 0: mountain 1 ≤ 8 min, caught ≤ 40% of waves, never twice in one wave; slower than greedy', () => {
    const lazy = runCycle(pack, { profile: 'lazy', mountains: 1 });
    const greedy = runCycle(pack, { profile: 'greedy', mountains: 1 });
    expect(lazy.mountains[0]! / 60).toBeLessThanOrEqual(8);
    expect(lazy.caught).toBeLessThanOrEqual(0.4 * lazy.normalWaves);
    expect(lazy.doubleCaught).toBe(0);
    expect(lazy.mountains[0]!).toBeGreaterThan(greedy.mountains[0]!);
  });

  it('port of the reference: mountain 1 walls match the column «Бот модели» of docs/01a-content.md 3 within ±10%', () => {
    const column = [7, 12, 18, 54, 70, 104, 117, 145, 180, 213, 261, 281];
    const r = runCycle(pack, { profile: 'greedy', mountains: 1 });
    r.walls.forEach((w, i) => expect(Math.abs(w.sec - column[i]!) / column[i]!).toBeLessThanOrEqual(0.1));
  });

  it('the generator of the reference: seed 12345 gives the same sequence as balance-model.pl', () => {
    const rnd = lcg(12345);
    // (12345 × 1103515245 + 12345) mod 2^31 = 1406932606
    expect(rnd()).toBeCloseTo(1406932606 / 2147483648, 12);
    expect(lcg(1)()).toBeCloseTo(((1103515245 + 12345) % 2147483648) / 2147483648, 12);
  });
});
