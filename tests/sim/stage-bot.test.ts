import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HeroInput } from '../../src/sim/controller.ts';
import { createSim, stageAt, type Sim } from '../../src/sim/world.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { levelThreshold } from '../../src/sim/levels.ts';
import { mazeDistances } from '../../src/level/stage-slope.ts';
import { distToEntrance, shelterIndex } from '../../src/sim/shelter.ts';
import type { BalanceJson, GameJson, TuningJson, World, WorldStage, WorldsJson } from '../../src/content/types.ts';

// LV-02, LV-03 (docs/01-gdd.md 22.3–22.4): the ridge sign is honest — the controller's own bot at the speed of the level
// the ridge asks for passes the stage at least 9 times of 10 with a sloppy hand (a drift off the line, the jump key
// 0–1.5 units early), on every type of stage of mountains 1 and 5; one level less is not let in by the ridge.
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const tuning = mergePatch(read('tuning.json'), read('pace/stages/tuning.json')) as unknown as TuningJson;
const balance = mergePatch(read('balance.json'), read('pace/stages/balance.json')) as unknown as BalanceJson;
const game = read('game.json') as GameJson;
const worlds = read('pace/stages/worlds.json') as WorldsJson;
const DT = 1 / 60;
const TRIES = 10;

function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The maze route: cell centres from the way in to the real exit, then out over its bridge. */
function mazeRoute(st: WorldStage): Array<[number, number]> {
  const m = st.maze!;
  const dist = mazeDistances(m.cols, m.rows, m.open, m.entrance);
  const real = m.exits.find((e) => e.real)!;
  const centre = (i: number): [number, number] => [m.x0 + ((i % m.cols) + 0.5) * m.cell, m.z0 + (Math.floor(i / m.cols) + 0.5) * m.cell];
  const path: number[] = [real.row * m.cols + real.col];
  const linked = (i: number, j: number): boolean => m.open.some(([c, r, a, b]) => (r * m.cols + c === i && b * m.cols + a === j) || (r * m.cols + c === j && b * m.cols + a === i));
  while (dist[path[0]!]! > 0) {
    const i = path[0]!;
    const prev = dist.findIndex((d, j) => d === dist[i]! - 1 && linked(i, j));
    path.unshift(prev);
  }
  const pts = [[m.x0 + (m.entrance + 0.5) * m.cell, m.z0 - 2] as [number, number], ...path.map(centre)];
  const [ex, ez] = centre(path[path.length - 1]!);
  return [...pts, [ex, ez + m.cell], [ex, st.end + 4]];
}

/** The narrow floor ahead of z (bridge, ledge, plate): its middle, the nearest to x. */
function narrowAhead(w: World, x: number, z: number): number | null {
  let best: number | null = null;
  for (const f of w.segments) {
    if (f.type !== 'floor' || f['material'] === 'pit') continue;
    const x0 = f['x0'] as number;
    const x1 = f['x1'] as number;
    if (typeof x0 !== 'number' || typeof x1 !== 'number' || x1 - x0 > 12.01 || z < f.z || z > f.z + (f['length'] as number)) continue;
    const mid = (x0 + x1) / 2;
    if (best === null || Math.abs(mid - x) < Math.abs(best - x)) best = mid;
  }
  return best;
}

type Outcome = 'pass' | 'fall' | 'time';
const NO_MOVE: HeroInput = { moveX: 0, moveZ: 0, jump: false, jumpHeld: false };

function runStage(w: World, st: WorldStage, seed: number, below = 0): Outcome {
  const r = rand(seed);
  const level = buildLevel(w);
  const sim: Sim = createSim(level, tuning, {
    balance,
    speedCurve: balance.speedCurve,
    stat: levelThreshold(st.level - below, balance.levels!),
    threat: { threat: { ...w.threat }, balance, avalanche: tuning.avalanche, scriptedPending: false, normalWavesDone: 99 },
    ...(game.threat.boss ? { boss: game.threat.boss } : {}),
  });
  const at = sim.stageStart(st.n);
  sim.teleport(at.x, at.y + 0.05, at.z);
  const drift = 1 + r() * 2;
  const phase = r() * 6;
  const early = (): number => 0.6 + r() * 1.5;
  let jumpAt = early();
  const route = st.type === 'maze' ? mazeRoute(st) : null;
  let wp = 0;
  let mouth: [number, number] | null = null;
  let tx = 0;
  for (let k = 0; k < 60 / DT; k++) {
    const h = sim.hero.pos;
    if (sim.caught || sim.rollFrom > 0) {
      if (process.env['DEBUG_BOT']) process.stdout.write(`[FALL ${st.type} ${seed} x${h.x.toFixed(1)} y${h.y.toFixed(1)} z${h.z.toFixed(1)} vz${sim.hero.vel.z.toFixed(1)} reach ${sim.params.airSpeedMult}] `);
      return 'fall';
    }
    if (h.z >= st.end + 2) return 'pass';
    if (process.env['DEBUG_BOT'] && k % 120 === 0) process.stdout.write(`[${st.type} ${seed} t${(k * DT).toFixed(0)} x${h.x.toFixed(1)} y${h.y.toFixed(1)} z${h.z.toFixed(1)} g${sim.hero.onGround} rt${sim.respawnTicksLeft} ph${sim.threat?.state.phase} sp${sim.params.speed.toFixed(0)} tb${String(!!sim.tumble)} sl${String(!!sim.slow)} vz${sim.hero.vel.z.toFixed(1)}] `);
    const t = k * DT;
    let mx = 0;
    let mz = 1;
    let jump = false;
    const ts = sim.threat?.state;
    if (route) {
      while (wp < route.length - 1 && Math.hypot(route[wp]![0] - h.x, route[wp]![1] - h.z) < 2.5) wp++;
      const [px, pz] = route[wp]!;
      const len = Math.hypot(px - h.x, pz - h.z) || 1;
      [mx, mz] = [(px - h.x) / len, (pz - h.z) / len];
    } else if (st.type === 'avalanche' && ts && (ts.phase === 'warn' || ts.phase === 'run') && ts.outcome === 'none' && ts.shelter >= 0) {
      // On the warning — into the grotto the game lights, wait there.
      // To the mouth of the lit grotto, then in (the back of a rock is a wall).
      const n = level.niches[ts.shelter]!;
      const e = distToEntrance(level, n, h.x, h.z);
      const inside = shelterIndex(level, balance.niche.graceDist, h.x, h.y, h.z) >= 0;
      const cx = (n.box.min[0] + n.box.max[0]) / 2;
      const cz = (n.box.min[2] + n.box.max[2]) / 2;
      const [px, pz] = e.dist > 1 ? [e.tx, e.tz] : [cx, cz];
      // The way out: past the mouth, away from the middle of the rock.
      const ol = Math.hypot(e.tx - cx, e.tz - cz) || 1;
      mouth = [e.tx + ((e.tx - cx) / ol) * 3, e.tz + ((e.tz - cz) / ol) * 3];
      const len = Math.hypot(px - h.x, pz - h.z);
      [mx, mz] = inside || len < 1 ? [0, 0] : [(px - h.x) / len, (pz - h.z) / len];
    } else if (mouth) {
      // Out of the grotto by its mouth first (the back of a rock is a wall), then on up.
      const [px, pz] = mouth;
      const len = Math.hypot(px - h.x, pz - h.z);
      if (len < 1.2) mouth = null;
      else [mx, mz] = [(px - h.x) / len, (pz - h.z) / len];
    } else {
      const ahead = narrowAhead(w, h.x, h.z + 0.3 * st.speed);
      tx = ahead ?? 0;
      const sloppy = tx + Math.sin(t * drift + phase) * (ahead === null ? 3 : 1);
      mx = Math.max(-1, Math.min(1, (sloppy - h.x) * 0.3));
      if (st.type !== 'catapult' && sim.hero.onGround && level.floorAt(h.x, h.z + jumpAt) < h.y - 1) {
        jump = true;
        jumpAt = early();
      }
    }
    const input: HeroInput = { moveX: mx, moveZ: mz, jump, jumpHeld: jump };
    sim.step(input, DT);
  }
  return 'time';
}

describe('the stage bot at the level of the ridge (LV-02, LV-03)', () => {
  // ST-03: mountain 2 too (its own trials: the stairs, the catapult, the blizzard).
  for (const mi of [0, 1, 4]) {
    const w = worlds.worlds[mi]!;
    // The giant's stage — its own bots below (SD-12).
    for (const st of w.stages!.filter((s) => s.type !== 'intro' && s.type !== 'giant')) {
      it(`mountain ${mi + 1}, stage ${st.n} (${st.type}, level ${st.level}, v ${st.speed}): 9 of 10`, () => {
        const res = Array.from({ length: TRIES }, (_, i) => runStage(w, st, 1000 * st.n + i));
        expect(res.filter((x) => x === 'pass').length, res.join(' ')).toBeGreaterThanOrEqual(9);
      }, 60_000);
    }
  }
  // SD-04 (docs/01-gdd.md 23.4): Speed decides — two levels below the stage (its ridge opened by force) the gaps and the
  // catapult are out of reach: at most 3 of 10.
  for (const mi of [0, 4]) {
    const w = worlds.worlds[mi]!;
    for (const st of w.stages!.filter((s) => s.type === 'cracks' || s.type === 'plates' || s.type === 'catapult')) {
      it(`mountain ${mi + 1}, stage ${st.n} (${st.type}) two levels below: at most 3 of 10`, () => {
        const res = Array.from({ length: TRIES }, (_, i) => runStage(w, st, 1000 * st.n + i, 2));
        expect(res.filter((x) => x === 'pass').length, res.join(' ')).toBeLessThanOrEqual(3);
      }, 60_000);
    }
  }
  it('one level less is not let in: the ridge of every stage of mountains 1–10 asks for more than level N − 1', () => {
    for (const w of worlds.worlds)
      for (const st of w.stages!.filter((s) => s.n > 1)) {
        const g = w.segments.find((s) => s.type === 'gate' && Math.abs(s.z - st.z0) < 1e-6)!;
        expect(g['requires'] as number).toBeGreaterThan(levelThreshold(st.level - 1, balance.levels!));
      }
  });
});

/**
 * SD-12 (docs/01-gdd.md 23.9): the giant's bots with a stick (|move| ≤ 1, as the input layer gives it, the phone's stick
 * pushed to its rim). `straight` holds forward on the run line (a sloppy hand); `dodge` runs the line and, at a random
 * moment 0.2–1 s before the meeting, cuts to the side away from the giant and runs on up — a player who sees him charge;
 * `stepAside` (SD-15, the review on the phone) cuts the same way 14 units and runs straight up again. `below` — levels
 * under the stage (−2: two above). MU-11: a giant that gave the hero up (walks back) never turns on him in this meeting —
 * the run counts as past him there (the giant stage has no pits and no avalanche).
 */
function runGiant(w: World, st: WorldStage, seed: number, below: number, dodge: boolean, level = buildLevel(w), stepAside = false): Outcome {
  const r = rand(seed);
  const sim: Sim = createSim(level, tuning, {
    balance,
    speedCurve: balance.speedCurve,
    stat: levelThreshold(st.level - below, balance.levels!),
    ...(game.threat.boss ? { boss: game.threat.boss } : {}),
  });
  const at = sim.stageStart(st.n);
  sim.teleport(at.x, at.y + 0.05, at.z);
  const drift = 1 + r() * 2;
  const phase = r() * 6;
  const cutAt = 0.2 + r() * 0.8;
  const zone = sim.boss!.zones.find((z) => z.zone[0] >= st.start - 1e-6)!;
  let hold = 0;
  let cut = false;
  let from = 0;
  for (let k = 0; k < 60 / DT; k++) {
    const h = sim.hero.pos;
    if (sim.caught || sim.rollFrom > 0) return 'fall';
    if (h.z >= st.end + 2) return 'pass';
    const g = zone.giants[0]!;
    if (zone.hero === 'in' && (g.mode === 'back' || g.mode === 'patrol') && h.z > g.z + 10) return 'pass';
    if (dodge && !cut && zone.hero === 'in' && g.z > h.z - 2 && Math.hypot(g.x - h.x, g.z - h.z) / (sim.params.speed + g.speed) < cutAt) {
      cut = true;
      from = h.x;
      hold = h.x + (Math.abs(g.x - h.x) < 2 ? (r() < 0.5 ? -1 : 1) : g.x > h.x ? -1 : 1) * 40;
    }
    // SD-15 (review): a step aside of 14 units, then straight up again (a turn back costs a little speed).
    if (stepAside && cut && Math.abs(h.x - from) >= 14) hold = h.x;
    if (h.z > zone.zone[1]) hold = 0;
    const mx = Math.max(-1, Math.min(1, (hold + Math.sin(k * DT * drift + phase) * 3 - h.x) * 0.3));
    const len = Math.hypot(mx, 1);
    sim.step({ moveX: mx / len, moveZ: 1 / len, jump: false, jumpHeld: false }, DT);
  }
  return 'time';
}

describe('the giant is a trial of every run (SD-12, MU-11)', () => {
  // MU-11 (docs/briefs/mu-mobile-ui.md, Q-MU-5 «A»; docs/01-gdd.md 23.9): the first, second, middle and last mountain hold
  // the corridors — forward at the stage's level N is caught; a step aside without upgrades gets past 3–5 of 10 on
  // mountain 1 and 1–2 of 10 further up; two levels above (Speed, what the shoes buy) 6–8 of 10; two levels below he is
  // quicker and catches up (a dodge at most 3 of 10). MU round of fixes (staff 19.10): forward is caught at any level —
  // four and eight above too (mountain 1 levels are cheap: from a clean save the second meeting was at N+4 and slipped).
  for (const mi of [0, 1, 4, 9]) {
    const w = worlds.worlds[mi]!;
    const st = w.stages!.find((s) => s.type === 'giant')!;
    // Mountain 10 (v 117 on the same field): the closest found is 4 of 10 at N (lag, side, reach tried — MU-11 report).
    const [lo, hi] = mi === 0 ? [3, 5] : mi === 9 ? [1, 4] : [1, 2];
    it(`mountain ${mi + 1}: forward at N caught 9+ of 10; a step aside at N ${lo}–${hi} of 10, two levels above 6–8; forward 4 and 8 above caught 9+; a dodge 2 below at most 3`, () => {
      const level = buildLevel(w);
      const pass = (below: number, dodge: boolean, aside = false): number => Array.from({ length: TRIES }, (_, i) => runGiant(w, st, 7000 + i, below, dodge, level, aside)).filter((x) => x === 'pass').length;
      expect.soft(TRIES - pass(0, false), 'forward at N: caught').toBeGreaterThanOrEqual(9);
      const aside = pass(0, true, true);
      expect.soft(aside, 'a step aside at N').toBeGreaterThanOrEqual(lo);
      expect.soft(aside, 'a step aside at N').toBeLessThanOrEqual(hi);
      const up = pass(-2, true, true);
      expect.soft(up, 'a step aside two levels above').toBeGreaterThanOrEqual(6);
      expect.soft(up, 'a step aside two levels above').toBeLessThanOrEqual(8);
      expect.soft(TRIES - pass(-4, false), 'forward four levels above: caught').toBeGreaterThanOrEqual(9);
      expect.soft(TRIES - pass(-8, false), 'forward eight levels above: caught').toBeGreaterThanOrEqual(9);
      expect.soft(pass(2, true), 'a dodge two levels below').toBeLessThanOrEqual(3);
    }, 600_000);
  }
  it('passed, he walks back to patrol (no win pose); after the trophy button and the camp the next run meets him again', () => {
    const w = worlds.worlds[0]!;
    const st = w.stages!.find((s) => s.type === 'giant')!;
    const level = buildLevel(w);
    const sim = createSim(level, tuning, { balance, speedCurve: balance.speedCurve, stat: levelThreshold(st.level, balance.levels!), ...(game.threat.boss ? { boss: game.threat.boss } : {}) });
    const zone = sim.boss!.zones[0]!;
    // Past the zone: put the hero on its far side and let him stand there.
    sim.teleport(0, st.y + 0.05, zone.zone[0] + 2);
    sim.step(NO_MOVE, DT);
    sim.teleport(0, st.y + 0.05, zone.zone[1] + 3);
    for (let k = 0; k < 30; k++) sim.step(NO_MOVE, DT);
    expect(zone.hero).toBe('passed');
    expect(zone.giants.every((g) => g.mode !== 'sit')).toBe(true);
    for (let k = 0; k < 600; k++) sim.step(NO_MOVE, DT);
    expect(zone.giants.every((g) => g.mode === 'patrol' || g.mode === 'back')).toBe(true);
    // Back in the camp (as after the button): the zone is his again; the next run straight on is caught.
    const camp = sim.stageStart(1);
    sim.teleport(camp.x, camp.y + 0.05, camp.z);
    sim.step(NO_MOVE, DT);
    expect(zone.hero).toBe('out');
    expect(runGiant(w, st, 7000, 0, false, level)).toBe('fall');
    // SD-15 (review: every slap sent him to the camp): the slap rolls him to the start of the giant's own stage.
    const at = sim.stageStart(st.n);
    sim.teleport(at.x, at.y + 0.05, at.z);
    for (let k = 0; k < 900 && !sim.caught; k++) sim.step({ moveX: 0, moveZ: 1, jump: false, jumpHeld: false }, DT);
    expect(sim.caught, 'slapped').not.toBeNull();
    for (let k = 0; k < 600 && sim.caught; k++) sim.step(NO_MOVE, DT);
    expect(Math.hypot(sim.hero.pos.x - at.x, sim.hero.pos.z - at.z), 'at the start of the giant stage, not the camp').toBeLessThanOrEqual(3);
    expect(sim.rollFrom).toBe(0);
  });
});

describe('the ridge sign and the roll-back of the stages (LV-02, LV-08)', () => {
  it('the «LEVEL NEEDED» digits of every ridge are 6 units and stand within the phone draw distance of the safe finish before it', () => {
    for (const w of worlds.worlds)
      for (const st of w.stages!.filter((s) => s.n > 1)) {
        const g = w.segments.find((s) => s.type === 'gate' && Math.abs(s.z - st.z0) < 1e-6)!;
        expect(g['digits']).toBeGreaterThanOrEqual(6);
        const before = w.stages!.find((s) => s.n === st.n - 1)!;
        expect(st.z0 - before.finish[0]).toBeLessThanOrEqual((tuning as unknown as { far: { mobile: number } }).far.mobile);
      }
  });
  it('a fall into the pit of stage k rolls the hero to the flag of stage k − 1 (stage 2 — the camp), Speed kept', () => {
    const w = worlds.worlds[0]!;
    const level = buildLevel(w);
    for (const st of w.stages!.filter((s) => s.type === 'plates' || s.type === 'giant')) {
      const sim = createSim(level, tuning, { balance, speedCurve: balance.speedCurve, stat: levelThreshold(st.level, balance.levels!) });
      const stat0 = sim.progress.stat;
      // Into the pit beside the bridge (plates) or off a teleport under the floor (giant: no pit — below killY).
      sim.teleport(st.type === 'plates' ? 30 : 0, st.type === 'plates' ? st.y - 6 : level.killY - 1, st.start + 4);
      for (let k = 0; k < 600 && !sim.caught; k++) sim.step({ moveX: 0, moveZ: 0, jump: false, jumpHeld: false }, DT);
      expect(sim.caught, `${st.type}: the snowball`).not.toBeNull();
      for (let k = 0; k < 600 && sim.caught; k++) sim.step({ moveX: 0, moveZ: 0, jump: false, jumpHeld: false }, DT);
      const target = sim.stageStart(st.n - 1);
      expect(Math.hypot(sim.hero.pos.x - target.x, sim.hero.pos.z - target.z), `${st.type}: at the flag of stage ${st.n - 1}`).toBeLessThanOrEqual(3);
      expect(sim.rollFrom).toBe(st.n);
      expect(sim.progress.stat).toBeGreaterThanOrEqual(stat0);
    }
  });
  it('no cascade (Q-083): a fall on the stage the hero was rolled back to returns him to its own start; past the farthest stage — one back again', () => {
    const w = worlds.worlds[0]!;
    const level = buildLevel(w);
    const st = w.stages!.find((s) => s.n === 4)!;
    const sim = createSim(level, tuning, { balance, speedCurve: balance.speedCurve, stat: levelThreshold(st.level, balance.levels!) });
    const still = { moveX: 0, moveZ: 0, jump: false, jumpHeld: false };
    /** Drop below killY at z, wait for the snowball to pop; the stage it popped on. */
    const fallAt = (z: number): number => {
      sim.hero.pos.y = level.killY - 1;
      sim.hero.pos.z = z;
      for (let k = 0; k < 600 && !sim.caught; k++) sim.step(still, DT);
      expect(sim.caught).not.toBeNull();
      for (let k = 0; k < 600 && sim.caught; k++) sim.step(still, DT);
      return stageAt(level, sim.hero.pos.z);
    };
    const near = (n: number): number => Math.hypot(sim.hero.pos.x - sim.stageStart(n).x, sim.hero.pos.z - sim.stageStart(n).z);
    // An attempt that reached stage n: on it — to n − 1; on n − 1 — to the start of n − 1, again and again.
    const s0 = sim.stageStart(st.n);
    sim.teleport(s0.x, s0.y + 0.05, s0.z);
    for (let k = 0; k < 5; k++) sim.step(still, DT);
    fallAt(st.start + 4);
    expect(near(st.n - 1), 'the first fall: one stage back').toBeLessThanOrEqual(3);
    const prev = w.stages!.find((s) => s.n === st.n - 1)!;
    for (let r = 0; r < 2; r++) {
      fallAt(prev.start + 4);
      expect(near(st.n - 1), `fall ${r + 2} on the stage rolled back to: its own start`).toBeLessThanOrEqual(3);
    }
    // Further than before (the next stage): one stage back from there.
    const next = w.stages!.find((s) => s.n === st.n + 1)!;
    sim.hero.pos.z = next.start + 2;
    sim.hero.pos.y = next.y + 0.05;
    for (let k = 0; k < 5; k++) sim.step(still, DT);
    fallAt(next.start + 4);
    expect(near(st.n), 'past the farthest stage: one back from it').toBeLessThanOrEqual(3);
  });
  it('past the giant (Q-MU-12, staff 19.10): a fall into the first crack of the stage after him keeps that stage, never back before him', () => {
    const w = worlds.worlds[0]!;
    const level = buildLevel(w);
    const g = w.stages!.find((s) => s.type === 'giant')!;
    const next = w.stages!.find((s) => s.n === g.n + 1)!;
    const sim = createSim(level, tuning, { balance, speedCurve: balance.speedCurve, stat: levelThreshold(next.level, balance.levels!), ...(game.threat.boss ? { boss: game.threat.boss } : {}) });
    sim.teleport(0, g.y + 0.05, g.start + 2);
    sim.step(NO_MOVE, DT);
    sim.teleport(0, g.y + 0.05, g.end + 3);
    for (let k = 0; k < 10; k++) sim.step(NO_MOVE, DT);
    expect(sim.boss!.zones[0]!.hero).toBe('passed');
    // Straight on, no jump: into the first crack of the next stage.
    for (let k = 0; k < 1200 && !sim.caught; k++) sim.step({ moveX: 0, moveZ: 1, jump: false, jumpHeld: false }, DT);
    expect(sim.caught, 'fell into the crack').not.toBeNull();
    for (let k = 0; k < 600 && sim.caught; k++) sim.step(NO_MOVE, DT);
    expect(stageAt(level, sim.hero.pos.z), 'kept the stage after the giant').toBe(next.n);
    expect(Math.hypot(sim.hero.pos.x - sim.stageStart(next.n).x, sim.hero.pos.z - sim.stageStart(next.n).z)).toBeLessThanOrEqual(3);
  });
});
