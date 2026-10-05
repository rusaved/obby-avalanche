/**
 * Shoes and the step multiplier of the meta (docs/01-gdd.md 7.1, 8.1; docs/01a-content.md 5): the next pair only,
 * price × wallScale[tier], one tap buys. The basic button arrives with the first minute (M2-08: «Runners ×2 · 30»
 * at 22–32 s); the full shop and the rebirth reset — M3-02. Pure TS.
 */
import type { BalanceJson, PetsJson } from '../content/types.ts';
import { gainMult as stepMults, scaled, type GainMults } from '../sim/economy.ts';

export type ShoeTier = BalanceJson['upgrade']['tiers'][number];

/** The pair after `level`, or null when the best pair is on. */
export function nextShoes(tiers: readonly ShoeTier[], level: number): ShoeTier | null {
  return tiers[level + 1] ?? null;
}

export function shoesPrice(tier: ShoeTier, rebirthTier: number, rebirth: BalanceJson['rebirth']): number {
  return scaled(tier.price, rebirthTier, rebirth);
}

/** Pet multiplier: 1 + the bonuses of the best `slots` pets (docs/01a-content.md 6). */
export function petMult(owned: readonly string[], pets: PetsJson, slots: number): number {
  const bonuses = owned
    .map((id) => pets.pets.find((p) => p.id === id)?.bonus ?? 0)
    .sort((a, b) => b - a)
    .slice(0, slots);
  return 1 + bonuses.reduce((a, b) => a + b, 0);
}

/** What the player has on: rebirth tier, shoe level, pets owned; trail, aura, boost and VIP when they arrive (M3-04, M4). */
export interface MetaGain extends Omit<GainMults, 'shoe' | 'pets'> {
  shoeLevel: number;
  pets: readonly string[];
}

/** Step multiplier of the meta by docs/01-gdd.md 8.1 (src/sim/economy.ts): 3^n × shoes × pets × trail × aura × boost × vip. */
export function gainMult(balance: BalanceJson, pets: PetsJson, m: MetaGain): number {
  const { shoeLevel, pets: owned, ...rest } = m;
  return stepMults(balance, { ...rest, shoe: balance.upgrade.tiers[shoeLevel]?.mult ?? 1, pets: petMult(owned, pets, balance.pets.slots) });
}
