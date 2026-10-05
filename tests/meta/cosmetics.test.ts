import { describe, expect, it } from 'vitest';
import { buyCosmetic, cosmeticMult, equipCosmetic, owned, wearing, type CosmeticBag } from '../../src/meta/cosmetics.ts';
import { createMetaView } from '../../src/app/meta-view.ts';
import { createSave } from '../../src/meta/save.ts';
import { createStepTracker } from '../../src/sim/steps.ts';
import { cosmeticMults, newMeta, runCycle, spendTrophies, type ModelPack } from '../../scripts/balance-model.ts';
import game from '../../content/avalanche/game.json' with { type: 'json' };
import tuning from '../../content/avalanche/tuning.json' with { type: 'json' };
import eggs from '../../content/avalanche/eggs.json' with { type: 'json' };
import worldsJson from '../../content/avalanche/worlds.json' with { type: 'json' };
import balanceJson from '../../content/avalanche/balance.json' with { type: 'json' };
import petsJson from '../../content/avalanche/pets.json' with { type: 'json' };
import trailsJson from '../../content/avalanche/trails.json' with { type: 'json' };
import aurasJson from '../../content/avalanche/auras.json' with { type: 'json' };
import skinsJson from '../../content/avalanche/skins.json' with { type: 'json' };
import ru from '../../content/avalanche/i18n/ru.json' with { type: 'json' };
import en from '../../content/avalanche/i18n/en.json' with { type: 'json' };
import type { AurasJson, BalanceJson, EggsJson, GameJson, PetsJson, SkinsJson, TrailsJson, TuningJson, WorldsJson } from '../../src/content/types.ts';
import type { Hud } from '../../src/ui/hud.ts';

const balance = balanceJson as BalanceJson;
const pets = petsJson as PetsJson;
const trails = (trailsJson as TrailsJson).trails;
const auras = (aurasJson as AurasJson).auras;
const noHud = new Proxy({} as Hud, { get: () => () => undefined });

// M3-04: trails and auras for trophies, forever (docs/01-gdd.md 7.3; docs/01a-content.md 7), the default skin (7.4).
describe('trails and auras (M3-04)', () => {
  it('8 trails ×1.1 … ×5 and 6 auras ×1.2 … ×6 with trophy prices of docs/01a-content.md 7, names in ru and en', () => {
    expect(trails.map((x) => [x.id, x.mult, x.price])).toEqual([
      ['trail_snow', 1.1, 3], ['trail_ice', 1.25, 10], ['trail_mint', 1.5, 25], ['trail_rainbow', 2, 60],
      ['trail_fire', 2.5, 120], ['trail_star', 3, 250], ['trail_aurora', 4, 500], ['trail_comet', 5, 1000],
    ]);
    expect(auras.map((x) => [x.id, x.mult, x.price])).toEqual([
      ['aura_sparks', 1.2, 8], ['aura_snowflakes', 1.5, 30], ['aura_whirl', 2, 80], ['aura_lightning', 3, 200], ['aura_northern', 4, 450], ['aura_ice_crown', 6, 1000],
    ]);
    for (const [kind, list] of [['trail', trails], ['aura', auras]] as const) {
      for (const x of list) {
        expect((ru as Record<string, string>)[`${kind}.${x.id}`], x.id).toBeTruthy();
        expect((en as Record<string, string>)[`${kind}.${x.id}`], x.id).toBeTruthy();
      }
    }
  });

  it('bought for trophies: short — nothing changes; bought — owned, on when stronger; equip any owned one', () => {
    const bag: CosmeticBag = { trophies: 2 };
    expect(buyCosmetic(bag, 'trail', trails, 'trail_snow')).toBe(false); // 3 trophies, 2 on hand
    expect(bag).toEqual({ trophies: 2 });
    bag.trophies = 40;
    expect(buyCosmetic(bag, 'trail', trails, 'trail_ice')).toBe(true);
    expect(bag.trophies).toBe(30);
    expect(wearing(bag, 'trail')).toBe('trail_ice');
    // A weaker one bought later stays in the bag, the stronger one stays on; no second purchase of the same.
    expect(buyCosmetic(bag, 'trail', trails, 'trail_snow')).toBe(true);
    expect(wearing(bag, 'trail')).toBe('trail_ice');
    expect(buyCosmetic(bag, 'trail', trails, 'trail_snow')).toBe(false);
    expect(owned(bag, 'trail')).toEqual(['trail_ice', 'trail_snow']);
    expect(bag.trophies).toBe(27);
    expect(equipCosmetic(bag, 'trail', 'trail_snow')).toBe(true);
    expect(cosmeticMult(bag, 'trail', trails)).toBe(1.1);
    expect(equipCosmetic(bag, 'trail', 'trail_comet')).toBe(false); // not owned
    expect(buyCosmetic(bag, 'aura', auras, 'aura_sparks')).toBe(true);
    expect(bag.trophies).toBe(19);
    expect(cosmeticMult(bag, 'aura', auras)).toBe(1.2);
    expect(buyCosmetic(bag, 'aura', auras, 'unknown')).toBe(false);
    expect(cosmeticMult({}, 'aura', auras)).toBe(1);
  });

  it('the trail and aura multipliers go into the step; after a rebirth they stay, the step grows ×3', () => {
    const save = createSave(0);
    save.pets = ['bunny'];
    save.shoes = 1; // Runners ×2
    save.trophies = 100;
    const sim = { coins: 0, tier: 0, progress: { gainMult: 1 } } as unknown as Parameters<typeof createMetaView>[0] extends { getSim(): infer S } ? S : never;
    const meta = createMetaView({ balance, pets, trails: { trails }, auras: { auras }, save, getSim: () => sim, hud: noHud, numSuffix: (k) => k, trackOnce: () => undefined, persist: () => undefined });
    meta.apply();
    expect(sim.progress.gainMult).toBeCloseTo(2 * 1.2, 12);
    buyCosmetic(save, 'trail', trails, 'trail_mint'); // ×1.5 for 25
    buyCosmetic(save, 'aura', auras, 'aura_snowflakes'); // ×1.5 for 30
    meta.apply();
    expect(save.trophies).toBe(45);
    const mult = 2 * 1.2 * 1.5 * 1.5;
    expect(sim.progress.gainMult).toBeCloseTo(mult, 12);
    // One step of the simulation's step tracker: gainPerStep × the meta multiplier.
    const tracker = createStepTracker(balance);
    tracker.gainMult = sim.progress.gainMult;
    expect(tracker.advance(balance.stepLength, 1)[0]?.amount).toBeCloseTo(balance.gainPerStep * mult, 9);
    // Rebirth (M3-06 calls these): shoes back to the start, tier + 1 — trails and auras stay with the player.
    meta.resetShoes();
    (sim as { tier: number }).tier = 1;
    meta.apply();
    expect(owned(save, 'trail')).toEqual(['trail_mint']);
    expect(owned(save, 'aura')).toEqual(['aura_snowflakes']);
    expect(wearing(save, 'trail')).toBe('trail_mint');
    expect(wearing(save, 'aura')).toBe('aura_snowflakes');
    expect(sim.progress.gainMult).toBeCloseTo(balance.rebirth.stepMult * 1 * 1.2 * 1.5 * 1.5, 12);
  });

  it('the wardrobe starts with the default skin of skins.json', () => {
    const skins = skinsJson as SkinsJson;
    expect(skins.skins.find((x) => x.id === skins.default)?.unlock.kind).toBe('default');
    expect((ru as Record<string, string>)[`skin.${skins.default}`]).toBe('Мандарин');
    expect(createSave(0).skin).toBeUndefined(); // no skin in a new save: the hero wears the default
  });

  it('balance model: the bot spends trophies like spendTrophies of the reference, trail and aura go into its step', () => {
    const base: ModelPack = { game: game as unknown as GameJson, balance, tuning: tuning as TuningJson, pets, eggs: eggs as EggsJson, worlds: (worldsJson as unknown as WorldsJson).worlds };
    const pack: ModelPack = { ...base, trails: { trails }, auras: { auras } };
    // 15 trophies of tier 0: trail ×1.1 (3, not dearer than the aura's 8), then aura ×1.2 (8); 4 left.
    const meta = { ...newMeta(), trophies: 15 };
    spendTrophies(pack, meta);
    expect(meta).toMatchObject({ trophies: 4, trail: 1, aura: 1 });
    expect(cosmeticMults(pack, meta)).toEqual({ trail: 1.1, aura: 1.2 });
    // Tier 0 → tier 1 with the meta carried over: with trails and auras the cycle of tier 1 is shorter.
    const run = (p: ModelPack): number => {
      const m = newMeta();
      runCycle(p, { profile: 'greedy', tier: 0, meta: m });
      return runCycle(p, { profile: 'greedy', tier: 1, meta: m }).sec;
    };
    expect(run(pack)).toBeLessThan(run(base));
  });
});
