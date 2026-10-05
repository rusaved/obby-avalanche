import { describe, expect, it } from 'vitest';
import {
  bonusReady,
  claimBonus,
  claimQuest,
  claimTimeReward,
  addPlayToday,
  freeSpinReady,
  nextTimeRewardSec,
  pickQuests,
  questProgress,
  questsToClaim,
  refreshDay,
  spinFree,
  timeRewardReady,
} from '../../src/meta/quests.ts';
import { claimDaily, HOUR_MS, rollDay } from '../../src/meta/daily.ts';
import { createSave } from '../../src/meta/save.ts';
import balanceJson from '../../content/avalanche/balance.json' with { type: 'json' };
import sampleBalance from '../../content/_sample/balance.json' with { type: 'json' };
import gameJson from '../../content/avalanche/game.json' with { type: 'json' };
import sampleGame from '../../content/_sample/game.json' with { type: 'json' };
import type { BalanceJson } from '../../src/content/types.ts';

const balance = balanceJson as unknown as BalanceJson;
const sample = sampleBalance as unknown as BalanceJson;
const near = { shoesFar: false, summitFar: false };
const T0 = 1_700_000_000_000;

// M3-08b: 3 quests of 9, 8 time rewards, the wheel (docs/01-gdd.md 7.7, 7.8, 7.13; docs/01a-content.md 10; GDD-10).
describe('quests, time rewards, wheel (M3-08b)', () => {
  it('without game.json threat.bonus q_gold never comes (1000 seeds); with it — it does; 3 different quests a day', () => {
    expect(gameJson.threat.bonus).toBeTruthy();
    expect('bonus' in sampleGame.threat).toBe(false);
    let goldWith = 0;
    for (let seed = 0; seed < 1000; seed++) {
      for (const [cfg, gold] of [[balance.quests, false], [sample.quests, !!(sampleGame.threat as { bonus?: unknown }).bonus]] as const) {
        const q = pickQuests(cfg, { gold, ...near }, seed);
        expect(q).toHaveLength(3);
        expect(new Set(q.map((x) => x.id)).size).toBe(3);
        expect(q.some((x) => x.id === 'q_gold')).toBe(false);
      }
      if (pickQuests(balance.quests, { gold: true, ...near }, seed).some((x) => x.id === 'q_gold')) goldWith++;
    }
    // 3 of 9: about a third of the days.
    expect(goldWith).toBeGreaterThan(250);
    expect(goldWith).toBeLessThan(420);
    // Far shoes and summit stay out.
    for (let seed = 0; seed < 200; seed++) {
      const q = pickQuests(balance.quests, { gold: true, shoesFar: true, summitFar: true }, seed).map((x) => x.id);
      expect(q).not.toContain('q_shoes');
      expect(q).not.toContain('q_summit');
    }
  });

  it('quests: progress, «Claim» once, the bonus for all three; new ones with the calendar day by the 20-hour rule', () => {
    const save = createSave(T0);
    rollDay(save, T0, balance.daily.resetHours);
    expect(refreshDay(save, balance.quests, { gold: true, ...near })).toBe(true);
    expect(refreshDay(save, balance.quests, { gold: true, ...near })).toBe(false);
    const list = save.quests!.list;
    expect(list).toHaveLength(3);
    expect(questsToClaim(save)).toBe(false);
    expect(claimQuest(save, 0)).toBe(false);
    for (const q of list) expect(questProgress(save, q.id, q.n)).toBe(true);
    expect(questProgress(save, list[0]!.id, 5)).toBe(false);
    expect(list[0]!.k).toBe(list[0]!.n);
    expect(questsToClaim(save)).toBe(true);
    expect(bonusReady(save)).toBe(false);
    for (let i = 0; i < 3; i++) expect(claimQuest(save, i)).toBe(true);
    expect(claimQuest(save, 0)).toBe(false);
    expect(claimBonus(save)).toBe(true);
    expect(claimBonus(save)).toBe(false);
    // The calendar claimed at T0 + 1 h: 19 h later the same day, 20 h later new quests.
    claimDaily(save, T0 + HOUR_MS, 7);
    const day1 = save.quests!.day;
    expect(rollDay(save, T0 + 21 * HOUR_MS - 1, balance.daily.resetHours)).toBe(false);
    expect(refreshDay(save, balance.quests, { gold: true, ...near })).toBe(false);
    expect(rollDay(save, T0 + 21 * HOUR_MS, balance.daily.resetHours)).toBe(true);
    expect(refreshDay(save, balance.quests, { gold: true, ...near })).toBe(true);
    expect(save.quests!.day).not.toBe(day1);
    expect(save.quests!.list.every((q) => q.k === 0 && !q.got)).toBe(true);
    expect(save.quests!.bonus).toBe(false);
  });

  it('time rewards: 8 by minutes of play today, each claimed once, reset with the new day', () => {
    const save = createSave(T0);
    rollDay(save, T0, balance.daily.resetHours);
    refreshDay(save, balance.quests, { gold: true, ...near });
    const tr = balance.timeRewards;
    expect(tr.map((x) => x.min)).toEqual([1, 3, 5, 10, 15, 25, 40, 60]);
    expect(nextTimeRewardSec(save, tr)).toBe(60);
    addPlayToday(save, 59);
    expect(timeRewardReady(save, tr, 0)).toBe(false);
    addPlayToday(save, 1);
    expect(timeRewardReady(save, tr, 0)).toBe(true);
    expect(claimTimeReward(save, tr, 0)).toBe(true);
    expect(claimTimeReward(save, tr, 0)).toBe(false);
    expect(claimTimeReward(save, tr, 1)).toBe(false);
    expect(nextTimeRewardSec(save, tr)).toBe(120);
    addPlayToday(save, 3600);
    expect(tr.every((_, i) => i === 0 || timeRewardReady(save, tr, i))).toBe(true);
    expect(nextTimeRewardSec(save, tr)).toBeNull();
    rollDay(save, T0 + 20 * HOUR_MS, balance.daily.resetHours);
    refreshDay(save, balance.quests, { gold: true, ...near });
    expect(save.timeRw).toEqual({ day: T0 + 20 * HOUR_MS, sec: 0, got: [] });
  });

  it('the wheel: 8 equal sectors, one free spin a game day', () => {
    const save = createSave(T0);
    rollDay(save, T0, balance.daily.resetHours);
    const n = balance.wheel.sectors.length;
    expect(n).toBe(8);
    expect(freeSpinReady(save)).toBe(true);
    expect(spinFree(save, n, 0.99)).toBe(7);
    expect(freeSpinReady(save)).toBe(false);
    expect(spinFree(save, n, 0.1)).toBeNull();
    rollDay(save, T0 + 20 * HOUR_MS, balance.daily.resetHours);
    expect(spinFree(save, n, 0.1)).toBe(0);
    // Equal chances: the roll [0, 1) splits into 8 equal parts.
    for (let i = 0; i < n; i++) {
      const s = createSave(T0);
      rollDay(s, T0, balance.daily.resetHours);
      expect(spinFree(s, n, (i + 0.5) / n)).toBe(i);
    }
  });
});
