import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HeroInput } from '../../src/sim/controller.ts';
import { createSim } from '../../src/sim/world.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import type { BalanceJson, GameJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

// R-03 («Лавина 23», pass 21: 2 of 2 runs without shoes): the first wave sends the hero «Under the roof!» of the ridge of
// stage 4 (the wall «13»); his steps under it bring the Speed to the number — the wall stayed shut while the wave runs,
// so he is not let out into it: «Phew!», not «Into a cave when it comes!». It opens as the wave is gone.
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const tuning = mergePatch(read('tuning.json'), read('pace/stages/tuning.json')) as unknown as TuningJson;
const balance = mergePatch(read('balance.json'), read('pace/stages/balance.json')) as unknown as BalanceJson;
const game = read('game.json') as GameJson;
const worlds = read('pace/stages/worlds.json') as WorldsJson;
const DT = 1 / 60;
const w1 = worlds.worlds.find((w) => w.index === 1)!;

describe('R-03 · the wall «13» stays shut while the wave runs to its canopy', () => {
  for (const [x, dz] of [[0, 30], [1, 34]] as const)
    it(`a newbie at x ${x} ${dz} under the ridge of stage 4, the belt brings the number while the wave runs: the wall stays shut, made it, it opens after`, () => {
      const sim = createSim(buildLevel(w1), tuning, {
        balance,
        speedCurve: balance.speedCurve,
        stat: 0,
        threat: { threat: { ...w1.threat }, balance, avalanche: tuning.avalanche, scriptedPending: true, normalWavesDone: 0 },
        ...(game.threat.boss ? { boss: game.threat.boss } : {}),
      });
      const gi = sim.level.gates.findIndex((g) => Math.abs(g.z - w1.stages!.find((s) => s.n === 4)!.z0) < 1);
      const gate = sim.level.gates[gi]!;
      const need = sim.gateRequirement(gi);
      const z = gate.z - dz;
      sim.teleport(x, sim.level.floorAt(x, z) + 0.05, z);
      sim.progress.stat = need * 0.9;
      const log: string[] = [];
      let shelter = -1;
      sim.events.on('waveWarn', (e) => {
        shelter = (e as { shelter: number }).shelter;
        log.push('warn');
      });
      sim.events.on('waveSurvived', () => log.push('survived'));
      sim.events.on('waveDusted', () => log.push('dusted'));
      sim.events.on('gateOpen', (e) => {
        if ((e as { index: number }).index === gi) log.push(`open@${sim.threat!.state.phase}`);
      });
      const stand: HeroInput = { moveX: 0, moveZ: 0, jump: false, jumpHeld: false };
      for (let k = 0; k < 120 / DT && !log.includes('warn'); k++) sim.step(stand, DT);
      expect(log[0], 'warned').toBe('warn');
      expect(sim.level.niches[shelter]!.canopy, 'to the canopy of that ridge').toBe(true);
      // Holding forward at the wall the whole wave; Speed reaches the number on the way.
      const fwd: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };
      for (let k = 0; k < 40 / DT && sim.threat!.state.phase !== 'gone' && sim.threat!.state.phase !== 'idle'; k++) {
        sim.step(fwd, DT);
      }
      const st = sim.threat!.state;
      const info = `${log.join(',')} ${st.phase} ${st.outcome} z ${sim.hero.pos.z.toFixed(1)} stat ${sim.progress.stat.toFixed(0)} of ${need.toFixed(0)}`;
      expect(log, info).not.toContain('dusted');
      expect(['safe', 'survived'], info).toContain(st.outcome);
      expect(log.some((e) => e === 'open@warn' || e === 'open@run'), `the wall shut through the wave: ${info}`).toBe(false);
      expect(sim.progress.stat, `the belt brought the number meanwhile: ${info}`).toBeGreaterThanOrEqual(need);
      expect(sim.hero.pos.z, info).toBeLessThan(gate.z);
      for (let k = 0; k < 5 / DT && !log.some((e) => e.startsWith('open')); k++) sim.step(fwd, DT);
      expect(log.some((e) => e.startsWith('open')), 'the wall opens once the wave is gone').toBe(true);
    });
});
