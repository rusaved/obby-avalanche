/**
 * Trails and auras (docs/01-gdd.md 7.3; docs/01a-content.md 7): bought for trophies in any order, kept forever (a
 * rebirth never takes them), one trail and one aura on; each is a step multiplier (src/sim/economy.ts gainMult).
 * The save holds what is owned (`trails`, `auras`) and what is on (`trail`, `aura`). Pure TS.
 */
import type { CosmeticItem } from '../content/types.ts';

export type CosmeticKind = 'trail' | 'aura';

/** The part of the save trails and auras live in (trophies to spend come from trophies.ts). */
export interface CosmeticBag {
  trophies?: number;
  trails?: string[];
  trail?: string;
  auras?: string[];
  aura?: string;
}

const ownedKey = (kind: CosmeticKind): 'trails' | 'auras' => (kind === 'trail' ? 'trails' : 'auras');

export function owned(bag: CosmeticBag, kind: CosmeticKind): string[] {
  return bag[ownedKey(kind)] ?? [];
}

/** Id of the item on, or null. */
export function wearing(bag: CosmeticBag, kind: CosmeticKind): string | null {
  return bag[kind] ?? null;
}

/** Multiplier of the item on (×1 when nothing is on or the id is unknown). */
export function cosmeticMult(bag: CosmeticBag, kind: CosmeticKind, items: readonly CosmeticItem[]): number {
  const id = wearing(bag, kind);
  return id ? (items.find((x) => x.id === id)?.mult ?? 1) : 1;
}

/**
 * Buys `id` for its price in trophies (docs/01-gdd.md 7.3): owned forever; it goes on when it is stronger than the
 * item on. False — unknown, already owned, or short of trophies (nothing changes then).
 */
export function buyCosmetic(bag: CosmeticBag, kind: CosmeticKind, items: readonly CosmeticItem[], id: string): boolean {
  const item = items.find((x) => x.id === id);
  if (!item || owned(bag, kind).includes(id) || !((bag.trophies ?? 0) >= item.price)) return false;
  bag.trophies = (bag.trophies ?? 0) - item.price;
  bag[ownedKey(kind)] = [...owned(bag, kind), id];
  if (item.mult > cosmeticMult(bag, kind, items)) bag[kind] = id;
  return true;
}

/** Puts an owned item on (one of each kind). */
export function equipCosmetic(bag: CosmeticBag, kind: CosmeticKind, id: string): boolean {
  if (!owned(bag, kind).includes(id)) return false;
  bag[kind] = id;
  return true;
}
