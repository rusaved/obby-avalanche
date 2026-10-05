/**
 * The game day and the 7-day calendar (docs/01-gdd.md 7.6; docs/02-tech.md 11.8; GDD-10). Server time only. A new game
 * day starts `daily.resetHours` after the last calendar claim (not at midnight); a player who has not claimed today gets
 * a new day `resetHours` after the start of this one, so quests and time rewards still refresh. A skipped day never
 * breaks the series: the counter only goes forward; after day 7 the circle repeats and things the player already has
 * turn into trophies (`alt`, docs/01a-content.md 10). Pure, runs in Node.
 */
import type { BalanceJson, DailyReward } from '../content/types.ts';
import type { SaveData } from './save.ts';

export const HOUR_MS = 3_600_000;

type DailySave = Pick<SaveData, 'daily'>;

function state(save: DailySave, now: number): NonNullable<SaveData['daily']> {
  return (save.daily ??= { n: 0, last: 0, dayStart: now });
}

/** The reward of today is already taken. */
export function claimedToday(save: DailySave): boolean {
  const d = save.daily;
  return !!d && d.n > 0 && d.last >= d.dayStart;
}

/** When the next game day starts (server ms). */
export function nextDayAt(save: DailySave, now: number, resetHours: number): number {
  const d = state(save, now);
  return (claimedToday(save) ? d.last : d.dayStart) + resetHours * HOUR_MS;
}

/** Moves the game day forward when its time has come; true — a new day started (quests and time rewards refresh). */
export function rollDay(save: DailySave, now: number, resetHours: number): boolean {
  const d = state(save, now);
  if (now < nextDayAt(save, now, resetHours)) return false;
  d.dayStart = now;
  return true;
}

export function canClaimDaily(save: DailySave): boolean {
  return !claimedToday(save);
}

/** Index 0…6 of the card to claim next (or of today's card once claimed: `today`). */
export function dailyIndex(save: DailySave, days: number, today = false): number {
  const n = save.daily?.n ?? 0;
  return ((today && claimedToday(save) ? n - 1 : n) % days + days) % days;
}

/**
 * The reward of card `index` for the claim number `n` (0-based over all time): from the second circle on, a day whose
 * look the player already owns gives its `alt` (trophies) instead.
 */
export function dailyReward(daily: BalanceJson['daily'], index: number, owns: (r: DailyReward) => boolean, circle: number): { reward: DailyReward; alt: boolean } {
  const day = daily.days[index]!;
  if (day.alt && circle > 0 && owns(day)) return { reward: day.alt, alt: true };
  return { reward: day, alt: false };
}

/** Takes today's reward: the counter +1, the time of the claim. Returns the day number 1…7 or null when not today. */
export function claimDaily(save: DailySave, now: number, days: number): { day: number; index: number; circle: number } | null {
  if (!canClaimDaily(save)) return null;
  const d = state(save, now);
  const index = dailyIndex(save, days);
  const circle = Math.floor(d.n / days);
  d.n += 1;
  d.last = Math.max(now, d.dayStart);
  return { day: index + 1, index, circle };
}
