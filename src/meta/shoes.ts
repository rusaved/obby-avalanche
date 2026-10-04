/**
 * Shoes and the step multiplier of the meta (docs/01-gdd.md 7.1, 8.1; docs/01a-content.md 5): the next pair only,
 * price × wallScale[tier], one tap buys. The basic button arrives with the first minute (M2-08: «Runners ×2 · 30»
 * at 22–32 s); the full shop and the rebirth reset — M3-02. Pure TS.
 */
import type { BalanceJson, PetsJson } from '../content/types.ts';
import { wallScale } from '../sim/gates.ts';

export type ShoeTier = BalanceJson['upgrade']['tiers'][number];

/** The pair after `level`, or null when the best pair is on. */
export function nextShoes(tiers: readonly ShoeTier[], level: number): ShoeTier | null {
  return tiers[level + 1] ?? null;
}

export function shoesPrice(tier: ShoeTier, rebirthTier: number, rebirth: BalanceJson['rebirth']): number {
  return tier.price * wallScale(rebirthTier, rebirth);
}

/** Pet multiplier: 1 + the bonuses of the best `slots` pets (docs/01a-content.md 6). */
export function petMult(owned: readonly string[], pets: PetsJson, slots: number): number {
  const bonuses = owned
    .map((id) => pets.pets.find((p) => p.id === id)?.bonus ?? 0)
    .sort((a, b) => b - a)
    .slice(0, slots);
  return 1 + bonuses.reduce((a, b) => a + b, 0);
}

/** Step multiplier of the meta: shoes × pets (trails, auras, boosts join at M3–M4). */
export function gainMult(tiers: readonly ShoeTier[], shoeLevel: number, owned: readonly string[], pets: PetsJson, slots: number): number {
  return (tiers[shoeLevel]?.mult ?? 1) * petMult(owned, pets, slots);
}
