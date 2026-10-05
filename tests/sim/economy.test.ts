import { describe, expect, it } from 'vitest';
import { gainMult as metaGain } from '../../src/meta/shoes.ts';
import { gainMult, rewardCoins, scaled, statNowGain, stepGain, summitTrophies } from '../../src/sim/economy.ts';
import { createStepTracker } from '../../src/sim/steps.ts';
import balanceJson from '../../content/avalanche/balance.json' with { type: 'json' };
import petsJson from '../../content/avalanche/pets.json' with { type: 'json' };
import type { BalanceJson, PetsJson } from '../../src/content/types.ts';

const balance = balanceJson as BalanceJson;
const pets = petsJson as PetsJson;
const clone = (): BalanceJson => structuredClone(balance);

// M3-01: the step by docs/01-gdd.md 8.1 — gain = 1 × 3^n × shoe × pets × trail × aura × boost × vip, × treadmill(p).
describe('economy formulas (M3-01)', () => {
  // Five sets of multipliers, the expected number worked out by hand from 8.1 and the tables of 01a (sections 5, 6, 7).
  const sets = [
    // Start: old sneakers, no pets, tier 0 → 1.
    { m: { tier: 0, shoeLevel: 0, pets: [] }, belt: 1, want: 1 },
    // Runners ×2 and the bunny of the free egg (+0.2): 2 × 1.2.
    { m: { tier: 0, shoeLevel: 1, pets: ['bunny'] }, belt: 1, want: 2.4 },
    // Tier 2 (×9), ice spikes ×5, seal + fox (1 + 0.35 + 0.6), ice trail ×1.25, sparks aura ×1.2: 9 × 5 × 1.95 × 1.25 × 1.2.
    { m: { tier: 2, shoeLevel: 3, pets: ['seal', 'fox'], trail: 1.25, aura: 1.2 }, belt: 1, want: 131.625 },
    // Tier 1 (×3), slope legend ×1200, best 3 of 4 pets (8 + 5.5 + 5 → ×19.5), comet tail ×5, ice crown ×6, boost ×2, VIP ×2.
    { m: { tier: 1, shoeLevel: 15, pets: ['crystal_hedgehog', 'ice_griffin', 'phoenix', 'penguin'], trail: 5, aura: 6, boost: true, vip: true }, belt: 1, want: 8_424_000 },
    // Tier 9 (×19 683), comets ×80, owl + polar bear + walrus (×6), boost ×2, on the ×2.5K treadmill: 19 683 × 80 × 6 × 2 × 2500.
    { m: { tier: 9, shoeLevel: 9, pets: ['owl', 'polar_bear', 'walrus'], boost: true }, belt: 2500, want: 47_239_200_000 },
  ];

  it('five sets of multipliers: the gain of a step equals the hand calculation by 8.1', () => {
    for (const s of sets) {
      const mult = metaGain(balance, pets, s.m);
      // The game path: the step tracker of the simulation takes the meta multiplier, one step = stepLength of path.
      const tracker = createStepTracker(balance);
      tracker.gainMult = mult;
      const [gain] = tracker.advance(balance.stepLength, s.belt);
      expect(gain?.amount).toBeCloseTo(s.want, 6);
      expect(balance.gainPerStep * mult * s.belt).toBeCloseTo(s.want, 6);
    }
    // The bare formula with numbers instead of ids gives the same.
    expect(stepGain(balance, { tier: 2, shoe: 5, pets: 1.95, trail: 1.25, aura: 1.2 })).toBeCloseTo(131.625, 9);
    expect(stepGain(balance, { tier: 9, shoe: 80, pets: 6, boost: true }, 2500)).toBeCloseTo(47_239_200_000, 0);
  });

  it('prices, coins, trophies and «speed now» by 8.1', () => {
    // Shoes «Snow Runners» 200 on tier 1: × wallScale[1] = 15; gate pass of a zone with gift 40 on tier 2: 2 × 40 × 50.
    expect(scaled(200, 1, balance.rebirth)).toBe(3000);
    expect(rewardCoins(balance, 'gatePass', 40, 2)).toBe(4000);
    expect(rewardCoins(balance, 'waveSurvived', 40, 0)).toBe(120);
    expect(rewardCoins(balance, 'chest', 40, 0)).toBe(1000);
    // Tier 10 is past the table: wallScale[9] × wallScaleGrowth (800K × 3.5 after sim:balance --fit, M3-10).
    expect(scaled(1, 10, balance.rebirth)).toBe(balance.rebirth.wallScale[9]! * balance.rebirth.wallScaleGrowth);
    // Trophies g × (1 + n): 15 for five summits on tier 0, mountain 5 on tier 9 — 50.
    expect([1, 2, 3, 4, 5].reduce((a, g) => a + summitTrophies(balance, g, 0), 0)).toBe(15);
    expect(summitTrophies(balance, 5, 9)).toBe(50);
    // «Speed now»: gain × treadmill × steps a second × 120 s: runners on a ×5 belt at 16 u/s → 2 × 5 × 4 × 120.
    expect(statNowGain(balance, { shoe: 2 }, 5, 16)).toBe(4800);
  });

  it('a change of balance.json changes the result with no code change', () => {
    const m = { tier: 1, shoeLevel: 1, pets: ['bunny'], boost: true, vip: true };
    const base = metaGain(balance, pets, m);
    expect(base).toBeCloseTo(3 * 2 * 1.2 * 2 * 2, 9);
    const b = clone();
    b.rebirth.stepMult = 4;
    expect(metaGain(b, pets, m)).toBeCloseTo((base * 4) / 3, 9);
    b.upgrade.tiers[1]!.mult = 3;
    b.boost.x2Mult = 3;
    b.iap.vipMult = 5;
    expect(metaGain(b, pets, m)).toBeCloseTo(4 * 3 * 1.2 * 3 * 5, 9);
    b.gainPerStep = 7;
    expect(stepGain(b, { tier: 0 })).toBe(7);
    const tracker = createStepTracker(b);
    expect(tracker.advance(b.stepLength, 1)[0]?.amount).toBe(7);
    b.rebirth.wallScale = [1, 10];
    expect(scaled(200, 1, b.rebirth)).toBe(2000);
    b.coins.gatePass = 5;
    expect(rewardCoins(b, 'gatePass', 40, 0)).toBe(200);
    b.trophies.perSummit = 'world * 2 + tier';
    expect(summitTrophies(b, 5, 3)).toBe(13);
    expect(gainMult(b, {})).toBe(1);
  });

  it('a broken trophies formula throws (the validator reports it)', () => {
    const b = clone();
    b.trophies.perSummit = 'world * level';
    expect(() => summitTrophies(b, 1, 0)).toThrow(/unknown name level/);
    b.trophies.perSummit = 'world * (1 + tier';
    expect(() => summitTrophies(b, 1, 0)).toThrow(/missing \)/);
  });
});
