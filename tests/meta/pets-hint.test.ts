import { describe, expect, it } from 'vitest';
import { hintEgg, type PetBag } from '../../src/meta/pets.ts';
import { createHints, type HintFrame } from '../../src/meta/hints.ts';
import { mergePatch } from '../../src/content/pace.ts';
import balanceJson from '../../content/avalanche/balance.json' with { type: 'json' };
import openPatch from '../../content/avalanche/pace/open/balance.json' with { type: 'json' };
import petsJson from '../../content/avalanche/pets.json' with { type: 'json' };
import eggsJson from '../../content/avalanche/eggs.json' with { type: 'json' };
import type { BalanceJson, EggsJson, PetsJson } from '../../src/content/types.ts';

// SP-09 (docs/01-gdd.md 20.9, Q-065): «Pets speed up your steps» — an open egg with `coins` × its price in hand whose
// average pet beats `better` × the weakest pet on; the same rule the profiles of the model follow.
const pets = petsJson as PetsJson;
const eggs = (eggsJson as EggsJson).eggs;
const open = mergePatch(balanceJson as BalanceJson, openPatch);
const rule = open.hints.pets!;
const slots = open.pets.slots;
const price = (e: (typeof eggs)[number]): number => e.price;
const bag = (...ids: string[]): PetBag => ({ pets: ids, petsOn: ids.map((_, i) => i) });
const [snow, frost] = eggs;

describe('the pets hint (SP-09)', () => {
  it('the egg: the latest one paid `coins` times over whose average pet beats `better` × the weakest on', () => {
    // A free slot: any egg beats it; the latest one the coins cover twice.
    expect(hintEgg(bag(), pets, slots, [snow!, frost!], price, rule.coins * frost!.price, rule)?.id).toBe('frost');
    expect(hintEgg(bag(), pets, slots, [snow!, frost!], price, rule.coins * frost!.price - 1, rule)?.id).toBe('snow');
    expect(hintEgg(bag(), pets, slots, [snow!, frost!], price, rule.coins * snow!.price - 1, rule)).toBeNull();
    // Slots full, the weakest +20%: the snow egg (≈ +19.5% on average) is not worth it, the frost one is.
    const weak = bag('bunny', 'seal', 'fox');
    expect(hintEgg(weak, pets, slots, [snow!, frost!], price, 1e12, rule)?.id).toBe('frost');
    expect(hintEgg(weak, pets, slots, [snow!], price, 1e12, rule)).toBeNull();
    // Strong pets on: no open egg is worth its coins.
    expect(hintEgg(bag('fox', 'owl', 'lynx_cub'), pets, slots, [snow!, frost!], price, 1e12, rule)).toBeNull();
  });

  it('the plaque: up while the egg is worth it, gone on buying it or after `sec`, `max` times in a life; no rule — never', () => {
    const idle: HintFrame = {
      playSec: 600,
      moving: true,
      jumped: false,
      touch: false,
      nearLedge: false,
      shoesOffered: false,
      shoesBought: true,
      waveWarnId: 0,
      waveActive: false,
      goldOnGround: false,
      goldCarried: false,
      inShelter: false,
      caughtNow: false,
      treadmillCave: false,
      onBelt: false,
      nearClosedGate: false,
      stuckWay: false,
      onSummit: false,
      towardsPortal: false,
    };
    const counts: Record<string, number> = {};
    const h = createHints(open.hints, counts);
    const DT = 0.1;
    expect(h.update({ ...idle, petsOffered: true }, DT)).toBe('hint.pets');
    // Bought: gone at once.
    expect(h.update({ ...idle, petsOffered: false }, DT)).toBeNull();
    // Up again, gone after `sec` while still worth it, and not up again until the egg stops and starts being worth it.
    expect(h.update({ ...idle, petsOffered: true }, DT)).toBe('hint.pets');
    const seen = new Set<string | null>();
    for (let t = 0; t < rule.sec + 0.5; t += DT) seen.add(h.update({ ...idle, petsOffered: true }, DT));
    for (let t = 0; t < 30; t += DT) expect(h.update({ ...idle, petsOffered: true }, DT)).toBeNull();
    expect([...seen]).toEqual(['hint.pets', null]);
    expect(counts['hint.pets']).toBe(2);
    for (let k = 0; k < rule.max + 2; k++) {
      h.update({ ...idle, petsOffered: false }, DT);
      h.update({ ...idle, petsOffered: true }, DT);
    }
    expect(counts['hint.pets']).toBe(rule.max);
    // The classic pace has no hints.pets: never.
    expect(createHints((balanceJson as BalanceJson).hints, {}).update({ ...idle, petsOffered: true }, DT)).toBeNull();
  });
});
