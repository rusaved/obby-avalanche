/**
 * Gifts by zone rarity (docs/01-gdd.md 3.2, 5.2; docs/01a-content.md 4): a touch gives the coins of the gift's zone
 * × wallScale[tier] and the gift disappears; after every avalanche (`balance.gifts.respawn: "onWaveGone"`) all gifts
 * are back in place. Pure TS, no DOM.
 */
import type { LevelData } from '../level/types.ts';
import { HERO_HEIGHT, HERO_RADIUS } from './controller.ts';

/** Gift box: 1.6 units wide and tall, standing on the ground or on its ledge. */
export const GIFT_HALF = 0.8;
export const GIFT_HEIGHT = 1.6;

export interface Gift {
  x: number;
  y: number;
  z: number;
  zone: number;
  rarity: string;
  /** Coins of the zone on tier 0 (docs/01a-content.md 4). */
  coins: number;
  taken: boolean;
}

/** Gifts in the order of `level.points` (the renderer uses the same order for its instances). */
export function giftsFromLevel(level: LevelData): Gift[] {
  return level.points
    .filter((p) => p.type === 'gift')
    .map((p) => ({
      x: p.x,
      y: p.y,
      z: p.z,
      zone: typeof p['zone'] === 'number' ? (p['zone'] as number) : 0,
      rarity: typeof p['rarity'] === 'string' ? (p['rarity'] as string) : 'common',
      coins: typeof p['coins'] === 'number' ? (p['coins'] as number) : 0,
      taken: false,
    }));
}

/** The hero capsule (feet at `y`) touches the gift box. */
export function touchesGift(g: Gift, x: number, y: number, z: number): boolean {
  const dx = Math.max(0, Math.abs(x - g.x) - GIFT_HALF);
  const dz = Math.max(0, Math.abs(z - g.z) - GIFT_HALF);
  if (dx * dx + dz * dz > HERO_RADIUS * HERO_RADIUS) return false;
  return y < g.y + GIFT_HEIGHT && y + HERO_HEIGHT > g.y;
}
