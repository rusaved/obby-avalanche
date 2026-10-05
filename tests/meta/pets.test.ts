import { describe, expect, it } from 'vitest';
import { addPet, eggPrice, equipBest, equipPet, equipped, equippedIds, petsOnMult, releasePet, rollEgg, unequipPet, type PetBag } from '../../src/meta/pets.ts';
import { createMetaView } from '../../src/app/meta-view.ts';
import { createSave } from '../../src/meta/save.ts';
import { createRng } from '../../src/core/rng.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { createSim } from '../../src/sim/world.ts';
import { NO_INPUT } from '../../src/sim/controller.ts';
import balanceJson from '../../content/avalanche/balance.json' with { type: 'json' };
import petsJson from '../../content/avalanche/pets.json' with { type: 'json' };
import eggsJson from '../../content/avalanche/eggs.json' with { type: 'json' };
import tuning from '../../content/avalanche/tuning.json' with { type: 'json' };
import worldsJson from '../../content/avalanche/worlds.json' with { type: 'json' };
import type { BalanceJson, EggsJson, PetsJson, TuningJson, WorldsJson } from '../../src/content/types.ts';
import type { Hud } from '../../src/ui/hud.ts';

const balance = balanceJson as BalanceJson;
const pets = petsJson as PetsJson;
const eggs = eggsJson as EggsJson;
const slots = balance.pets.slots;
const noHud = new Proxy({} as Hud, { get: () => () => undefined });

// M3-03: eggs and pets (docs/01-gdd.md 7.2; docs/01a-content.md 6).
describe('eggs and pets (M3-03)', () => {
  it('5 eggs, 27 pets; chances of every egg sum to 1, 100 000 seeded opens land within ±1% of them', () => {
    expect(eggs.eggs.map((e) => e.id)).toEqual(['snow', 'frost', 'ice', 'blizzard', 'aurora']);
    expect(pets.pets).toHaveLength(27);
    for (const egg of eggs.eggs) {
      expect(egg.pool.reduce((a, s) => a + s.chance, 0), egg.id).toBeCloseTo(1, 12);
      const rng = createRng(20261005);
      const counts = new Map<string, number>();
      const N = 100_000;
      for (let i = 0; i < N; i++) {
        const pet = rollEgg(egg, rng.next());
        counts.set(pet, (counts.get(pet) ?? 0) + 1);
      }
      for (const slot of egg.pool) expect(Math.abs((counts.get(slot.pet) ?? 0) / N - slot.chance), `${egg.id}/${slot.pet}`).toBeLessThanOrEqual(0.01);
      expect([...counts.keys()].every((id) => egg.pool.some((s) => s.pet === id))).toBe(true);
    }
    // The special pets never come out of an egg.
    const fromEggs = new Set(eggs.eggs.flatMap((e) => e.pool.map((s) => s.pet)));
    expect(fromEggs.has('reindeer') || fromEggs.has('gold_penguin')).toBe(false);
    expect(fromEggs.size).toBe(25);
  });

  it('price × wallScale[n]; the egg can be bought again and again (duplicates in the grid)', () => {
    const snow = eggs.eggs[0]!;
    expect(eggPrice(snow, 0, balance.rebirth)).toBe(500);
    expect(eggPrice(snow, 1, balance.rebirth)).toBe(500 * 15);
    const bag: PetBag = {};
    for (let i = 0; i < 4; i++) expect(addPet(bag, pets, balance.pets, 'penguin')).not.toBeNull();
    expect(bag.pets).toEqual(['penguin', 'penguin', 'penguin', 'penguin']);
  });

  it('no more than 3 on: equip, unequip, equip best, release; ×(1 + bonuses of the pets on)', () => {
    const bag: PetBag = { pets: ['penguin', 'bunny', 'seal', 'fox', 'owl'], petsOn: [] };
    expect(equipPet(bag, pets, slots, 0)).toBe(true);
    expect(equipPet(bag, pets, slots, 0)).toBe(false); // already on
    expect(equipPet(bag, pets, slots, 1)).toBe(true);
    expect(equipPet(bag, pets, slots, 2)).toBe(true);
    expect(equipPet(bag, pets, slots, 3)).toBe(false); // the 4th: slots are full
    expect(equipped(bag, pets, slots)).toEqual([0, 1, 2]);
    expect(petsOnMult(bag, pets, slots)).toBeCloseTo(1 + 0.1 + 0.2 + 0.35, 12); // docs/01-gdd.md 7.2: ×1.65
    // A broken save with 5 indices still counts only 3.
    expect(equipped({ pets: bag.pets!, petsOn: [0, 1, 2, 3, 4] }, pets, slots)).toHaveLength(3);
    expect(unequipPet(bag, pets, slots, 0)).toBe(true);
    expect(equipPet(bag, pets, slots, 4)).toBe(true);
    expect(equippedIds(bag, pets, slots).sort()).toEqual(['bunny', 'owl', 'seal']);
    equipBest(bag, pets, slots);
    expect(equippedIds(bag, pets, slots)).toEqual(['owl', 'fox', 'seal']);
    expect(petsOnMult(bag, pets, slots)).toBeCloseTo(1 + 1 + 0.6 + 0.35, 12);
    // Releasing a pet on frees its slot; the indices of the others follow the inventory.
    expect(releasePet(bag, pets, slots, 3)).toBe(true); // fox
    expect(bag.pets).toEqual(['penguin', 'bunny', 'seal', 'owl']);
    expect(equippedIds(bag, pets, slots).sort()).toEqual(['owl', 'seal']);
    // A save from before M3-03 (no petsOn) wears its best pets.
    expect(equippedIds({ pets: ['penguin', 'owl', 'bunny', 'seal'] }, pets, slots)).toEqual(['owl', 'seal', 'bunny']);
  });

  it('a new pet goes on into a free slot or instead of the weakest pet on; 30 places at most', () => {
    const bag: PetBag = {};
    expect(addPet(bag, pets, balance.pets, 'bunny')).toEqual({ index: 0, on: true });
    expect(addPet(bag, pets, balance.pets, 'penguin')).toEqual({ index: 1, on: true });
    expect(addPet(bag, pets, balance.pets, 'penguin')).toEqual({ index: 2, on: true });
    // Slots full: a weaker or equal pet stays in the grid, a stronger one replaces the weakest.
    expect(addPet(bag, pets, balance.pets, 'penguin')).toEqual({ index: 3, on: false });
    expect(addPet(bag, pets, balance.pets, 'fox')).toEqual({ index: 4, on: true });
    expect(equippedIds(bag, pets, slots).sort()).toEqual(['bunny', 'fox', 'penguin']);
    while ((bag.pets ?? []).length < balance.pets.inventory) addPet(bag, pets, balance.pets, 'penguin');
    expect(bag.pets).toHaveLength(30);
    expect(addPet(bag, pets, balance.pets, 'owl')).toBeNull();
    expect(bag.pets).toHaveLength(30);
  });

  it('the step multiplier takes only the pets on (meta view → simulation)', () => {
    const save = createSave(0);
    save.pets = ['owl', 'fox', 'seal', 'bunny'];
    save.petsOn = [3];
    const sim = { coins: 0, tier: 0, progress: { gainMult: 1 } } as unknown as Parameters<typeof createMetaView>[0] extends { getSim(): infer S } ? S : never;
    const meta = createMetaView({ balance, pets, save, getSim: () => sim, hud: noHud, numSuffix: (k) => k, trackOnce: () => undefined, persist: () => undefined });
    meta.apply();
    expect(sim.progress.gainMult).toBeCloseTo(1.2, 12);
    save.petsOn = [0, 1, 2];
    meta.apply();
    expect(sim.progress.gainMult).toBeCloseTo(1 + 1 + 0.6 + 0.35, 12);
  });
});

// M2-07 (GDD-04): the avalanche never catches the pets — after «Snowed in!» the inventory, the pets on and the step
// multiplier are the same.
describe('pets are not caught (M2-07, M3-03)', () => {
  it('a catch changes neither the pets nor the multiplier they give', () => {
    const tun = tuning as TuningJson;
    const world1 = (worldsJson as unknown as WorldsJson).worlds[0]!;
    const level = buildLevel(world1);
    const sim = createSim(level, tun, {
      balance,
      speedCurve: balance.speedCurve,
      threat: { threat: { ...world1.threat }, balance, avalanche: tun.avalanche, scriptedPending: false, normalWavesDone: 99 },
    });
    const save = createSave(0);
    save.pets = ['bunny', 'fox', 'penguin', 'owl'];
    save.petsOn = [0, 1, 3];
    const meta = createMetaView({ balance, pets, save, getSim: () => sim, hud: noHud, numSuffix: (k) => k, trackOnce: () => undefined, persist: () => undefined });
    meta.apply();
    const mult = sim.progress.gainMult;
    expect(mult).toBeCloseTo(1 + 0.2 + 0.6 + 1, 12);
    let caught = 0;
    sim.events.on('waveCaught', () => caught++);
    sim.teleport(0, level.floorYAt(600) + 0.05, 600);
    sim.threat!.trigger();
    sim.step(NO_INPUT, 1 / 60);
    let guard = 0;
    while ((sim.threat!.state.phase !== 'idle' || sim.caught) && guard++ < 60 * 120) sim.step(NO_INPUT, 1 / 60);
    expect(caught).toBe(1);
    expect(save.pets).toEqual(['bunny', 'fox', 'penguin', 'owl']);
    expect(save.petsOn).toEqual([0, 1, 3]);
    expect(sim.progress.gainMult).toBe(mult);
  });
});
