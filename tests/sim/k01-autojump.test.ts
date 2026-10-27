import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HeroInput } from '../../src/sim/controller.ts';
import { createSim, type Sim } from '../../src/sim/world.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { levelThreshold } from '../../src/sim/levels.ts';
import type { BalanceJson, GameJson, TuningJson, World, WorldsJson } from '../../src/content/types.ts';

// K-01 (Q-D20-2, staff: a child who holds only forward fell at the shore 94–106 times in 4 minutes): on the plates and
// cracks of a mountain with `autoJump` a run off the edge jumps by itself — the reach still by the level (LV-03 below).
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const tuning = mergePatch(read('tuning.json'), read('pace/stages/tuning.json')) as unknown as TuningJson;
const balance = mergePatch(read('balance.json'), read('pace/stages/balance.json')) as unknown as BalanceJson;
const game = read('game.json') as GameJson;
const worlds = read('pace/stages/worlds.json') as WorldsJson;
const DT = 1 / 60;
const UP: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };
const w1 = worlds.worlds.find((w) => w.index === 1)!;

function simAt(w: World, stat: number, waves = false): Sim {
  return createSim(buildLevel(w), tuning, {
    balance,
    speedCurve: balance.speedCurve,
    stat,
    ...(waves ? { threat: { threat: { ...w.threat }, balance, avalanche: tuning.avalanche, scriptedPending: false, normalWavesDone: 99 } } : {}),
    ...(game.threat.boss ? { boss: game.threat.boss } : {}),
  });
}

/** Forward only from the start of stage n at `below` levels under it: the falls until past its end (or 60 s). */
function forwardOnly(w: World, n: number, below = 0): { falls: number; passed: boolean; sec: number } {
  const st = w.stages!.find((s) => s.n === n)!;
  const sim = simAt(w, levelThreshold(st.level - below, balance.levels!));
  const at = sim.stageStart(n);
  sim.teleport(at.x, at.y + 0.05, at.z);
  let falls = 0;
  sim.events.on('fall', () => falls++);
  let k = 0;
  for (; k < 60 / DT && sim.hero.pos.z < st.end + 2; k++) sim.step(UP, DT);
  return { falls, passed: sim.hero.pos.z >= st.end + 2, sec: k * DT };
}

describe('K-01 · auto-jump at the edge of plates and cracks (mountain 1)', () => {
  it('the flag is in the data: on the plates and cracks of mountain 1, not on mountain 2', () => {
    const typed = (w: World): boolean[] => w.stages!.filter((s) => s.type === 'plates' || s.type === 'cracks').map((s) => s.autoJump === true);
    expect(typed(w1).length).toBeGreaterThan(0);
    expect(typed(w1).every(Boolean)).toBe(true);
    expect(typed(worlds.worlds[1]!).some(Boolean)).toBe(false);
  });

  it('forward only at the level of stage 5 (plates): past it with at most 3 falls', () => {
    const r = forwardOnly(w1, 5);
    expect(r.passed, JSON.stringify(r)).toBe(true);
    expect(r.falls, JSON.stringify(r)).toBeLessThanOrEqual(3);
  });

  it('forward only at the level of stage 7 (cracks): past it with at most 3 falls', () => {
    const r = forwardOnly(w1, 7);
    expect(r.passed, JSON.stringify(r)).toBe(true);
    expect(r.falls, JSON.stringify(r)).toBeLessThanOrEqual(3);
  });

  it('the reach is still by the level: two levels below, forward only does not get past the plates of stage 5', () => {
    const r = forwardOnly(w1, 5, 2);
    expect(r.passed, JSON.stringify(r)).toBe(false);
  });
});
