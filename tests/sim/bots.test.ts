import { describe, expect, it } from 'vitest';
import { buildLevel } from '../../src/level/builder.ts';
import { createSim, type Sim } from '../../src/sim/world.ts';
import { laneIntervals } from '../../src/sim/bots.ts';
import { nearestShelter, sheltersByRunTime } from '../../src/sim/threat.ts';
import tuning from '../../content/avalanche/tuning.json' with { type: 'json' };
import balance from '../../content/avalanche/balance.json' with { type: 'json' };
import botsJson from '../../content/avalanche/bots.json' with { type: 'json' };
import worldsJson from '../../content/avalanche/worlds.json' with { type: 'json' };
import type { BalanceJson, BotsJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

const DT = 1 / 60;
const bal = balance as BalanceJson;
const tun = tuning as TuningJson;
const cfg = botsJson as unknown as BotsJson;
const world1 = (worldsJson as unknown as WorldsJson).worlds[0]!;
const level = buildLevel(world1);
const curve = { ...bal.speedCurve, base: tun.controller.baseSpeed, max: tun.controller.maxSpeed };

function botSim(seed = 7, count = cfg.count.high): Sim {
  return createSim(level, tun, {
    balance: bal,
    speedCurve: curve,
    threat: { threat: { ...world1.threat }, balance: bal, avalanche: tun.avalanche, scriptedPending: true, normalWavesDone: 0 },
    bots: { cfg, count, seed },
  });
}

/** The hero runs up the middle; the stat jumps so walls open one by one, as a playing hero would open them. */
function play(sim: Sim, sec: number, onTick: (sim: Sim) => void): void {
  for (let i = 0; i < sec * 60; i++) {
    const next = sim.gatesOpen.indexOf(false);
    if (i % (20 * 60) === 0 && next >= 0 && next < 8) sim.progress.stat = sim.gateRequirement(next);
    sim.step({ moveX: 0, moveZ: 1, jump: false, jumpHeld: false }, DT);
    onTick(sim);
  }
}

const out = (sim: Sim) => sim.bots!.list.filter((b) => b.mode !== 'away' && b.mode !== 'off');

// M2-10, GDD-15: bots on the track (docs/01-gdd.md 4.7, 7.12; docs/01a-content.md 12).
describe('bots (M2-10)', () => {
  it('6 bots with names from bots.json, never two alike on the mountain; at most spawnCampMax in the camp at the start', () => {
    const sim = botSim();
    expect(sim.bots!.list).toHaveLength(6);
    expect(sim.bots!.list.filter((b) => b.mode === 'camp').length).toBeLessThanOrEqual(cfg.spawnCampMax);
    let checks = 0;
    play(sim, 300, (s) => {
      if (s.tick % 30) return;
      const names = out(s).map((b) => b.name);
      expect(names.every((n) => cfg.names.includes(n))).toBe(true);
      expect(new Set(names).size).toBe(names.length);
      checks++;
    });
    expect(checks).toBeGreaterThan(500);
  });

  it('5 minutes: no bot above a wall closed for the hero; on warn ≥ 90% of the bots on the slope run to caves, hiders end up sheltered', () => {
    const sim = botSim();
    let worst = -Infinity;
    play(sim, 300, (s) => {
      s.level.gates.forEach((g, i) => {
        if (s.gatesOpen[i]) return;
        for (const b of out(s)) worst = Math.max(worst, b.z - g.z);
      });
    });
    expect(worst).toBeLessThan(0);
    const st = sim.bots!.stats;
    expect(st.hid + st.dawdled).toBeGreaterThan(10);
    expect(st.hid / (st.hid + st.dawdled)).toBeGreaterThanOrEqual(0.9);
    expect(st.dawdled).toBeGreaterThan(0);
    // Only dawdlers become snowballs: every bot that ran to a cave made it.
    expect(st.caught).toBeLessThanOrEqual(st.dawdled);
  });

  it('a bot left more than leashWalls stretches below the hero goes away and comes back at his flag with a new name', () => {
    const sim = botSim(3);
    sim.progress.stat = sim.gateRequirement(6);
    for (let i = 0; i < 2; i++) sim.step({ moveX: 0, moveZ: 0, jump: false, jumpHeld: false }, DT);
    const before = new Map(sim.bots!.list.map((b) => [b.index, b.name]));
    const flag = level.checkpoints[5]!;
    sim.teleport(0, flag.y + 0.05, flag.z + 2);
    for (let i = 0; i < 10; i++) sim.step({ moveX: 0, moveZ: 0, jump: false, jumpHeld: false }, DT);
    // Bots hiding from the wave the hero started stay in their cave until it is gone, then leave too.
    expect(sim.bots!.list.every((b) => b.mode === 'away' || b.mode === 'hide')).toBe(true);
    for (let i = 0; i < 70 * 60; i++) sim.step({ moveX: 0, moveZ: 0, jump: false, jumpHeld: false }, DT);
    const back = out(sim);
    expect(back.length).toBe(6);
    for (const b of back) {
      expect(b.z).toBeGreaterThan(flag.z - 1 - 60);
      expect(b.name).not.toBe(before.get(b.index));
    }
  });

  it('deterministic by the seed; low quality keeps 3 bots out', () => {
    const a = botSim(11);
    const b = botSim(11);
    play(a, 60, () => {});
    play(b, 60, () => {});
    expect(a.bots!.list.map((x) => [x.name, x.mode, x.x.toFixed(3), x.z.toFixed(3)])).toEqual(b.bots!.list.map((x) => [x.name, x.mode, x.x.toFixed(3), x.z.toFixed(3)]));
    const low = botSim(11, cfg.count.low);
    expect(low.bots!.list).toHaveLength(3);
  });

  it('lanes keep clear of the ledges; caves for bots come in the order of nearestShelter', () => {
    for (const [a, b] of laneIntervals(level)) {
      for (const box of level.boxes.filter((x) => x.kind === 'ledge')) expect(b <= box.min[0] - 1 || a >= box.max[0] + 1).toBe(true);
    }
    const open = level.gates.map((_, i) => i < 3);
    for (const z of [60, 150, 250, 300]) {
      expect(sheltersByRunTime(level, open, 0, z)[0]).toBe(nearestShelter(level, open, 0, z));
      // Never a cave behind a closed wall.
      for (const c of sheltersByRunTime(level, open, 0, z)) expect(level.niches[c]!.z).toBeLessThan(level.gates[3]!.z);
    }
  });
});
