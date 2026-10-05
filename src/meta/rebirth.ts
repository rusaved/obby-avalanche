/**
 * Rebirth (docs/01-gdd.md 7.5, 8.4; GDD-08): open once the summit of the mountain of `balance.rebirth.unlock` is done on
 * the current tier. A rebirth resets the stat, the coins, the shoes and the mountains (back to the camp of mountain 1),
 * and keeps everything else of the save: pets, skins, wings, trails, auras, trophies, the calendar and the quests.
 * The step grows × `rebirth.stepMult` per tier for ever; the looks of the new tier (skins.json `unlock.kind: "tier"`)
 * are granted. Pure TS: the caller builds the new simulation from `RebirthResult`.
 */
import type { BalanceJson, SkinsJson } from '../content/types.ts';
import type { SaveData } from './save.ts';
import { equipLook, grantLook, type LookItem, type LookKind } from './cosmetics.ts';
import { SHOES_AFTER_REBIRTH } from './shoes.ts';

/** A look the tier gives: a skin or wings of skins.json. */
export interface TierReward {
  kind: LookKind;
  id: string;
}

/** What the rebirth window shows before the button (docs/01-gdd.md 7.5): the next tier, the step now and after, the rewards. */
export interface RebirthPreview {
  tier: number;
  stepNow: number;
  stepNext: number;
  rewards: TierReward[];
}

/** Where the new cycle starts: mountain 1, its camp, the stat and the coins at zero, the new tier. */
export interface RebirthResult {
  tier: number;
  world: number;
  stat: number;
  coins: number;
  rewards: TierReward[];
}

type RebirthBalance = Pick<BalanceJson, 'rebirth'>;

/** Mountain whose summit opens the rebirth: `rebirth.unlock` «summitWorldN» (N = 5 in game 1, 1 in the sample pack). */
export function rebirthGoal(balance: RebirthBalance): number {
  const m = /^summitWorld(\d+)$/.exec(balance.rebirth.unlock);
  if (!m) throw new Error(`balance.json: rebirth.unlock "${balance.rebirth.unlock}" — expected summitWorldN`);
  return Number(m[1]);
}

/** Summits done on the current tier (the highest mountain whose portal the hero walked into). */
export function summitsDone(save: Pick<SaveData, 'summits'>): number {
  return save.summits ?? 0;
}

/** The summit portal of mountain `world` entered: counts towards «Mountain {a}/5». */
export function markSummit(save: Pick<SaveData, 'summits'>, world: number): void {
  save.summits = Math.max(summitsDone(save), world);
}

export function rebirthReady(save: Pick<SaveData, 'summits'>, balance: RebirthBalance): boolean {
  return summitsDone(save) >= rebirthGoal(balance);
}

/** Looks of tier `tier` (skins first, then wings, in the order of the data). */
export function tierRewards(skins: SkinsJson, tier: number): TierReward[] {
  const of = (kind: LookKind, list: readonly LookItem[]): TierReward[] =>
    list.filter((x) => x.unlock.kind === 'tier' && x.unlock.value === tier).map((x) => ({ kind, id: x.id }));
  return [...of('skin', skins.skins), ...of('wings', skins.wings ?? [])];
}

export function rebirthPreview(balance: RebirthBalance, skins: SkinsJson, tier: number): RebirthPreview {
  const step = balance.rebirth.stepMult;
  return { tier: tier + 1, stepNow: Math.pow(step, tier), stepNext: Math.pow(step, tier + 1), rewards: tierRewards(skins, tier + 1) };
}

/**
 * The rebirth itself on the save: tier + 1, the starting shoes, no summits on the new tier, the looks of the tier
 * granted and put on. Nothing else of the save changes. Throws nothing; false-y checks are the caller's (rebirthReady).
 */
export function applyRebirth(save: SaveData, balance: RebirthBalance, skins: SkinsJson): RebirthResult {
  const tier = (save.tier ?? 0) + 1;
  save.tier = tier;
  save.shoes = SHOES_AFTER_REBIRTH;
  save.summits = 0;
  const rewards = tierRewards(skins, tier);
  for (const r of rewards) {
    const items = r.kind === 'skin' ? skins.skins : (skins.wings ?? []);
    if (grantLook(save, r.kind, items, r.id)) equipLook(save, r.kind, items, r.id);
  }
  return { tier, world: 1, stat: 0, coins: 0, rewards };
}
