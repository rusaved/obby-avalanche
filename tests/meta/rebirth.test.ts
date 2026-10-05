import { describe, expect, it } from 'vitest';
import { applyRebirth, markSummit, rebirthGoal, rebirthPreview, rebirthReady, tierRewards } from '../../src/meta/rebirth.ts';
import { createMetaView } from '../../src/app/meta-view.ts';
import { createSave, type SaveData } from '../../src/meta/save.ts';
import { createSim } from '../../src/sim/world.ts';
import { buildLevel } from '../../src/level/builder.ts';
import tuningJson from '../../content/avalanche/tuning.json' with { type: 'json' };
import worldsJson from '../../content/avalanche/worlds.json' with { type: 'json' };
import balanceJson from '../../content/avalanche/balance.json' with { type: 'json' };
import sampleBalance from '../../content/_sample/balance.json' with { type: 'json' };
import petsJson from '../../content/avalanche/pets.json' with { type: 'json' };
import trailsJson from '../../content/avalanche/trails.json' with { type: 'json' };
import aurasJson from '../../content/avalanche/auras.json' with { type: 'json' };
import skinsJson from '../../content/avalanche/skins.json' with { type: 'json' };
import type { AurasJson, BalanceJson, PetsJson, SkinsJson, TrailsJson, TuningJson, WorldsJson } from '../../src/content/types.ts';
import type { Hud } from '../../src/ui/hud.ts';

const balance = balanceJson as BalanceJson;
const pets = petsJson as PetsJson;
const skins = skinsJson as SkinsJson;
const tuning = tuningJson as TuningJson;
const worlds = worldsJson as unknown as WorldsJson;
const noHud = new Proxy({} as Hud, { get: () => () => undefined });
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
const DT = 1 / 60;

/** A player at the summit of mountain 5 on `tier` with everything the meta has: pets, looks, cosmetics, trophies, the
 * calendar and the quests (their fields come with M3-08; the rebirth must not touch any field it does not own). */
function fullSave(tier: number): SaveData {
  const save = createSave(1000);
  Object.assign(save, {
    tier,
    summits: 5,
    shoes: 9,
    pets: ['bunny', 'penguin', 'seal', 'penguin'],
    petsOn: [0, 1, 2],
    trophies: 37,
    trophiesTotal: 120,
    trails: ['trail_snow', 'trail_ice'],
    trail: 'trail_ice',
    auras: ['aura_sparks'],
    aura: 'aura_sparks',
    skins: ['skier'],
    skin: 'skier',
    wings: ['wings_ice'],
    wing: 'wings_ice',
    flags: { firstWaveDone: true, shoesBtn: true },
    hints: { move: 2 },
    totalPlaySec: 2400,
    wavesNormal: 30,
    daily: { day: 4, claimedAt: 900 },
    quests: { day: 4, list: ['q_walls', 'q_gifts', 'q_egg'], done: [true, false, false] },
  });
  return save;
}

// M3-06: rebirth on 10 tiers (docs/01-gdd.md 7.5, 8.4; GDD-08; docs/01a-content.md 9).
describe('rebirth (M3-06)', () => {
  it('after the rebirth: stat 0, coins 0, shoes L0, mountain 1, the camp; pets, skins, wings, trails, auras, trophies, calendar and quests in place; step ×3^n', () => {
    const save = fullSave(0);
    const before = structuredClone(save);
    // The cycle before: mountain 5, far up the slope, a big stat and coins.
    const w5 = worlds.worlds[4]!;
    const old = createSim(buildLevel(w5), tuning, { balance, speedCurve: curve, stat: 2e10, coins: 5e9, tier: 0 });
    old.teleport(0, 30, 1500);
    expect(rebirthReady(save, balance)).toBe(true);

    const r = applyRebirth(save, balance, skins);
    expect(r).toEqual({ tier: 1, world: 1, stat: 0, coins: 0, rewards: [{ kind: 'skin', id: 'snow_ninja' }] });
    // The new cycle as main.ts builds it from the result.
    const w1 = worlds.worlds[r.world - 1]!;
    const sim = createSim(buildLevel(w1), tuning, { balance, speedCurve: curve, stat: r.stat, coins: r.coins, tier: r.tier });
    expect(sim.level.worldIndex).toBe(1);
    expect(sim.progress.stat).toBe(0);
    expect(sim.coins).toBe(0);
    expect(sim.tier).toBe(1);
    expect(sim.hero.pos.z).toBeLessThan(w1.safeZones[0]![1]);
    expect(sim.gatesOpen.every((o) => !o)).toBe(true);
    expect(save.shoes).toBe(0);
    expect(save.summits).toBe(0);
    expect(save.tier).toBe(1);
    // Nothing else of the save changed; the tier skin came on top of the skins owned and is on.
    const { tier: _t, shoes: _s, summits: _m, skins: sk, skin, ...rest } = save;
    const { tier: _t0, shoes: _s0, summits: _m0, skins: sk0, skin: _k0, ...restBefore } = before;
    expect(rest).toEqual(restBefore);
    expect(sk).toEqual([...(sk0 ?? []), 'snow_ninja']);
    expect(skin).toBe('snow_ninja');
    expect(save.pets).toEqual(['bunny', 'penguin', 'seal', 'penguin']);
    expect([save.trail, save.aura, save.wing, save.trophies, save.trophiesTotal]).toEqual(['trail_ice', 'aura_sparks', 'wings_ice', 37, 120]);
    expect((save as unknown as Record<string, unknown>)['daily']).toEqual({ day: 4, claimedAt: 900 });
    expect((save as unknown as Record<string, unknown>)['quests']).toEqual(before['quests' as keyof SaveData]);

    // The step: × 3 of the tier, with the shoes back to the starting pair and the pets, trail and aura still on.
    const meta = createMetaView({ balance, pets, trails: trailsJson as TrailsJson, auras: aurasJson as AurasJson, save, getSim: () => sim, hud: noHud, numSuffix: (k) => k, trackOnce: () => {}, persist: () => {} });
    meta.resetShoes();
    expect(meta.shoeLevel).toBe(0);
    const zero = fullSave(0);
    zero.shoes = 0;
    const metaZero = createMetaView({ balance, pets, trails: trailsJson as TrailsJson, auras: aurasJson as AurasJson, save: zero, getSim: () => old, hud: noHud, numSuffix: (k) => k, trackOnce: () => {}, persist: () => {} });
    metaZero.apply();
    expect(sim.progress.gainMult / old.progress.gainMult).toBeCloseTo(3, 9);
    // Walking steps on the new tier: every step gives gainPerStep × 3 × the meta.
    const stat0 = sim.progress.stat;
    for (let i = 0; i < 120; i++) sim.step({ moveX: 0, moveZ: 1, jump: false, jumpHeld: false }, DT);
    const steps = sim.progress.steps;
    expect(steps).toBeGreaterThan(0);
    expect(sim.progress.stat - stat0).toBeCloseTo(steps * balance.gainPerStep * sim.progress.gainMult, 6);
  });

  it('10 tiers: step ×3^n, walls × wallScale[n]; looks of tiers 1, 3, 5, 7, 10 from skins.json (01a 9), each once', () => {
    const save = fullSave(0);
    const got: string[] = [];
    for (let n = 1; n <= 10; n++) {
      save.summits = 5;
      const p = rebirthPreview(balance, skins, n - 1);
      expect([p.tier, p.stepNow, p.stepNext]).toEqual([n, 3 ** (n - 1), 3 ** n]);
      const r = applyRebirth(save, balance, skins);
      expect(r.tier).toBe(n);
      got.push(...r.rewards.map((x) => `${n}:${x.id}`));
      const sim = createSim(buildLevel(worlds.worlds[0]!), tuning, { balance, speedCurve: curve, stat: 0, tier: n });
      expect(sim.gateRequirement(0)).toBeCloseTo(20 * balance.rebirth.wallScale[Math.min(n, 9)]! * (n > 9 ? balance.rebirth.wallScaleGrowth : 1), 6);
    }
    expect(got).toEqual(['1:snow_ninja', '3:ice_guard', '5:stargazer', '7:wings_radiant', '10:wings_comet']);
    expect(save.skins).toEqual(['skier', 'snow_ninja', 'ice_guard', 'stargazer']);
    expect(save.wings).toEqual(['wings_ice', 'wings_radiant', 'wings_comet']);
    expect(save.wing).toBe('wings_comet');
    expect(tierRewards(skins, 2)).toEqual([]);
  });

  it('open only after the summit of the mountain of rebirth.unlock on this tier: «Mountain a/5» counts the summits', () => {
    expect(rebirthGoal(balance)).toBe(5);
    expect(rebirthGoal(sampleBalance as BalanceJson)).toBe(1);
    const save = createSave(0);
    expect(rebirthReady(save, balance)).toBe(false);
    for (const w of [1, 2, 3, 4]) {
      markSummit(save, w);
      expect(save.summits).toBe(w);
      expect(rebirthReady(save, balance)).toBe(false);
    }
    markSummit(save, 2);
    expect(save.summits).toBe(4);
    markSummit(save, 5);
    expect(rebirthReady(save, balance)).toBe(true);
    applyRebirth(save, balance, skins);
    expect(rebirthReady(save, balance)).toBe(false);
  });
});
