// What: Calendar button and window: shows the waiting reward or the timer, claims it through rewards.ts and rolls the game day by server time.
// Called by: main.ts (createDailyView); app/handles.ts (type); app/quests-view.ts (REWARD_ICON).
// Keep: The window never opens by itself; day math lives in meta/daily.ts and uses d.now() (server time); claim sends daily_claim (docs/06-analytics.md).

/**
 * The calendar in the game (docs/01-gdd.md 7.6; GDD-10): the «Calendar» button of the HUD column from 3:00 of play with
 * «!» while today's reward waits, otherwise the timer «in 14:20» to the next one; the window never opens by itself.
 * «Claim» gives the reward (app/rewards.ts), sends `daily_claim` with the day and shows «Tomorrow: …» under the toast.
 * The game day rolls by server time (meta/daily.ts): a new day refreshes the quests and time rewards (`onNewDay`).
 */
import type { BalanceJson, Reward } from '../content/types.ts';
import type { SaveData } from '../meta/save.ts';
import type { Hud, MenuItem } from '../ui/hud.ts';
import type { WindowFrame } from '../ui/window.ts';
import type { Rewards } from './rewards.ts';
import { canClaimDaily, claimDaily, claimedToday, dailyIndex, dailyReward, nextDayAt, rollDay } from '../meta/daily.ts';
import { renderDailyPanel, type DailyCard } from '../ui/daily-panel.ts';
import { formatNumber, formatTimer } from '../ui/format.ts';
import { t } from '../ui/i18n.ts';

export interface DailyViewDeps {
  balance: BalanceJson;
  save: SaveData;
  hud: Hud;
  windows: WindowFrame;
  rewards: Rewards;
  now(): number;
  track(name: string, params?: Record<string, unknown>): void;
  persist(flush?: boolean): void;
  /** A new game day began (quests and time rewards of M3-08b refresh). */
  onNewDay?(): void;
  numSuffix(k: string): string;
  /** M4-R4: what else day `day` (1…7) of the first circle brings besides its reward (a set of steps), or null. */
  dayExtra?(day: number): string | null;
}

export interface DailyView {
  readonly canClaim: boolean;
  /** Seconds to the next game day. */
  readonly nextSec: number;
  /** Rolls the game day by server time: call every frame, it reads the clock about once a second (`force` — now). */
  tick(force?: boolean): void;
  openWindow(): void;
  /** `from` — where it was claimed, for daily_claim: `window` (the calendar, default) or `base` (the gift box, 19.3). */
  claim(from?: string): boolean;
  menuItem(): MenuItem | null;
  /** Name of a calendar card (index 0…6) for the claim number of the given circle. */
  cardName(index: number, circle: number): string;
  /** The reward of the next game day while the first circle lasts («Tomorrow in the calendar», docs/01-gdd.md 10.2), else null. */
  tomorrow(): { name: string; icon: string } | null;
}

export const REWARD_ICON: Record<Reward['kind'], string> = {
  coins: 'coins',
  trophies: 'trophy',
  boost: 'iceBolt',
  egg: 'gift',
  skin: 'wardrobe',
  wings: 'wardrobe',
  pet: 'pets',
};

export function createDailyView(d: DailyViewDeps): DailyView {
  const daily = d.balance.daily;
  const days = daily.days.length;
  const reset = daily.resetHours;
  const circle = (): number => Math.floor((d.save.daily?.n ?? 0) / days);
  const pick = (index: number, c: number) => dailyReward(daily, index, (r) => d.rewards.owns(r), c);

  const cards = (): DailyCard[] => {
    const today = dailyIndex(d.save, days, true);
    const taken = claimedToday(d.save);
    // The circle the cards show: the one of today's card.
    const c = Math.floor(((d.save.daily?.n ?? 0) - (taken ? 1 : 0)) / days);
    return daily.days.map((_, i) => {
      const { reward } = pick(i, c);
      return {
        day: t('daily.day', { n: i + 1 }),
        name: view.cardName(i, c),
        ...(c === 0 && d.dayExtra?.(i + 1) ? { extra: d.dayExtra(i + 1)! } : {}),
        icon: REWARD_ICON[reward.kind],
        state: i < today || (i === today && taken) ? 'past' : i === today ? 'today' : 'future',
      };
    });
  };

  const render = (body: HTMLElement): void =>
    renderDailyPanel(
      body,
      {
        cards: cards(),
        claim: view.canClaim ? t('btn.claim') : null,
        next: view.canClaim ? null : t('daily.next', { time: formatTimer(view.nextSec) }),
      },
      () => void view.claim(),
    );

  let shownTimer = '';
  // Server time read about once a second, not every frame (the timers show whole seconds).
  let clock = d.now();
  let lastTick = -Infinity;
  const view: DailyView = {
    get canClaim() {
      return canClaimDaily(d.save);
    },
    get nextSec() {
      return Math.max(0, (nextDayAt(d.save, clock, reset) - clock) / 1000);
    },
    tick(force = false) {
      const p = performance.now();
      if (!force && p - lastTick < 1000) return;
      lastTick = p;
      clock = d.now();
      if (rollDay(d.save, clock, reset)) {
        d.onNewDay?.();
        d.persist(true);
        d.windows.refresh();
      }
      // The window's timer moves once a second.
      if (d.windows.current === 'daily' && !view.canClaim) {
        const text = formatTimer(view.nextSec);
        if (text !== shownTimer) {
          shownTimer = text;
          d.windows.refresh();
        }
      }
    },
    cardName(index, c) {
      const { alt, reward } = pick(index, c);
      // M4-R4: the coins of a day with their number.
      // G-04: the same sum on any stage of the mountain.
      const n = reward.kind === 'coins' ? formatNumber(d.rewards.coinsOf(reward.gifts, true), d.numSuffix) : undefined;
      return t(alt ? `daily.r${index + 1}alt` : `daily.r${index + 1}`, n !== undefined ? { n } : undefined);
    },
    openWindow() {
      d.windows.open('daily', t('daily.title'), render);
    },
    tomorrow() {
      // Today's reward still waits: tomorrow brings the one after it.
      const k = (d.save.daily?.n ?? 0) + (claimedToday(d.save) ? 0 : 1);
      if (k >= days) return null;
      return { name: view.cardName(k, 0), icon: REWARD_ICON[pick(k, 0).reward.kind] };
    },
    claim(from = 'window') {
      const c = circle();
      clock = d.now();
      const got = claimDaily(d.save, clock, days);
      if (!got) return false;
      d.rewards.give(pick(got.index, c).reward, true);
      d.track('daily_claim', { day: got.day, from });
      // «Tomorrow: …» — the next card (docs/01-gdd.md 7.6: the reward of tomorrow is seen in the first session).
      const next = (got.index + 1) % days;
      d.hud.toast(t('toast.reward'), 3, false, t('toast.tomorrow', { name: view.cardName(next, Math.floor(d.save.daily!.n / days)) }));
      d.persist(true);
      d.windows.refresh();
      return true;
    },
    menuItem() {
      if ((d.save.totalPlaySec ?? 0) < d.balance.ui.unlockMenusSec) return null;
      return { id: 'daily', label: t('btn.daily'), icon: 'calendar', badge: view.canClaim ? '!' : t('daily.soon', { time: formatTimer(view.nextSec) }) };
    },
  };
  return view;
}
