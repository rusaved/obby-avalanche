import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HeroInput } from '../../src/sim/controller.ts';
import { createSim, type Sim } from '../../src/sim/world.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { levelThreshold } from '../../src/sim/levels.ts';
import { mazeDistances } from '../../src/level/stage-slope.ts';
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

function runStage(w: World, st: WorldStage, seed: number): Outcome {
  const r = rand(seed);
  const level = buildLevel(w);
  const sim: Sim = createSim(level, tuning, {
    balance,
    speedCurve: balance.speedCurve,
    stat: levelThreshold(st.level, balance.levels!),
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
  let tx = 0;
  for (let k = 0; k < 60 / DT; k++) {
    const h = sim.hero.pos;
    if (sim.caught || sim.rollFrom > 0) return 'fall';
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
      const n = level.niches[ts.shelter]!;
      const cx = (n.box.min[0] + n.box.max[0]) / 2;
      const cz = (n.box.min[2] + n.box.max[2]) / 2;
      const len = Math.hypot(cx - h.x, cz - h.z);
      [mx, mz] = len < 1.5 ? [0, 0] : [(cx - h.x) / len, (cz - h.z) / len];
    } else {
      const ahead = narrowAhead(w, h.x, h.z + 0.3 * st.speed);
      tx = ahead ?? 0;
      // The giant ahead: a step aside from him, as a player does (22.5).
      if (st.type === 'giant' && sim.boss) {
        const g = sim.boss.zones.flatMap((z) => z.giants).find((q) => q.z > h.z - 2 && q.z - h.z < 30);
        if (g) tx = g.x > 0 ? -30 : 30;
      }
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
  for (const mi of [0, 4]) {
    const w = worlds.worlds[mi]!;
    for (const st of w.stages!.filter((s) => s.type !== 'intro')) {
      it(`mountain ${mi + 1}, stage ${st.n} (${st.type}, level ${st.level}, v ${st.speed}): 9 of 10`, () => {
        const res = Array.from({ length: TRIES }, (_, i) => runStage(w, st, 1000 * st.n + i));
        expect(res.filter((x) => x === 'pass').length, res.join(' ')).toBeGreaterThanOrEqual(9);
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
