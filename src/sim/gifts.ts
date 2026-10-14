// What: Gifts by zone rarity: builds the gift list from level points, touch test (a gift in the air: its flight column too), coins of the zone; all gifts return after each avalanche unless balance.gifts.respawn is "never".
// Called by: sim/world.ts, sim/bonus.ts, level/generate.ts, level/validate.ts, render/level-mesh.ts
// Keep: GIFT_HALF and GIFT_HEIGHT are shared by generator, validator, golden gift and mesh; gift order follows level.points (renderer instances rely on it); pure TS.

/**
 * Gifts by zone rarity (docs/01-gdd.md 3.2, 5.2; docs/01a-content.md 4): a touch gives the coins of the gift's zone
 * × wallScale[tier] and the gift disappears; after every avalanche (`balance.gifts.respawn: "onWaveGone"`) all gifts
 * are back in place, with `"never"` only a new visit of the mountain puts them back (Q-068). Pure TS, no DOM.
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
  /** On the path (docs/01-gdd.md 16.4): taken on the run, a note higher each; absent — false. */
  path?: boolean;
  /** In the air over a trampoline (Q-068): also taken with the feet anywhere in this band [lowest, highest]. */
  col?: [number, number];
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
      path: p['path'] === true,
      ...(Array.isArray(p['col']) ? { col: p['col'] as [number, number] } : {}),
    }));
}

/** The hero capsule (feet at `y`) touches the gift box, or a gift in the air in its flight column. */
export function touchesGift(g: Gift, x: number, y: number, z: number): boolean {
  const dx = Math.max(0, Math.abs(x - g.x) - GIFT_HALF);
  const dz = Math.max(0, Math.abs(z - g.z) - GIFT_HALF);
  if (dx * dx + dz * dz > HERO_RADIUS * HERO_RADIUS) return false;
  if (g.col && y >= g.col[0] && y <= g.col[1]) return true;
  return y < g.y + GIFT_HEIGHT && y + HERO_HEIGHT > g.y;
}
