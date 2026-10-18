import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HeroInput } from '../../src/sim/controller.ts';
import { createSim, type Sim } from '../../src/sim/world.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { levelOf, levelThreshold } from '../../src/sim/levels.ts';
import type { BalanceJson, GameJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

// MU-11 (docs/briefs/mu-mobile-ui.md): the giant is the same hunt at every meeting — the second and later ones in the same
// run (after a slap or a pass) and in a new run. «Hold forward» on the stick is caught every time while the hero is less
// than 4 levels above the stage (every try adds Speed; on mountain 1, where levels are cheap, 4 above comes in a few tries
// — from there a straight run slips past him, docs/01-gdd.md 23.9). Before the fix the giant waited at the bottom of his
// patrol after a meeting and gave the hero up at once, and one level above a straight run slipped past.
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const tuning = mergePatch(read('tuning.json'), read('pace/stages/tuning.json')) as unknown as TuningJson;
const balance = mergePatch(read('balance.json'), read('pace/stages/balance.json')) as unknown as BalanceJson;
const game = read('game.json') as GameJson;
const worlds = read('pace/stages/worlds.json') as WorldsJson;
const DT = 1 / 60;
const STILL: HeroInput = { moveX: 0, moveZ: 0, jump: false, jumpHeld: false };
const FORWARD: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };

for (const mi of [0, 1, 4, 9]) {
  const w = worlds.worlds[mi]!;
  const st = w.stages!.find((s) => s.type === 'giant')!;
  const level = buildLevel(w);
  const make = (): Sim =>
    createSim(level, tuning, { balance, speedCurve: balance.speedCurve, stat: levelThreshold(st.level, balance.levels!), ...(game.threat.boss ? { boss: game.threat.boss } : {}) });
  /** From the start of the giant's stage (after `wait` s standing there) hold forward: caught, or over the zone's end. */
  const forward = (sim: Sim, wait = 0): 'caught' | 'pass' | 'time' => {
    const at = sim.stageStart(st.n);
    sim.teleport(at.x, at.y + 0.05, at.z);
    for (let k = 0; k < wait / DT; k++) sim.step(STILL, DT);
    const zone = sim.boss!.zones.find((z) => z.zone[0] >= st.start - 1e-6)!;
    for (let k = 0; k < 40 / DT; k++) {
      if (sim.caught) {
        for (let j = 0; j < 600 && sim.caught; j++) sim.step(STILL, DT);
        return 'caught';
      }
      if (sim.hero.pos.z > zone.zone[1] + 2) return 'pass';
      sim.step(FORWARD, DT);
    }
    return 'time';
  };
  describe(`MU-11 mountain ${mi + 1}: forward is caught at every meeting`, () => {
    const above = (sim: Sim): number => levelOf(sim.progress.stat, balance.levels!) - st.level;
    it('slapped, then again and again in the same run', () => {
      const sim = make();
      // A different wait before each try: the giant meets the hero from any point of his patrol.
      let tries = 0;
      for (const wait of [0, 0, 1.3, 2.7, 4.1, 0.6]) {
        const lv = above(sim);
        if (lv >= 4) break;
        expect(forward(sim, wait), `try ${tries + 1}, wait ${wait}, ${lv} levels above`).toBe('caught');
        tries++;
      }
      expect(tries, 'meetings in a row').toBeGreaterThanOrEqual(2);
    }, 60_000);
    it('passed, then a new run from the camp: caught', () => {
      const sim = make();
      const zone = sim.boss!.zones[0]!;
      sim.teleport(0, st.y + 0.05, zone.zone[0] + 2);
      sim.step(STILL, DT);
      sim.teleport(0, st.y + 0.05, zone.zone[1] + 3);
      for (let k = 0; k < 30; k++) sim.step(STILL, DT);
      expect(zone.hero).toBe('passed');
      const camp = sim.stageStart(1);
      sim.teleport(camp.x, camp.y + 0.05, camp.z);
      for (let k = 0; k < 60; k++) sim.step(STILL, DT);
      for (const wait of [0, 2]) {
        const lv = above(sim);
        if (lv < 4) expect(forward(sim, wait), `wait ${wait}, ${lv} levels above`).toBe('caught');
      }
    }, 60_000);
  });
}
