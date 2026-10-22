// What: Trophy counters of the save (to spend and all-time) and the leaderboard score taken from them.
// Called by: main.ts, app/rewards.ts, level/validate.ts; tests/ui/numbers.test.ts.
// Keep: Pure TS; both counters stay whole numbers capped at 2^53-1; only whole counters (LEADERBOARD_SCORES) may score, never the stat; amounts come from sim/economy.ts.

/**
 * Trophies (docs/01-gdd.md 7.9, 8.1, 8.4): a summit gives g × (1 + n) (src/sim/economy.ts, from balance.json). Two
 * counters in the save: `trophies` to spend and `trophiesTotal` earned over all time. The leaderboard goes by the
 * total — a whole number under 2^53 (Speed on late tiers comes close to it, docs/01-gdd.md 8.4). Pure TS.
 */
import type { SaveData } from './save.ts';
import type { WorldsJson } from '../content/types.ts';

/** Adds `n` trophies of a summit to both counters; the all-time one never passes Number.MAX_SAFE_INTEGER. */
export function addTrophies(save: Pick<SaveData, 'trophies' | 'trophiesTotal'>, n: number): void {
  const add = Math.max(0, Math.floor(n));
  save.trophies = Math.min(Number.MAX_SAFE_INTEGER, (save.trophies ?? 0) + add);
  save.trophiesTotal = Math.min(Number.MAX_SAFE_INTEGER, (save.trophiesTotal ?? 0) + add);
}

/** M4-07 (docs/01-gdd.md 9.3): trophies of the starter pack — to spend only, never to the all-time counter (the records). */
export function addSpendableTrophies(save: Pick<SaveData, 'trophies'>, n: number): void {
  save.trophies = Math.min(Number.MAX_SAFE_INTEGER, (save.trophies ?? 0) + Math.max(0, Math.floor(n)));
}

/** Save fields a leaderboard may score by (game.json leaderboard.score): whole counters only, never the stat. */
export const LEADERBOARD_SCORES = ['trophiesTotal'] as const;

/** The score to send (game.json leaderboard.score): a whole number from 0 to 2^53 − 1. */
export function leaderboardScore(save: Pick<SaveData, 'trophiesTotal'>, field: string): number {
  if (!(LEADERBOARD_SCORES as readonly string[]).includes(field)) return 0;
  const v = save.trophiesTotal ?? 0;
  return Number.isFinite(v) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(v))) : 0;
}

/**
 * SD-03 (docs/01-gdd.md 23.3): once, a save from before the stage trophies — the coins it had (shown as trophies, Q-076)
 * stay coins, and the stages already passed (stageBest of each mountain) bring their trophies now. Marked in flags, so a
 * second call adds nothing. Returns the trophies added.
 */
export function migrateStageTrophies(save: Pick<SaveData, 'trophies' | 'stageBest' | 'flags'>, worlds: Pick<WorldsJson, 'worlds'>): number {
  const flags = (save.flags ??= {});
  if (flags['stageTrophies']) return 0;
  flags['stageTrophies'] = true;
  let add = 0;
  for (const w of worlds.worlds) {
    const best = save.stageBest?.[String(w.index)] ?? 0;
    // The farthest stage reached: those below it are passed (their buttons were on the way).
    for (const st of w.stages ?? []) if (st.n < best) add += Math.max(0, st.trophies);
  }
  save.trophies = Math.min(Number.MAX_SAFE_INTEGER, (save.trophies ?? 0) + add);
  return add;
}

/** SD-11 (Q-088): the coins of a stage-button trophy when they go back to coins (the SD-03 rate). */
export const STAGE_TROPHY_COINS = 7;

/**
 * SD-11 (docs/01-gdd.md 23.3, Q-088): once, a save of the SD-03 build — the trophies of the stage buttons (to spend, over
 * the all-time trophies of summits: buttons never added to that count) go back to coins at STAGE_TROPHY_COINS each.
 * Summit trophies stay; a save that never ran that build (no flag stageTrophies) is left as it is. Marked in flags; returns the coins added.
 */
export function migrateStageTrophiesBack(save: Pick<SaveData, 'trophies' | 'trophiesTotal' | 'coins' | 'flags'>): number {
  const flags = (save.flags ??= {});
  if (flags['stageTrophiesBack']) return 0;
  flags['stageTrophiesBack'] = true;
  // Only a save that ran the SD-03 build (its migration flag): other spendable-only trophies (the starter pack) stay.
  if (!flags['stageTrophies']) return 0;
  const extra = Math.max(0, Math.floor((save.trophies ?? 0) - (save.trophiesTotal ?? 0)));
  if (extra === 0) return 0;
  save.trophies = (save.trophies ?? 0) - extra;
  const coins = extra * STAGE_TROPHY_COINS;
  save.coins = Math.min(Number.MAX_SAFE_INTEGER, (save.coins ?? 0) + coins);
  return coins;
}
