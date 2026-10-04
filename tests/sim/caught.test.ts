import { describe, expect, it } from 'vitest';
import { buildLevel } from '../../src/level/builder.ts';
import { createSim } from '../../src/sim/world.ts';
import { NO_INPUT } from '../../src/sim/controller.ts';
import { inSafeZone } from '../../src/sim/shelter.ts';
import { createRng } from '../../src/core/rng.ts';
import tuning from '../../content/avalanche/tuning.json' with { type: 'json' };
import balance from '../../content/avalanche/balance.json' with { type: 'json' };
import worldsJson from '../../content/avalanche/worlds.json' with { type: 'json' };
import type { BalanceJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

const DT = 1 / 60;
const bal = balance as BalanceJson;
const tun = tuning as TuningJson;
const world1 = (worldsJson as unknown as WorldsJson).worlds[0]!;
const level = buildLevel(world1);

// M2-07, GDD-04: «Snowed in!» (docs/01-gdd.md 4.5).
describe('«Snowed in!» (M2-07)', () => {
  it('100 random points of the track: controls back within 2.0 s, in a cave below or in the camp, nothing lost, no second catch', () => {
    expect(bal.caught).toEqual({ rollSec: 1.2, maxSec: 2.0 });
    const rng = createRng(20261004);
    const sim = createSim(level, tun, {
      balance: bal,
      speedCurve: bal.speedCurve,
      stat: 0,
      coins: 0,
      threat: { threat: { ...world1.threat }, balance: bal, avalanche: tun.avalanche, scriptedPending: false, normalWavesDone: 99 },
    });
    const log: Array<{ name: string; tick: number; payload: Record<string, unknown> }> = [];
    for (const n of ['waveCaught', 'caughtEnd', 'waveGone', 'waveSurvived'] as const) {
      sim.events.on(n, (p) => log.push({ name: n, tick: sim.tick, payload: p as unknown as Record<string, unknown> }));
    }
    let atEnd = { stat: 0, coins: 0, gates: [] as boolean[] };
    sim.events.on('caughtEnd', () => (atEnd = { stat: sim.progress.stat, coins: sim.coins, gates: [...sim.gatesOpen] }));
    const lastGate = level.gates[level.gates.length - 1]!.z;
    let caughtInCave = 0;
    let caughtToCamp = 0;
    for (let i = 0; i < 100; i++) {
      // A random point of the open slope: between the camp and the last wall, anywhere across the track.
      const z = 42 + rng.next() * (lastGate - 44);
      const x = (rng.next() - 0.5) * (level.width - 4);
      // Stat and coins of a player who opened every wall below the point (nothing may change them).
      const wallsBelow = level.gates.filter((g) => g.z < z).length;
      sim.progress.stat = wallsBelow > 0 ? sim.gateRequirement(wallsBelow - 1) + 7 : 3;
      sim.coins = 1000 + i;
      level.gates.forEach((_, gi) => (sim.gatesOpen[gi] = gi < wallsBelow));
      sim.teleport(x, level.floorYAt(z) + 0.05, z);
      for (let k = 0; k < 3; k++) sim.step(NO_INPUT, DT);
      if (sim.inShelter()) continue; // a point inside a cave mouth is a shelter, not a catch
      // Snapshot at the catch (a random point may sit in an obstacle the hero slides off before the wave).
      let before = { stat: -1, coins: -1, gates: [] as boolean[] };
      const off = sim.events.on('waveCaught', () => (before = { stat: sim.progress.stat, coins: sim.coins, gates: [...sim.gatesOpen] }));
      log.length = 0;
      sim.threat!.trigger();
      sim.step(NO_INPUT, DT);
      let guard = 0;
      while ((sim.threat!.state.phase !== 'idle' || sim.caught) && guard++ < 60 * 60) sim.step(NO_INPUT, DT);
      off();
      const at = `#${i} z=${z.toFixed(1)} x=${x.toFixed(1)}`;
      const caught = log.filter((r) => r.name === 'waveCaught');
      expect(caught, at).toHaveLength(1);
      const end = log.find((r) => r.name === 'caughtEnd');
      expect(end, at).toBeDefined();
      const sec = (end!.tick - caught[0]!.tick + 1) / 60;
      expect(sec, at).toBeLessThanOrEqual(bal.caught.maxSec + 1e-9);
      // Where the ball stopped: in a cave below the catch point or in the camp.
      const cz = caught[0]!.payload['z'] as number;
      const niche = end!.payload['niche'] as number;
      const ex = end!.payload['x'] as number;
      const ey = end!.payload['y'] as number;
      const ez = end!.payload['z'] as number;
      if (niche >= 0) {
        expect(level.niches[niche]!.z, at).toBeLessThan(cz);
        // No cave between it and the catch point.
        expect(level.niches.some((n) => n.z < cz && n.z > level.niches[niche]!.z), at).toBe(false);
        caughtInCave++;
      } else {
        expect(level.niches.some((n) => n.z < cz), at).toBe(false);
        expect(inSafeZone(level, ez), at).toBe(true);
        caughtToCamp++;
      }
      // The hero stands there in shelter (cave) or in the camp right after the clip.
      sim.teleport(ex, ey + 0.05, ez);
      sim.step(NO_INPUT, DT);
      expect(niche >= 0 ? sim.shelterIndex() === niche : inSafeZone(level, sim.hero.pos.z), at).toBe(true);
      // Nothing is lost; the same wave never catches twice; no «Phew» for a caught hero.
      expect(atEnd, at).toEqual(before);
      expect(sim.coins, at).toBe(before.coins);
      expect(sim.gatesOpen, at).toEqual(before.gates);
      expect(log.filter((r) => r.name === 'waveSurvived'), at).toHaveLength(0);
      expect(log.filter((r) => r.name === 'waveGone'), at).toHaveLength(1);
    }
    expect(caughtInCave + caughtToCamp).toBeGreaterThanOrEqual(90);
    expect(caughtToCamp).toBeGreaterThan(0);
  });

  it('the clip: form, roll caught.rollSec, pop; the hero has no control until the end, then he can move', () => {
    const sim = createSim(level, tun, {
      balance: bal,
      speedCurve: bal.speedCurve,
      threat: { threat: { ...world1.threat }, balance: bal, avalanche: tun.avalanche, scriptedPending: false, normalWavesDone: 99 },
    });
    sim.teleport(0, level.floorYAt(600) + 0.05, 600);
    sim.threat!.trigger();
    const RUN = { moveX: 0, moveZ: 1, jump: true, jumpHeld: true };
    while (!sim.caught) sim.step(NO_INPUT, DT);
    const c = sim.caught;
    expect(c.rollSec).toBe(bal.caught.rollSec);
    expect(c.formSec + c.rollSec + c.popSec).toBeLessThanOrEqual(bal.caught.maxSec);
    const zs: number[] = [];
    while (sim.caught) {
      sim.step(RUN, DT); // input is ignored while the ball rolls
      zs.push(sim.hero.pos.z);
    }
    for (let i = 1; i < zs.length; i++) expect(zs[i]!).toBeLessThanOrEqual(zs[i - 1]! + 1e-9); // only down the slope
    const z0 = sim.hero.pos.z;
    for (let i = 0; i < 30; i++) sim.step({ moveX: 0, moveZ: -1, jump: false, jumpHeld: false }, DT);
    expect(Math.abs(sim.hero.pos.z - z0)).toBeGreaterThan(0.5);
  });
});
