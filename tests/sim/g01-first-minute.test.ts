import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HeroInput } from '../../src/sim/controller.ts';
import { createSim, type Sim } from '../../src/sim/world.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import type { BalanceJson, GameJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

// G-01 (producer 26.10): the first minute of mountain 1 — the first giant catch lets the hero go, the scripted wave
// comes by ftue.fallbackSec at the latest and never inside a giant's zone; plates after the avalanche stage.
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const tuning = mergePatch(read('tuning.json'), read('pace/stages/tuning.json')) as unknown as TuningJson;
const balance = mergePatch(read('balance.json'), read('pace/stages/balance.json')) as unknown as BalanceJson;
const game = read('game.json') as GameJson;
const worlds = read('pace/stages/worlds.json') as WorldsJson;
const spec = read('pace/stages/worlds-spec.json') as { stages: { plan: string[][]; giantMargin: number[] } };
const DT = 1 / 60;
const STAND: HeroInput = { moveX: 0, moveZ: 0, jump: false, jumpHeld: false };
const w1 = worlds.worlds.find((w) => w.index === 1)!;

function sim1(scripted: boolean): Sim {
  return createSim(buildLevel(w1), tuning, {
    balance,
    speedCurve: balance.speedCurve,
    stat: 0,
    threat: { threat: { ...w1.threat }, balance, avalanche: tuning.avalanche, scriptedPending: scripted, normalWavesDone: 0 },
    ...(game.threat.boss ? { boss: game.threat.boss } : {}),
  });
}

describe('G-01 · first minute of mountain 1', () => {
  it('plan: dips before the avalanche stage, plates after it; giant margin 0.10', () => {
    const p = spec.stages.plan[0]!;
    expect(p.indexOf('dips')).toBeLessThan(p.indexOf('avalanche'));
    expect(p.indexOf('plates')).toBeGreaterThan(p.indexOf('avalanche'));
    expect(spec.stages.giantMargin[0]).toBeCloseTo(0.1, 6);
    expect(balance.ftue.fallbackSec).toBeLessThanOrEqual(35);
  });

  it('the scripted wave warns by fallbackSec for a hero who stays in the camp', () => {
    const sim = sim1(true);
    let warnAt = -1;
    sim.events.on('waveWarn', () => {
      if (warnAt < 0) warnAt = sim.tick * DT;
    });
    for (let k = 0; k < 60 / DT && warnAt < 0; k++) sim.step(STAND, DT);
    expect(warnAt).toBeGreaterThan(0);
    expect(warnAt).toBeLessThanOrEqual(balance.ftue.fallbackSec + 0.1);
  });

  it('not inside a giant zone: the scripted wave waits till the hero is out of it', () => {
    const sim = sim1(true);
    const zone = sim.level.bosses[0]!.zone;
    let warnAt = -1;
    sim.events.on('waveWarn', () => {
      if (warnAt < 0) warnAt = sim.tick * DT;
    });
    const mid = (zone[0] + zone[1]) / 2;
    sim.teleport(0, sim.level.floorAt(0, mid) + 0.05, mid);
    sim.giantFreeCatches = 99;
    for (let k = 0; k < (balance.ftue.fallbackSec + 10) / DT; k++) {
      const h = sim.hero.pos;
      if (h.z < zone[0] + 2 || h.z > zone[1] - 2) sim.teleport(0, sim.level.floorAt(0, mid) + 0.05, mid);
      sim.step(STAND, DT);
    }
    expect(warnAt).toBe(-1);
    // Z-01: out of it where a grotto is in reach (above it lies the safe finish under a closed ridge — the wave waits there).
    const top = zone[0] - 40;
    sim.teleport(0, sim.level.floorAt(0, top) + 0.05, top);
    for (let k = 0; k < 2 / DT && warnAt < 0; k++) sim.step(STAND, DT);
    expect(warnAt).toBeGreaterThan(0);
  });

  it('the first giant catch keeps the hero where he is; the next one rolls him back', () => {
    const sim = sim1(false);
    sim.giantFreeCatches = 1;
    const zone = sim.level.bosses[0]!.zone;
    const z0 = zone[0] + 4;
    sim.teleport(0, sim.level.floorAt(0, z0) + 0.05, z0);
    let catches = 0;
    sim.events.on('bossCaught', () => catches++);
    let k = 0;
    for (; k < 30 / DT && catches === 0; k++) sim.step(STAND, DT);
    expect(catches).toBe(1);
    expect(sim.caught).toBeNull();
    expect(Math.abs(sim.hero.pos.z - z0)).toBeLessThan(1);
    expect(sim.giantFreeCatches).toBe(0);
    for (k = 0; k < 30 / DT && catches === 1; k++) sim.step(STAND, DT);
    expect(catches).toBe(2);
    for (k = 0; k < 5 && !sim.caught; k++) sim.step(STAND, DT);
    expect(sim.caught).not.toBeNull();
  });
});
