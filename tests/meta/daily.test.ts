import { describe, expect, it } from 'vitest';
import { canClaimDaily, claimDaily, dailyIndex, dailyReward, HOUR_MS, nextDayAt, rollDay } from '../../src/meta/daily.ts';
import { createRewards } from '../../src/app/rewards.ts';
import { createSave } from '../../src/meta/save.ts';
import { createSim } from '../../src/sim/world.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { wallScale } from '../../src/sim/gates.ts';
import tuningJson from '../../content/avalanche/tuning.json' with { type: 'json' };
import worldsJson from '../../content/avalanche/worlds.json' with { type: 'json' };
import balanceJson from '../../content/avalanche/balance.json' with { type: 'json' };
import eggsJson from '../../content/avalanche/eggs.json' with { type: 'json' };
import skinsJson from '../../content/avalanche/skins.json' with { type: 'json' };
import type { BalanceJson, EggsJson, SkinsJson, TuningJson, WorldsJson } from '../../src/content/types.ts';
import type { Hud } from '../../src/ui/hud.ts';
import type { PetsView } from '../../src/app/pets-view.ts';

const balance = balanceJson as unknown as BalanceJson;
const tuning = tuningJson as TuningJson;
const worlds = worldsJson as unknown as WorldsJson;
const noHud = new Proxy({} as Hud, { get: () => () => undefined });
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
const R = balance.daily.resetHours;
const T0 = 1_700_000_000_000;

// M3-08: the 7-day calendar by the 20-hour rule (docs/01-gdd.md 7.6; docs/02-tech.md 11.8; GDD-10).
describe('calendar (M3-08)', () => {
  it('one claim per game day: the next one 20 h after the last claim by server time, not at midnight', () => {
    const save = createSave(T0);
    rollDay(save, T0, R);
    expect(canClaimDaily(save)).toBe(true);
    expect(claimDaily(save, T0 + HOUR_MS, 7)).toEqual({ day: 1, index: 0, circle: 0 });
    expect(claimDaily(save, T0 + 2 * HOUR_MS, 7)).toBeNull();
    expect(nextDayAt(save, T0, R)).toBe(T0 + 21 * HOUR_MS);
    expect(rollDay(save, T0 + 21 * HOUR_MS - 1, R)).toBe(false);
    expect(canClaimDaily(save)).toBe(false);
    expect(rollDay(save, T0 + 21 * HOUR_MS, R)).toBe(true);
    expect(canClaimDaily(save)).toBe(true);
    expect(claimDaily(save, T0 + 22 * HOUR_MS, 7)?.day).toBe(2);
  });

  it('a skipped day never breaks the series; without a claim the day still rolls every 20 h', () => {
    const save = createSave(T0);
    rollDay(save, T0, R);
    claimDaily(save, T0, 7);
    // Back after 3 days: day 2, not day 1 again.
    expect(rollDay(save, T0 + 72 * HOUR_MS, R)).toBe(true);
    expect(claimDaily(save, T0 + 72 * HOUR_MS, 7)?.day).toBe(2);
    // No claim on the next day: quests still get their new day 20 h after its start, the reward still waits.
    expect(rollDay(save, T0 + 92 * HOUR_MS, R)).toBe(true);
    expect(rollDay(save, T0 + 112 * HOUR_MS - 1, R)).toBe(false);
    expect(rollDay(save, T0 + 112 * HOUR_MS, R)).toBe(true);
    expect(canClaimDaily(save)).toBe(true);
    expect(dailyIndex(save, 7)).toBe(2);
  });

  it('after day 7 the circle repeats; a look already owned turns into trophies (15 for day 2, 25 for day 7)', () => {
    const save = createSave(T0);
    let t = T0;
    const days: number[] = [];
    for (let i = 0; i < 9; i++) {
      rollDay(save, t, R);
      days.push(claimDaily(save, t, 7)!.day);
      t += R * HOUR_MS;
    }
    expect(days).toEqual([1, 2, 3, 4, 5, 6, 7, 1, 2]);
    const owns = () => true;
    expect(dailyReward(balance.daily, 1, owns, 0).reward).toEqual({ kind: 'skin', id: 'penguin_suit', alt: { kind: 'trophies', n: 15 } });
    expect(dailyReward(balance.daily, 1, owns, 1)).toEqual({ reward: { kind: 'trophies', n: 15 }, alt: true });
    expect(dailyReward(balance.daily, 6, owns, 1).reward).toEqual({ kind: 'trophies', n: 25 });
    expect(dailyReward(balance.daily, 6, () => false, 1).reward.kind).toBe('pet');
    expect(dailyReward(balance.daily, 0, owns, 3).reward).toEqual({ kind: 'coins', gifts: 30 });
  });

  it('rewards: coins = 30 gifts of the zone × wallScale[n], trophies to both counters, boost adds 10 min, Penguin skin, reindeer and wings', () => {
    const save = createSave(T0);
    save.tier = 1;
    const level = buildLevel(worlds.worlds[0]!);
    const sim = createSim(level, tuning, { balance, speedCurve: curve, tier: 1, coins: 0 });
    const hatched: string[] = [];
    const pets = { hatched: (id: string) => void hatched.push(id) } as unknown as PetsView;
    let looks = 0;
    let boosts = 0;
    const r = createRewards({
      balance,
      eggs: eggsJson as EggsJson,
      skins: skinsJson as SkinsJson,
      worlds: worlds.worlds,
      save,
      getSim: () => sim,
      hud: noHud,
      pets: () => pets,
      rng: { next: () => 0 },
      numSuffix: (k) => k,
      onLook: () => void looks++,
      onBoost: () => void boosts++,
    });
    const gift = sim.gifts.find((g) => g.zone === sim.gifts[0]!.zone)!.coins;
    r.give(balance.daily.days[0]!);
    expect(sim.coins).toBe(30 * gift * wallScale(1, balance.rebirth));
    r.give(balance.daily.days[1]!);
    expect(save.skins).toContain('penguin_suit');
    expect(r.owns(balance.daily.days[1]!)).toBe(true);
    r.give(balance.daily.days[2]!);
    r.give(balance.daily.days[2]!);
    expect(save.boostSec).toBe(2 * 600);
    expect(boosts).toBe(2);
    r.give(balance.daily.days[3]!);
    expect(save.trophies).toBe(5);
    expect(save.trophiesTotal).toBe(5);
    r.give(balance.daily.days[4]!);
    const icePet = (eggsJson as EggsJson).eggs.find((e) => e.id === 'ice')!.pool[0]!.pet;
    expect(hatched).toEqual([icePet]);
    expect(r.eggOf('ice')?.id).toBe('ice');
    r.give(balance.daily.days[6]!);
    expect(hatched).toEqual([icePet, 'reindeer']);
    expect(save.wings).toContain('wings_snow');
    expect(r.owns(balance.daily.days[6]!)).toBe(true);
    expect(looks).toBe(2);
    // The best egg: the egg of the farthest mountain open on this tier.
    save.world = 3;
    expect(r.eggOf('best')?.id).toBe(worlds.worlds[2]!.egg);
  });
});
