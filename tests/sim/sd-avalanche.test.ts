import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSim } from '../../src/sim/world.ts';
import { NO_INPUT } from '../../src/sim/controller.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { levelThreshold } from '../../src/sim/levels.ts';
import type { BalanceJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

// SD-06 (docs/01-gdd.md 23.6): the avalanche on every stage but the giant's — a slow hero is warned, the grotto of the
// start pad saves, the safe finish is out of its reach.
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const tuning = mergePatch(read('tuning.json'), read('pace/stages/tuning.json')) as unknown as TuningJson;
const balance = mergePatch(read('balance.json'), read('pace/stages/balance.json')) as unknown as BalanceJson;
const worlds = read('pace/stages/worlds.json') as WorldsJson;
const DT = 1 / 60;

describe('the avalanche on the stages (SD-06)', () => {
  it('every stage but the giant, the maze and the first minute has its zone and a grotto', () => {
    for (const w of worlds.worlds)
      for (const st of w.stages!) {
        const zone = (w.threat.zones ?? []).find((z) => z[0] >= st.z0 - 1e-6 && z[1] <= st.end + 1e-6);
        if (st.type === 'giant' || st.type === 'intro' || st.type === 'maze') expect(zone, `${w.id} ${st.n}`).toBeUndefined();
        else {
          expect(zone, `${w.id} ${st.n}`).toBeDefined();
          expect(w.segments.some((s) => s.type === 'island' && s.z >= st.z0 && s.z <= st.end), `${w.id} ${st.n}`).toBe(true);
        }
      }
  });

  for (const hide of [false, true])
    it(`mountain 1, stage 3: standing still the wave comes; ${hide ? 'in the grotto of the start — saved' : 'on the body — snowed in'}`, () => {
      const w = worlds.worlds[0]!;
      const st = w.stages!.find((s) => s.n === 3)!;
      const level = buildLevel(w);
      const sim = createSim(level, tuning, {
        balance,
        speedCurve: balance.speedCurve,
        stat: levelThreshold(st.level, balance.levels!),
        threat: { threat: { ...w.threat }, balance, avalanche: tuning.avalanche, scriptedPending: false, normalWavesDone: 99 },
      });
      const n = level.niches.find((x) => x.kind === 'island' && x.z >= st.z0 && x.z <= st.end)!;
      const [x, z] = hide ? [(n.box.min[0] + n.box.max[0]) / 2, (n.box.min[2] + n.box.max[2]) / 2] : [0, st.start + 10];
      sim.teleport(x, level.floorAt(x, z) + 0.05, z);
      const out: string[] = [];
      for (const e of ['waveWarn', 'waveSurvived', 'waveCaught']) sim.events.on(e, () => void out.push(e));
      const zone = w.threat.zones!.find((q) => q[0] >= st.z0 - 1e-6 && q[1] <= st.end + 1e-6)!;
      for (let i = 0; i < (zone[2]! + 30) / DT && !out.some((e) => e !== 'waveWarn'); i++) sim.step(NO_INPUT, DT);
      expect(out[0]).toBe('waveWarn');
      expect(out[1]).toBe(hide ? 'waveSurvived' : 'waveCaught');
    });

  it('SD-11 (Q-088): the grottos of the stages are through — no back wall, out up the slope', () => {
    const w = worlds.worlds[0]!;
    const level = buildLevel(w);
    const through = w.segments.filter((s) => s.type === 'island' && s['through'] === true);
    expect(through.length).toBeGreaterThan(0);
    for (const r of through) {
      const z1 = r.z + (r['size'] as number) / 2;
      const back = level.boxes.filter((b) => b.kind === 'islandWall' && Math.abs(b.max[2] - z1) < 1e-6 && b.min[0] > (r['x'] as number) - (r['size'] as number) / 2 + 0.5 && b.max[0] < (r['x'] as number) + (r['size'] as number) / 2 - 0.5);
      expect(back, `island at z ${r.z}`).toEqual([]);
    }
  });
});
