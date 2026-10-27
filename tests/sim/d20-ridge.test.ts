import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HeroInput } from '../../src/sim/controller.ts';
import { createSim, type Sim } from '../../src/sim/world.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import type { BalanceJson, GameJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

// D-01 (Q-Z-2 «A»): a run up the axis that meets a closed ridge of mountain 1 stands on the belt of the finish grotto and
// keeps growing until the ridge opens. D-06: at a closed ridge the pause without a wave is not longer than idleMaxSec (90 s),
// and the grotto of that finish counts as made it.
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const tuning = mergePatch(read('tuning.json'), read('pace/stages/tuning.json')) as unknown as TuningJson;
const balance = mergePatch(read('balance.json'), read('pace/stages/balance.json')) as unknown as BalanceJson;
const game = read('game.json') as GameJson;
const worlds = read('pace/stages/worlds.json') as WorldsJson;
const DT = 1 / 60;
const STAND: HeroInput = { moveX: 0, moveZ: 0, jump: false, jumpHeld: false };
const UP: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };
const w1 = worlds.worlds.find((w) => w.index === 1)!;

function sim1(stat: number): Sim {
  return createSim(buildLevel(w1), tuning, {
    balance,
    speedCurve: balance.speedCurve,
    stat,
    threat: { threat: { ...w1.threat }, balance, avalanche: tuning.avalanche, scriptedPending: false, normalWavesDone: 1 },
    ...(game.threat.boss ? { boss: game.threat.boss } : {}),
  });
}

describe('D-01, D-06 · closed ridges of mountain 1', () => {
  const st4 = w1.stages!.find((s) => s.n === 4)!;
  const ridge = st4.z0;

  it('D-01: a run up the axis into the closed ridge of stage 4 stands on the finish belt and the ridge opens', () => {
    const sim = sim1(0);
    const gate = sim.level.gates.findIndex((g) => Math.abs(g.z - ridge) < 1e-3);
    expect(gate).toBeGreaterThan(0);
    const z = ridge - 20;
    sim.teleport(0, sim.level.floorAt(0, z) + 0.05, z);
    let onBelt = 0;
    let opened = -1;
    sim.events.on('gateOpen', (e) => {
      if ((e as { index: number }).index === gate && opened < 0) opened = sim.tick * DT;
    });
    for (let k = 0; k < 120 / DT && opened < 0; k++) {
      sim.step(UP, DT);
      if (sim.onBelt) onBelt++;
    }
    expect(onBelt * DT).toBeGreaterThan(1);
    expect(opened).toBeGreaterThan(0);
  });

  it('D-06: standing by the closed ridge off the belt, a wave warns within idleMaxSec; in the finish grotto it is «made it»', () => {
    expect(w1.threat.idleMaxSec).toBeLessThanOrEqual(90);
    const sim = sim1(0);
    let warnAt = -1;
    let outcome = '';
    sim.events.on('waveWarn', () => {
      if (warnAt < 0) warnAt = sim.tick * DT;
    });
    sim.events.on('waveEnd', (e) => {
      if (!outcome) outcome = (e as { outcome: string }).outcome;
    });
    const z = ridge - 14;
    sim.teleport(25, sim.level.floorAt(25, z) + 0.05, z);
    for (let k = 0; k < 100 / DT && warnAt < 0; k++) sim.step(STAND, DT);
    expect(warnAt).toBeGreaterThan(0);
    expect(warnAt).toBeLessThanOrEqual(w1.threat.idleMaxSec! + 1);
    // Into the grotto of this finish (on the axis by the ridge) while it warns: «Phew!».
    const zi = ridge - 6;
    sim.teleport(0, sim.level.floorAt(0, zi) + 0.05, zi);
    for (let k = 0; k < 30 / DT && !outcome; k++) sim.step(STAND, DT);
    expect(outcome).toBe('survived');
  });
});
