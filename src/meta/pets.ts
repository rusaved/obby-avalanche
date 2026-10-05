/**
 * Eggs and pets (docs/01-gdd.md 7.2; docs/01a-content.md 6): an egg rolls one pet of its pool by the chances of
 * eggs.json, the inventory holds up to `balance.pets.inventory` pets (duplicates allowed), up to `balance.pets.slots`
 * of them are on. The pet multiplier is 1 + the bonuses of the pets on. Pure TS, no DOM; the RNG is passed in.
 */
import type { BalanceJson, EggsJson, PetsJson } from '../content/types.ts';
import { scaled } from '../sim/economy.ts';

export type Egg = EggsJson['eggs'][number];

/** The inventory in the save: pet ids in the order they came (`pets`) and indices of the pets on (`petsOn`). */
export interface PetBag {
  pets?: string[];
  petsOn?: number[];
}

/** Egg price on tier `tier`: price × wallScale[n] (docs/01-gdd.md 8.1). */
export function eggPrice(egg: Egg, tier: number, rebirth: BalanceJson['rebirth']): number {
  return scaled(egg.price, tier, rebirth);
}

/** One roll of the egg: `r` in [0, 1) walks the cumulative chances of the pool. */
export function rollEgg(egg: Egg, r: number): string {
  let acc = 0;
  for (const slot of egg.pool) {
    acc += slot.chance;
    if (r < acc) return slot.pet;
  }
  return egg.pool[egg.pool.length - 1]!.pet;
}

const bonusOf = (pets: PetsJson, id: string | undefined): number => (id ? (pets.pets.find((p) => p.id === id)?.bonus ?? 0) : 0);

/** Indices of the pets on. A save without `petsOn` (before M3-03) wears its best pets. */
export function equipped(bag: PetBag, pets: PetsJson, slots: number): number[] {
  const list = bag.pets ?? [];
  if (!bag.petsOn) return bestIndices(list, pets, slots);
  return bag.petsOn.filter((i, k, a) => i >= 0 && i < list.length && a.indexOf(i) === k).slice(0, slots);
}

/** Ids of the pets on (what the step multiplier and the pets next to the hero use). */
export function equippedIds(bag: PetBag, pets: PetsJson, slots: number): string[] {
  const list = bag.pets ?? [];
  return equipped(bag, pets, slots).map((i) => list[i]!);
}

/** The `slots` strongest pets of the inventory (ties: the earlier one). */
export function bestIndices(list: readonly string[], pets: PetsJson, slots: number): number[] {
  return list
    .map((id, i) => ({ i, b: bonusOf(pets, id) }))
    .sort((a, b) => b.b - a.b || a.i - b.i)
    .slice(0, slots)
    .map((x) => x.i);
}

/** Pet multiplier of the pets on: 1 + their bonuses (docs/01-gdd.md 7.2: +35% +20% +10% → ×1.65). */
export function petsOnMult(bag: PetBag, pets: PetsJson, slots: number): number {
  return 1 + equippedIds(bag, pets, slots).reduce((a, id) => a + bonusOf(pets, id), 0);
}

/** Puts pet `index` on; false when it is already on, out of range or all slots are taken. */
export function equipPet(bag: PetBag, pets: PetsJson, slots: number, index: number): boolean {
  const on = equipped(bag, pets, slots);
  if (index < 0 || index >= (bag.pets ?? []).length || on.includes(index) || on.length >= slots) return false;
  bag.petsOn = [...on, index];
  return true;
}

export function unequipPet(bag: PetBag, pets: PetsJson, slots: number, index: number): boolean {
  const on = equipped(bag, pets, slots);
  if (!on.includes(index)) return false;
  bag.petsOn = on.filter((i) => i !== index);
  return true;
}

/** «Equip best» (docs/01-gdd.md 7.2). */
export function equipBest(bag: PetBag, pets: PetsJson, slots: number): void {
  bag.petsOn = bestIndices(bag.pets ?? [], pets, slots);
}

/** Releases pet `index` (no reward); the indices of the pets on shift with the inventory. */
export function releasePet(bag: PetBag, pets: PetsJson, slots: number, index: number): boolean {
  const list = bag.pets ?? [];
  if (index < 0 || index >= list.length) return false;
  const on = equipped(bag, pets, slots);
  list.splice(index, 1);
  bag.pets = list;
  bag.petsOn = on.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i));
  return true;
}

/**
 * A new pet joins the inventory (an egg, the free egg of the first minute). It goes on into a free slot, or in place
 * of the weakest pet on when it is stronger, so a pet from the world counts at once. Null when there is no room.
 */
export function addPet(bag: PetBag, pets: PetsJson, b: Pick<BalanceJson['pets'], 'slots' | 'inventory'>, id: string): { index: number; on: boolean } | null {
  const list = (bag.pets ??= []);
  if (list.length >= b.inventory) return null;
  const on = equipped(bag, pets, b.slots);
  list.push(id);
  const index = list.length - 1;
  if (on.length < b.slots) {
    bag.petsOn = [...on, index];
    return { index, on: true };
  }
  let weakest = 0;
  on.forEach((i, k) => {
    if (bonusOf(pets, list[i]) < bonusOf(pets, list[on[weakest]!])) weakest = k;
  });
  if (bonusOf(pets, id) > bonusOf(pets, list[on[weakest]!])) {
    on[weakest] = index;
    bag.petsOn = on;
    return { index, on: true };
  }
  bag.petsOn = on;
  return { index, on: false };
}

/**
 * Collection counter (docs/01-gdd.md 7.2, Q-024): how many different kinds of `ids` the inventory has. Counts kinds,
 * not pets: a second Penguin changes nothing, a released pet counts down only when no pet of its kind is left.
 */
export function collected(list: readonly string[] | undefined, ids: readonly string[]): number {
  const have = new Set(list ?? []);
  return new Set(ids.filter((id) => have.has(id))).size;
}
