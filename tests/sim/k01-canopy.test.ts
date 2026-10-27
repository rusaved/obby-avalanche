import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HeroInput } from '../../src/sim/controller.ts';
import { createSim, type Sim } from '../../src/sim/world.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import type { BalanceJson, GameJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

// K-01 (review D20: 0 waves in 243 s standing 3 units under the wall «8»): the canopy of the hero's own ridge (the finish
// grotto of D-01) is a shelter in reach when its mouth is within threat.canopyReach; the first wave leads to the canopy
// the hero stands at, or the nearest ahead — never to the canopy of a ridge 200 units behind.
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const tuning = mergePatch(read('tuning.json'), read('pace/stages/tuning.json')) as unknown as TuningJson;
const balance = mergePatch(read('balance.json'), read('pace/stages/balance.json')) as unknown as BalanceJson;
const game = read('game.json') as GameJson;
const worlds = read('pace/stages/worlds.json') as WorldsJson;
const DT = 1 / 60;
const STAND: HeroInput = { moveX: 0, moveZ: 0, jump: false, jumpHeld: false };
const w1 = worlds.worlds.find((w) => w.index === 1)!;

function sim1(scripted: boolean): Sim {
  return createSim(buildLevel(w1), tuning, {
    balance,
    speedCurve: balance.speedCurve,
    stat: 0,
    threat: { threat: { ...w1.threat }, balance, avalanche: tuning.avalanche, scriptedPending: scripted, normalWavesDone: scripted ? 0 : 1 },
    ...(game.threat.boss ? { boss: game.threat.boss } : {}),
  });
}

/** Stand at (x, ridge − dz) under the ridge of stage n: the first warning's second and its shelter (−1 — none in 120 s). */
function firstWarn(n: number, x: number, scripted: boolean, dz = 3): { sec: number; shelter: number; spawnZ: number; sim: Sim } {
  const sim = sim1(scripted);
  const ridge = w1.stages!.find((s) => s.n === n)!.z0;
  let sec = -1;
  let shelter = -1;
  let spawnZ = 0;
  sim.events.on('waveWarn', (e) => {
    if (sec < 0) {
      sec = sim.tick * DT;
      shelter = (e as { shelter: number }).shelter;
      spawnZ = (e as { spawnZ: number }).spawnZ;
    }
  });
  const z = ridge - dz;
  sim.teleport(x, sim.level.floorAt(x, z) + 0.05, z);
  for (let k = 0; k < 120 / DT && sec < 0; k++) sim.step(STAND, DT);
  return { sec, shelter, spawnZ, sim };
}

describe('K-01 · the canopy of the own ridge is a shelter (mountain 1)', () => {
  const ridge3 = w1.stages!.find((s) => s.n === 3)!.z0;
  for (const scripted of [false, true])
    for (const x of [20, -20])
      it(`3 units under the wall «8» at x ${x}${scripted ? ', a newbie' : ''}: a warning within 90 s, to the canopy of that ridge`, () => {
        expect(w1.threat.canopyReach).toBe(20);
        const r = firstWarn(3, x, scripted);
        expect(r.sec, 'warned').toBeGreaterThan(0);
        expect(r.sec).toBeLessThanOrEqual(90);
        const n = r.sim.level.niches[r.shelter]!;
        expect(n.canopy, `shelter ${n.kind} at z ${n.z}`).toBe(true);
        expect(n.box.max[2], 'the canopy of this ridge').toBeGreaterThanOrEqual(ridge3 - 1);
      });

  for (const [x, dz] of [[20, 3], [25, 14]] as const)
  it(`the first wave of a newbie by the closed ridge of stage 4 (x ${x}, ${dz} under it) leads to the canopy there, not back to the one of ridge 3`, () => {
    const ridge = w1.stages!.find((s) => s.n === 4)!.z0;
    const r = firstWarn(4, x, true, dz);
    expect(r.sec, 'warned').toBeGreaterThan(0);
    expect(r.sec).toBeLessThanOrEqual(90);
    const n = r.sim.level.niches[r.shelter]!;
    expect(n.box.max[2], `shelter at z ${n.z}`).toBeGreaterThanOrEqual(ridge - 1);
    expect(r.spawnZ).toBeGreaterThan(ridge - 20);
  });
});
