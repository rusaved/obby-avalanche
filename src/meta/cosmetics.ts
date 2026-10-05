/**
 * Trails and auras (docs/01-gdd.md 7.3; docs/01a-content.md 7): bought for trophies in any order, kept forever (a
 * rebirth never takes them), one trail and one aura on; each is a step multiplier (src/sim/economy.ts gainMult).
 * The save holds what is owned (`trails`, `auras`) and what is on (`trail`, `aura`). Pure TS.
 */
import type { CosmeticItem, SkinsJson } from '../content/types.ts';

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

// Skins and wings (docs/01-gdd.md 7.4; docs/01a-content.md 8, M3-04b): looks only, never a number of the game.
// Sources: the default one, trophies (bought in the wardrobe), a calendar day, a rebirth tier, the starter pack;
// the last three are granted by their own features (M3-08, M3-06, the shop) through grantLook.

export type LookKind = 'skin' | 'wings';
export type LookItem = { id: string; unlock: SkinsJson['skins'][number]['unlock'] };

/** The part of the save looks live in. */
export interface LookBag {
  trophies?: number;
  skins?: string[];
  skin?: string;
  wings?: string[];
  wing?: string;
}

const lookList = (kind: LookKind): 'skins' | 'wings' => (kind === 'skin' ? 'skins' : 'wings');

/** Owned looks in the order of the data: the default ones and those in the save. */
export function ownedLooks(bag: LookBag, kind: LookKind, items: readonly LookItem[]): string[] {
  const have = bag[lookList(kind)] ?? [];
  return items.filter((x) => x.unlock.kind === 'default' || have.includes(x.id)).map((x) => x.id);
}

/** Price in trophies, or null when the look comes from another source. */
export function lookPrice(item: LookItem): number | null {
  return item.unlock.kind === 'trophies' && typeof item.unlock.value === 'number' ? item.unlock.value : null;
}

/** Look on: the skin (null — the default of the data) or the wings (null — none). */
export function lookOn(bag: LookBag, kind: LookKind): string | null {
  return (kind === 'skin' ? bag.skin : bag.wing) ?? null;
}

/** Gives a look from any source (calendar, tier, starter pack); false when unknown or already owned. */
export function grantLook(bag: LookBag, kind: LookKind, items: readonly LookItem[], id: string): boolean {
  if (!items.some((x) => x.id === id) || ownedLooks(bag, kind, items).includes(id)) return false;
  bag[lookList(kind)] = [...(bag[lookList(kind)] ?? []), id];
  return true;
}

/** Buys a look for its trophies and puts it on; false — not for trophies, owned, unknown or short. */
export function buyLook(bag: LookBag, kind: LookKind, items: readonly LookItem[], id: string): boolean {
  const item = items.find((x) => x.id === id);
  const price = item ? lookPrice(item) : null;
  if (!item || price === null || ownedLooks(bag, kind, items).includes(id) || (bag.trophies ?? 0) < price) return false;
  bag.trophies = (bag.trophies ?? 0) - price;
  grantLook(bag, kind, items, id);
  return equipLook(bag, kind, items, id);
}

/** Puts an owned look on. */
export function equipLook(bag: LookBag, kind: LookKind, items: readonly LookItem[], id: string): boolean {
  if (!ownedLooks(bag, kind, items).includes(id)) return false;
  if (kind === 'skin') bag.skin = id;
  else bag.wing = id;
  return true;
}
