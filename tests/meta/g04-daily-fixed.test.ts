import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRewards } from '../../src/app/rewards.ts';
import { createSave } from '../../src/meta/save.ts';
import { createSim } from '../../src/sim/world.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import type { BalanceJson, EggsJson, SkinsJson, TuningJson, WorldsJson } from '../../src/content/types.ts';
import type { Hud } from '../../src/ui/hud.ts';

// G-04 (producer 26.10): the calendar's coins of day 1 are the same on any stage of the mountain (the first zone of it).
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(__dirname, '../../content/avalanche', f), 'utf8'));
const tuning = mergePatch(read('tuning.json'), read('pace/stages/tuning.json')) as unknown as TuningJson;
const balance = mergePatch(read('balance.json'), read('pace/stages/balance.json')) as unknown as BalanceJson;
const worlds = read('pace/stages/worlds.json') as WorldsJson;
const noHud = new Proxy({} as Hud, { get: () => () => undefined });

describe('G-04 · the day 1 sum does not depend on the stage', () => {
  it('coinsOf(…, fixed) is the same at the camp and on every stage of mountains 1 and 3', () => {
    for (const wi of [0, 2]) {
      const w = worlds.worlds[wi]!;
      const save = createSave(0);
      save.world = w.index;
      const sim = createSim(buildLevel(w), tuning, { balance, speedCurve: balance.speedCurve, coins: 0 });
      const r = createRewards({ balance, eggs: read('eggs.json') as EggsJson, skins: read('skins.json') as SkinsJson, worlds: worlds.worlds, save, getSim: () => sim, hud: noHud, pets: () => null, rng: { next: () => 0 }, numSuffix: (k) => k, onLook: () => {}, onBoost: () => {} });
      const day1 = balance.daily.days[0]!;
      expect(day1.kind).toBe('coins');
      const gifts = (day1 as { gifts: number }).gifts;
      const sums = new Set<number>();
      sums.add(r.coinsOf(gifts, true));
      for (const st of w.stages!) {
        sim.teleport(0, st.y + 0.05, st.start + 2);
        sums.add(r.coinsOf(gifts, true));
      }
      expect([...sums]).toHaveLength(1);
      expect([...sums][0]).toBeGreaterThan(0);
    }
  });
});
