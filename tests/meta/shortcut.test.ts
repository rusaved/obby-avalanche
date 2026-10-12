import { describe, expect, it } from 'vitest';
import { shortcutWanted, type ShortcutState } from '../../src/meta/shortcut.ts';
import game from '../../content/avalanche/game.json' with { type: 'json' };
import type { GameJson } from '../../src/content/types.ts';

// FM-13 (docs/01-gdd.md 19.10; 03 SDK-08): the desktop shortcut button — on the base from summit 2, once in a life.
const cfg = (game as unknown as GameJson).shortcut!;
const S = (o: Partial<ShortcutState> = {}): ShortcutState => ({ cfg, onBase: true, done: false, off: false, due: true, tier: 0, summits: 2, ...o });

describe('desktop shortcut (FM-13)', () => {
  it('game.json: on, 5 spendable trophies, from summit 2, on the base', () => {
    expect(cfg).toEqual({ enabled: true, reward: { trophies: 5 }, fromSummit: 2, place: 'base' });
  });

  it('wanted on the base from summit 2 while due; not on a mountain, not before, not after the reward or a «no»', () => {
    expect(shortcutWanted(S())).toBe(true);
    expect(shortcutWanted(S({ summits: 1 }))).toBe(false);
    expect(shortcutWanted(S({ onBase: false }))).toBe(false);
    expect(shortcutWanted(S({ due: false }))).toBe(false);
    expect(shortcutWanted(S({ done: true }))).toBe(false);
    expect(shortcutWanted(S({ off: true }))).toBe(false);
    expect(shortcutWanted(S({ tier: 1, summits: 0 }))).toBe(true);
  });

  it('enabled false or no config: never (so no shortcut call at all)', () => {
    expect(shortcutWanted(S({ cfg: { ...cfg, enabled: false } }))).toBe(false);
    expect(shortcutWanted(S({ cfg: undefined }))).toBe(false);
  });
});
