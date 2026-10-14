// What: Gifts that stay taken (docs/01-gdd.md 21.8, balance.gifts.respawn "never"): the taken ones of the mountain in the save, back after F5; a new entry (a portal, the rebirth) starts it clean.
// Called by: main.ts (the boot sim, giftTake, enterWorld); tests/meta/kept-gifts.test.ts.
// Keep: Pure, no DOM: only `save.gifts` changes; indices are those of sim.gifts (the order of LevelData points) — a mountain rebuilt from other data drops what it does not have.

import type { SaveData } from './save.ts';

/** The taken gifts of mountain `world` kept in the save, within `count` gifts; none for another mountain. */
export function keptGifts(save: SaveData, world: number, count: number): number[] {
  const g = save.gifts;
  if (!g || g.world !== world || !Array.isArray(g.taken)) return [];
  return g.taken.filter((i) => Number.isInteger(i) && i >= 0 && i < count);
}

/** A gift taken on mountain `world`: kept (a gift list of another mountain is replaced). */
export function keepGift(save: SaveData, world: number, index: number): void {
  if (save.gifts?.world !== world || !Array.isArray(save.gifts.taken)) save.gifts = { world, taken: [] };
  if (!save.gifts.taken.includes(index)) save.gifts.taken.push(index);
}

/** A new entry on mountain `world` (a portal, the rebirth): all its gifts back. */
export function freshGifts(save: SaveData, world: number): void {
  save.gifts = { world, taken: [] };
}
