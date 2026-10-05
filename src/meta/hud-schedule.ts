/**
 * When the HUD elements come (docs/01-gdd.md 6.4; GDD-12), by the play time of the player (`totalPlaySec`) and the
 * progress, never earlier. «Shop», «Pets», «Calendar» from `ui.unlockMenusSec` one after another, `ui.menuStepSec`
 * apart; «Time rewards» and the shop tab «Special» (only with purchases on) from `ui.unlockTimeRewardsSec`; the trophy
 * plaque, «Wardrobe», «Quests», «Rebirth», «Records» after the first summit, one after another once the «Mountain
 * cleared» window is closed. Pure, runs in Node.
 */
import type { BalanceJson } from '../content/types.ts';

/** The first wave of buttons, in the order they come. */
export const TIME_GROUP = ['shop', 'pets', 'daily'] as const;
/** After the first summit, in the order they come (the records button only with the leaderboard, M4-06). */
export const SUMMIT_GROUP = ['trophies', 'wardrobe', 'quests', 'rebirth', 'records'] as const;

export interface HudScheduleState {
  /** Play seconds of the player over all sessions. */
  playSec: number;
  /** The first summit is behind (trophies over all time or a rebirth tier). */
  summit: boolean;
  /**
   * Play second when the «Mountain cleared» window of the first summit closed: the summit group comes from it;
   * Infinity — the window is still open; null — the summit was before this load (everything at once).
   */
  summitAt: number | null;
  /** Purchases on (game.json payments.enabled): the shop tab «Special». */
  payments: boolean;
}

/** Ids of the HUD elements due now: buttons of the right column, `trophies` (the plaque), `special` (the shop tab). */
export function hudDue(ui: BalanceJson['ui'], s: HudScheduleState): Set<string> {
  const due = new Set<string>();
  TIME_GROUP.forEach((id, i) => {
    if (s.playSec >= ui.unlockMenusSec + i * ui.menuStepSec) due.add(id);
  });
  if (s.playSec >= ui.unlockTimeRewardsSec) {
    due.add('timeRewards');
    if (s.payments) due.add('special');
  }
  if (s.summit) {
    const from = s.summitAt ?? -Infinity;
    SUMMIT_GROUP.forEach((id, i) => {
      if (s.playSec >= from + i * ui.menuStepSec) due.add(id);
    });
  }
  return due;
}
