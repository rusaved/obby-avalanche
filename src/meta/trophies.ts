/**
 * Trophies (docs/01-gdd.md 7.9, 8.1, 8.4): a summit gives g × (1 + n) (src/sim/economy.ts, from balance.json). Two
 * counters in the save: `trophies` to spend and `trophiesTotal` earned over all time. The leaderboard goes by the
 * total — a whole number under 2^53 (Speed on late tiers comes close to it, docs/01-gdd.md 8.4). Pure TS.
 */
import type { SaveData } from './save.ts';

/** Adds `n` trophies of a summit to both counters; the all-time one never passes Number.MAX_SAFE_INTEGER. */
export function addTrophies(save: Pick<SaveData, 'trophies' | 'trophiesTotal'>, n: number): void {
  const add = Math.max(0, Math.floor(n));
  save.trophies = Math.min(Number.MAX_SAFE_INTEGER, (save.trophies ?? 0) + add);
  save.trophiesTotal = Math.min(Number.MAX_SAFE_INTEGER, (save.trophiesTotal ?? 0) + add);
}

/** Save fields a leaderboard may score by (game.json leaderboard.score): whole counters only, never the stat. */
export const LEADERBOARD_SCORES = ['trophiesTotal'] as const;

/** The score to send (game.json leaderboard.score): a whole number from 0 to 2^53 − 1. */
export function leaderboardScore(save: Pick<SaveData, 'trophiesTotal'>, field: string): number {
  if (!(LEADERBOARD_SCORES as readonly string[]).includes(field)) return 0;
  const v = save.trophiesTotal ?? 0;
  return Number.isFinite(v) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(v))) : 0;
}
