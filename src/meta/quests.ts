/**
 * Quests of the day, time rewards and the free spin of the wheel (docs/01-gdd.md 7.7, 7.8, 7.13; docs/01a-content.md 10).
 * All three belong to the game day of the calendar (meta/daily.ts: `save.daily.dayStart`) and refresh with it by the
 * 20-hour rule. Quests: `perDay` different ones of the list, picked by the day's seed; q_gold only while the golden gift
 * is in the game, q_shoes and q_summit not when they are far. Time rewards: minutes of play today, kept in the save.
 * Pure, runs in Node.
 */
import type { BalanceJson } from '../content/types.ts';
import type { SaveData } from './save.ts';
import { createRng } from '../core/rng.ts';

type QuestSave = Pick<SaveData, 'quests' | 'timeRw' | 'wheel' | 'daily'>;

/** What the pick needs to know about the player now. */
export interface QuestContext {
  /** game.json threat.bonus is there (docs/01-gdd.md 4.9). */
  gold: boolean;
  /** The next shoes and the summit are farther than `farWalls` walls. */
  shoesFar: boolean;
  summitFar: boolean;
}

/** The game day the quests and time rewards belong to. */
export function gameDay(save: QuestSave): number {
  return save.daily?.dayStart ?? 0;
}

/** Quests that may come today. */
export function questPool(quests: BalanceJson['quests'], ctx: QuestContext): BalanceJson['quests']['list'] {
  return quests.list.filter((q) => {
    if (q.id === 'q_gold') return ctx.gold;
    if (q.id === 'q_shoes') return !ctx.shoesFar;
    if (q.id === 'q_summit') return !ctx.summitFar;
    return true;
  });
}

/** `perDay` different quests of the pool for the seed (a partial Fisher–Yates shuffle). */
export function pickQuests(quests: BalanceJson['quests'], ctx: QuestContext, seed: number): Array<{ id: string; n: number }> {
  const pool = [...questPool(quests, ctx)];
  const rng = createRng(seed >>> 0);
  const out: Array<{ id: string; n: number }> = [];
  for (let i = 0; i < quests.perDay && pool.length > 0; i++) {
    const j = Math.floor(rng.next() * pool.length);
    const [q] = pool.splice(j, 1);
    out.push({ id: q!.id, n: q!.n });
  }
  return out;
}

/** New quests, time rewards and wheel when the game day changed (or there were none); true — refreshed. */
export function refreshDay(save: QuestSave, quests: BalanceJson['quests'], ctx: QuestContext): boolean {
  const day = gameDay(save);
  let changed = false;
  if (save.quests?.day !== day) {
    // The seed of the day: its start time folded into 32 bits.
    const seed = (Math.floor(day / 1000) ^ 0x51ed27) >>> 0;
    save.quests = { day, list: pickQuests(quests, ctx, seed).map((q) => ({ ...q, k: 0, got: false })), bonus: false };
    changed = true;
  }
  if (save.timeRw?.day !== day) {
    save.timeRw = { day, sec: 0, got: [] };
    changed = true;
  }
  return changed;
}

/** Progress of quest `id` today; true when it has just become done. */
export function questProgress(save: QuestSave, id: string, amount: number): boolean {
  const q = save.quests?.list.find((x) => x.id === id);
  if (!q || q.k >= q.n) return false;
  q.k = Math.min(q.n, q.k + amount);
  return q.k >= q.n;
}

export function questDone(q: { k: number; n: number }): boolean {
  return q.k >= q.n;
}

export function claimQuest(save: QuestSave, index: number): boolean {
  const q = save.quests?.list[index];
  if (!q || q.got || !questDone(q)) return false;
  q.got = true;
  return true;
}

export function bonusReady(save: QuestSave): boolean {
  const list = save.quests?.list ?? [];
  return list.length > 0 && !save.quests!.bonus && list.every((q) => q.got);
}

export function claimBonus(save: QuestSave): boolean {
  if (!bonusReady(save)) return false;
  save.quests!.bonus = true;
  return true;
}

/** Something waits for «Claim» in the quests window. */
export function questsToClaim(save: QuestSave): boolean {
  return (save.quests?.list ?? []).some((q) => !q.got && questDone(q)) || bonusReady(save);
}

/** Play seconds today (time rewards). */
export function addPlayToday(save: QuestSave, sec: number): void {
  if (save.timeRw) save.timeRw.sec += sec;
}

export function timeRewardReady(save: QuestSave, list: BalanceJson['timeRewards'], i: number): boolean {
  const tr = save.timeRw;
  const item = list[i];
  return !!tr && !!item && !tr.got.includes(i) && tr.sec >= item.min * 60;
}

export function claimTimeReward(save: QuestSave, list: BalanceJson['timeRewards'], i: number): boolean {
  if (!timeRewardReady(save, list, i)) return false;
  save.timeRw!.got.push(i);
  return true;
}

/** Seconds to the next time reward not yet reached; null — all reached today. */
export function nextTimeRewardSec(save: QuestSave, list: BalanceJson['timeRewards']): number | null {
  const sec = save.timeRw?.sec ?? 0;
  const left = list.map((x) => x.min * 60 - sec).filter((x) => x > 0);
  return left.length ? Math.min(...left) : null;
}

export function anyTimeRewardReady(save: QuestSave, list: BalanceJson['timeRewards']): boolean {
  return list.some((_, i) => timeRewardReady(save, list, i));
}

/** The free spin of the wheel: one per game day. */
export function freeSpinReady(save: QuestSave): boolean {
  return save.wheel?.day !== gameDay(save);
}

/** Takes the free spin: the sector index for the roll `r` in [0, 1); null when today's spin is used. */
export function spinFree(save: QuestSave, sectors: number, r: number): number | null {
  if (!freeSpinReady(save)) return null;
  save.wheel = { day: gameDay(save) };
  return Math.min(sectors - 1, Math.floor(r * sectors));
}
