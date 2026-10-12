import { describe, expect, it } from 'vitest';
import { hudDue, type HudScheduleState } from '../../src/meta/hud-schedule.ts';
import balanceJson from '../../content/avalanche/balance.json' with { type: 'json' };
import openBalance from '../../content/avalanche/pace/open/balance.json' with { type: 'json' };
import { mergePatch } from '../../src/content/pace.ts';
import type { BalanceJson } from '../../src/content/types.ts';

const ui = (balanceJson as BalanceJson).ui;
const due = (s: Partial<HudScheduleState>): string[] => [...hudDue(ui, { playSec: 0, summit: false, summitAt: null, payments: false, ...s })].sort();

// GDD-12 (docs/01-gdd.md 6.4): buttons by play time and progress, never earlier.
describe('HUD schedule', () => {
  it('shop, pets, calendar from 180 s, 2 s apart; time rewards from 300 s; nothing before', () => {
    const at = ui.unlockMenusSec;
    const step = ui.menuStepSec;
    expect(due({ playSec: at - 0.01 })).toEqual([]);
    expect(due({ playSec: at })).toEqual(['shop']);
    expect(due({ playSec: at + step - 0.01 })).toEqual(['shop']);
    expect(due({ playSec: at + step })).toEqual(['pets', 'shop']);
    expect(due({ playSec: at + 2 * step - 0.01 })).toEqual(['pets', 'shop']);
    expect(due({ playSec: at + 2 * step })).toEqual(['daily', 'pets', 'shop']);
    expect(due({ playSec: ui.unlockTimeRewardsSec - 0.01 })).toEqual(['daily', 'pets', 'shop']);
    expect(due({ playSec: ui.unlockTimeRewardsSec })).toEqual(['daily', 'pets', 'shop', 'timeRewards']);
  });

  it('«Special» only with purchases on, from 300 s', () => {
    expect(due({ playSec: 1000 })).not.toContain('special');
    expect(due({ playSec: ui.unlockTimeRewardsSec - 0.01, payments: true })).not.toContain('special');
    expect(due({ playSec: ui.unlockTimeRewardsSec, payments: true })).toContain('special');
  });

  it('summit group: hidden while the «Mountain cleared» window is open, then one by one after it closes', () => {
    expect(due({ playSec: 50, summit: true, summitAt: Infinity })).toEqual([]);
    const at = 400;
    const step = ui.menuStepSec;
    expect(due({ playSec: at, summit: true, summitAt: at })).toEqual(['daily', 'pets', 'shop', 'timeRewards', 'trophies']);
    expect(due({ playSec: at + step, summit: true, summitAt: at })).toContain('wardrobe');
    expect(due({ playSec: at + step, summit: true, summitAt: at })).not.toContain('quests');
    expect(due({ playSec: at + 2 * step, summit: true, summitAt: at })).toContain('quests');
    expect(due({ playSec: at + 3 * step - 0.01, summit: true, summitAt: at })).not.toContain('rebirth');
    expect(due({ playSec: at + 3 * step, summit: true, summitAt: at })).toContain('rebirth');
    // A summit from an earlier session: everything at once.
    expect(due({ playSec: 10, summit: true })).toEqual(['quests', 'rebirth', 'records', 'trophies', 'wardrobe']);
    expect(due({ playSec: 10, summit: false })).toEqual([]);
  });
});

// FM-08 (docs/01-gdd.md 19.5; docs/01a-content.md 18.4): with the base, the summit group by the number of summits.
describe('HUD schedule of the open pace (ui.summitGroup)', () => {
  const open = mergePatch(balanceJson as BalanceJson, openBalance).ui;
  const step = open.menuStepSec;
  const at = 400;
  const dueO = (s: Partial<HudScheduleState>): string[] =>
    [...hudDue(open, { playSec: at + 10 * step, summit: true, summitAt: null, payments: false, summits: 1, ...s })].filter((id) => !['shop', 'pets', 'daily', 'timeRewards'].includes(id)).sort();

  it('summits 0…4 and after a rebirth: the rows of 18.4', () => {
    expect(dueO({ summit: false, summits: 0 })).toEqual([]);
    expect(dueO({ summits: 1 })).toEqual(['records', 'trophies']);
    expect(dueO({ summits: 2 })).toEqual(['quests', 'records', 'shortcut', 'trophies', 'wardrobe']);
    expect(dueO({ summits: 3 })).toEqual(['quests', 'rebirth', 'records', 'shortcut', 'trophies', 'wardrobe']);
    expect(dueO({ summits: 4 })).toEqual(['quests', 'rebirth', 'records', 'shortcut', 'trophies', 'wardrobe']);
    expect(dueO({ summits: Infinity })).toEqual(['quests', 'rebirth', 'records', 'shortcut', 'trophies', 'wardrobe']);
  });

  it('the latest summit\'s ones after its window, one by one; the earlier ones stay', () => {
    expect(dueO({ summits: 2, summitAt: Infinity })).toEqual(['records', 'trophies']);
    expect(dueO({ summits: 2, summitAt: at, playSec: at })).toEqual(['records', 'trophies', 'wardrobe']);
    expect(dueO({ summits: 2, summitAt: at, playSec: at + step })).toEqual(['quests', 'records', 'trophies', 'wardrobe']);
    expect(dueO({ summits: 2, summitAt: at, playSec: at + 2 * step })).toEqual(['quests', 'records', 'shortcut', 'trophies', 'wardrobe']);
    expect(dueO({ summits: 1, summitAt: at, playSec: at })).toEqual(['trophies']);
    // The groups of 180 s and 300 s as before.
    expect([...hudDue(open, { playSec: open.unlockMenusSec, summit: false, summitAt: null, payments: false, summits: 0 })]).toEqual(['shop']);
  });
});
