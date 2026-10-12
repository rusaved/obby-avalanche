// What: When the desktop shortcut button may be there (docs/01-gdd.md 19.10; 03 SDK-08): config on, on the base, from its summit, due by the summit group, never rewarded, not declined this session.
// Called by: main.ts (shortcutItem, before asking the platform); tests/meta/shortcut.test.ts.
// Keep: Pure, no DOM and no platform call: false here means no shortcut call at all (enabled false — none ever).

import type { GameJson } from '../content/types.ts';

export interface ShortcutState {
  cfg: GameJson['shortcut'] | null | undefined;
  onBase: boolean;
  /** Its reward was given (the save flag): never again. */
  done: boolean;
  /** Declined this session. */
  off: boolean;
  /** Due by the summit group of the HUD (balance ui.summitGroup `shortcut`). */
  due: boolean;
  tier: number;
  /** Summits done on this tier. */
  summits: number;
}

export function shortcutWanted(s: ShortcutState): boolean {
  if (!s.cfg?.enabled || s.done || s.off || !s.due) return false;
  if (s.cfg.place === 'base' && !s.onBase) return false;
  return s.tier > 0 || s.summits >= s.cfg.fromSummit;
}
