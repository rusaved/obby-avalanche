import { describe, expect, it } from 'vitest';
import { runMountain1, type ModelPack } from '../../scripts/balance-model.ts';
import game from '../../content/avalanche/game.json' with { type: 'json' };
import balance from '../../content/avalanche/balance.json' with { type: 'json' };
import tuning from '../../content/avalanche/tuning.json' with { type: 'json' };
import pets from '../../content/avalanche/pets.json' with { type: 'json' };
import worldsJson from '../../content/avalanche/worlds.json' with { type: 'json' };
import type { BalanceJson, GameJson, PetsJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

const pack: ModelPack = {
  game: game as unknown as GameJson,
  balance: balance as BalanceJson,
  tuning: tuning as TuningJson,
  pets: pets as PetsJson,
  world: (worldsJson as unknown as WorldsJson).worlds[0]!,
};

// M2-12: profile «Gold seeker» of the economic model (docs/01-gdd.md 8.5): mountain 1 of tier 0 takes ≥ 4.0 min.
describe('balance model: gold seeker (M2-12)', () => {
  it('greedy + every golden gift from the 2nd normal wave: mountain 1 of tier 0 is not shorter than 4.0 min', () => {
    const gold = runMountain1(pack, 'goldSeeker');
    const greedy = runMountain1(pack, 'greedy');
    expect(gold.goldTaken).toBeGreaterThan(0);
    expect(greedy.goldTaken).toBe(0);
    expect(gold.walls).toHaveLength(12);
    expect(gold.sec / 60).toBeGreaterThanOrEqual(4.0);
  });

  it('without threat.bonus the gold seeker plays as the greedy one', () => {
    const { bonus: _, ...threat } = pack.game.threat;
    const noBonus: ModelPack = { ...pack, game: { ...pack.game, threat } };
    expect(runMountain1(noBonus, 'goldSeeker')).toEqual(runMountain1(noBonus, 'greedy'));
  });
});
