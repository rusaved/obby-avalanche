import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSim } from '../../src/sim/world.ts';
import { NO_INPUT } from '../../src/sim/controller.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { levelThreshold } from '../../src/sim/levels.ts';
import type { BalanceJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

// G-02 (producer 26.10, Q-ST-2 «B with standing»): the stage pad pays on a touch; the flight to the camp only after
// standing on it `ui.padStandSec` — a run over it keeps the hero on the slope.
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(__dirname, '../../content/avalanche', f), 'utf8'));
const tuning = mergePatch(read('tuning.json'), read('pace/stages/tuning.json')) as unknown as TuningJson;
const balance = mergePatch(read('balance.json'), read('pace/stages/balance.json')) as unknown as BalanceJson;
const w = (read('pace/stages/worlds.json') as WorldsJson).worlds[0]!;
const DT = 1 / 60;

describe('G-02 · the stage pad flies to the camp only after standing on it', () => {
  const st = w.stages!.find((s) => s.n === 2)!;
  const make = () => {
    const sim = createSim(buildLevel(w), tuning, { balance, speedCurve: balance.speedCurve, stat: levelThreshold(st.level + 2, balance.levels!) });
    const ev = { take: 0, camp: 0 };
    sim.events.on('trophyTake', () => void ev.take++);
    sim.events.on('campReturn', () => void ev.camp++);
    return { sim, ev };
  };

  it('stand time is in the data', () => expect(balance.ui.padStandSec).toBeCloseTo(0.5, 6));

  it('running across the pad pays and keeps the hero on the slope', () => {
    const { sim, ev } = make();
    sim.teleport(st.pad.x, st.pad.y + 0.05, st.pad.z - 8);
    for (let i = 0; i < 2 / DT; i++) sim.step({ moveX: 0, moveZ: 1, jump: false, jumpHeld: false }, DT);
    expect(ev.take).toBe(1);
    expect(ev.camp).toBe(0);
    expect(sim.hero.pos.z).toBeGreaterThan(st.pad.z);
  });

  it('standing on it ~0.5 s flies to the camp; the hold is seen while it fills', () => {
    const { sim, ev } = make();
    sim.teleport(st.pad.x, st.pad.y + 0.05, st.pad.z);
    for (let i = 0; i < 0.3 / DT; i++) sim.step(NO_INPUT, DT);
    expect(ev.take).toBe(1);
    expect(ev.camp).toBe(0);
    expect(sim.padHold?.stage).toBe(st.n);
    expect(sim.padHold!.t).toBeGreaterThan(0.1);
    for (let i = 0; i < 0.4 / DT && ev.camp === 0; i++) sim.step(NO_INPUT, DT);
    expect(ev.camp).toBe(1);
    expect(sim.hero.pos.z).toBeLessThan(w.stages![1]!.z0);
  });
});
