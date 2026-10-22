import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { padPays } from '../../src/meta/trophies.ts';
import { applyRebirth } from '../../src/meta/rebirth.ts';
import type { SaveData } from '../../src/meta/save.ts';

// ST-06 (producer 22.10: the first stage farmed for ever): a stage pad behind the farthest stage pays
// `stages.padBehindTakes` times a life (main.ts asks padPays only for those), then nothing.
const worlds = JSON.parse(readFileSync(resolve(__dirname, '../../content/avalanche/pace/stages/worlds.json'), 'utf8')) as { worlds: Array<{ padBehindTakes?: number }> };

describe('ST-06 stage pads behind the farthest stage pay a few times a life', () => {
  it('the pad of stage 1 pays `takes` times, then 0; a farther stage and another mountain count apart', () => {
    const takes = worlds.worlds[0]!.padBehindTakes!;
    for (const w of worlds.worlds) expect(w.padBehindTakes).toBe(takes);
    expect(takes).toBeGreaterThanOrEqual(1);
    expect(takes).toBeLessThanOrEqual(5);
    const save: Pick<SaveData, 'padTakes'> = {};
    const runs = Array.from({ length: 10 }, () => padPays(save, 2, 1, takes));
    expect(runs.filter(Boolean)).toHaveLength(takes);
    expect(runs.slice(takes).every((x) => !x)).toBe(true);
    expect(padPays(save, 2, 2, takes)).toBe(true);
    expect(padPays(save, 1, 1, takes)).toBe(true);
    expect(padPays(save, 2, 1, undefined)).toBe(true);
  });
  it('a rebirth clears the count', () => {
    const save = { padTakes: { '2:1': 9 } } as unknown as SaveData;
    applyRebirth(save, { goalSummits: 5, mult: 3 } as never, { skins: [], wings: [] } as never);
    expect(save.padTakes).toBeUndefined();
    expect(padPays(save, 2, 1, 3)).toBe(true);
  });
});

import { createSim } from '../../src/sim/world.ts';
import { NO_INPUT } from '../../src/sim/controller.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { levelThreshold } from '../../src/sim/levels.ts';
import type { BalanceJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

describe('ST-06 the sim: a spent pad pays nothing, says so, the flight to the camp stays', () => {
  const read = (f: string): unknown => JSON.parse(readFileSync(resolve(__dirname, '../../content/avalanche', f), 'utf8'));
  const tuning = mergePatch(read('tuning.json'), read('pace/stages/tuning.json')) as unknown as TuningJson;
  const balance = mergePatch(read('balance.json'), read('pace/stages/balance.json')) as unknown as BalanceJson;
  const w = (read('pace/stages/worlds.json') as WorldsJson).worlds[0]!;
  it('padPay false: amount 0 and spent; the camp after it', () => {
    const st = w.stages!.find((s) => s.n === 3)!;
    const sim = createSim(buildLevel(w), tuning, { balance, speedCurve: balance.speedCurve, stat: levelThreshold(st.level, balance.levels!), padPay: () => false });
    const got: Array<{ amount: number; spent?: boolean }> = [];
    let camp = 0;
    sim.events.on('trophyTake', (p) => void got.push({ amount: p.amount, ...(p.spent ? { spent: true } : {}) }));
    sim.events.on('campReturn', () => void camp++);
    const coins0 = sim.coins;
    sim.teleport(st.pad.x, st.pad.y + 0.05, st.pad.z);
    for (let i = 0; i < 5; i++) sim.step(NO_INPUT, 1 / 60);
    expect(got).toEqual([{ amount: 0, spent: true }]);
    expect(sim.coins).toBe(coins0);
    for (let i = 0; i < 120 && camp === 0; i++) sim.step(NO_INPUT, 1 / 60);
    expect(camp).toBe(1);
  });
});
