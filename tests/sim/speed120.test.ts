import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLevel, FLOOR_THICKNESS } from '../../src/level/builder.ts';
import { createCollisionWorld } from '../../src/sim/collision.ts';
import { createHero, stepHero } from '../../src/sim/controller.ts';
import { controllerParams, createSim } from '../../src/sim/world.ts';
import { createRng } from '../../src/core/rng.ts';
import { mergePatch } from '../../src/content/pace.ts';
import type { LevelData } from '../../src/level/types.ts';
import type { BalanceJson, BotsJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

// SP-02 (docs/01-gdd.md 20.3, 20.11): the run of «Размах» goes up to 120 units/s. The controller splits a tick into
// substeps of half the capsule radius (up to 8): at 120 that is 4 — no wall of the open slope is passed through. The
// hero at 120 from 2 000 random starts and courses against the carniz of the ridges, the walls of the grottos, the fence
// and the summit funnel of mountains 1, 5, 10 — never on the other side; the bots at 120 never out of the slope but in
// a grotto, never in the funnel snow. No game number changes here: 120 is set on a copy of tuning.json.
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const base = mergePatch(read('tuning.json'), read('pace/open/tuning.json')) as unknown as TuningJson;
const tuning: TuningJson = { ...base, controller: { ...base.controller, maxSpeed: 120 } };
const balance = mergePatch(read('balance.json'), read('pace/open/balance.json')) as unknown as BalanceJson;
// The crowd of the open pace (SP-04: its lanes spread over the width of a section).
const bots = mergePatch(read('bots.json'), read('pace/open/bots.json')) as unknown as BotsJson;
const worlds = read('pace/open/worlds.json') as WorldsJson;
const wallHeight = tuning.bounds?.wallHeight ?? 0;
const SPEED = 120;
const DT = 1 / 60;
const TRIALS = 2000;

/** Is (x, y, z) past a wall: in a carniz below its top, out of the slope but in a grotto, through a grotto's back wall, in the funnel snow. */
function walls(level: LevelData, carnizToo: boolean): (x: number, y: number, z: number) => string | null {
  // SP-04: the edge where the slope is at z.
  const half = (z: number): number => level.halfAt(z);
  const side = level.niches.filter((n) => n.kind !== 'tunnel' && n.kind !== 'ledge');
  const carniz = carnizToo ? level.boxes.filter((b) => b.kind === 'floor' && b.max[1] - b.min[1] > FLOOR_THICKNESS + 0.5 && b.max[0] - b.min[0] < level.width - 1) : [];
  const f = level.funnel;
  return (x, y, z) => {
    for (const b of carniz) if (x > b.min[0] + 0.2 && x < b.max[0] - 0.2 && z > b.min[2] + 0.3 && z < b.max[2] - 0.3 && y < b.max[1] - 0.3) return `carniz at z ${b.min[2]}`;
    if (Math.abs(x) > half(z) + 0.2) {
      const n = side.find((s) => z > s.box.min[2] - 0.05 && z < s.box.max[2] + 0.05 && Math.sign(x) === (s.side === 'left' ? -1 : 1));
      if (!n) return 'past the fence';
      if (x < n.box.min[0] - 0.05 || x > n.box.max[0] + 0.05) return `through the back wall of the grotto at z ${n.z}`;
    }
    if (f && z > f.z0 && z < level.length) {
      const edge = f.x0 + (f.x1 - f.x0) * Math.min(1, (z - f.z0) / (f.z1 - f.z0));
      if (Math.abs(x) > edge + 0.05) return 'in the funnel snow';
    }
    return null;
  };
}

describe('SP-02: physics at 120 units/s', () => {
  for (const i of [0, 4, 9]) {
    it(`mountain ${i + 1}: the hero at 120 from ${TRIALS} random starts against the carniz, the grottos, the fence and the funnel — never past a wall`, () => {
      const w = worlds.worlds[i]!;
      const level = buildLevel(w, { wallHeight });
      const world = createCollisionWorld(level.staticTriangles, level.boundsTriangles);
      const params = controllerParams(tuning, SPEED);
      const past = walls(level, true);
      const rng = createRng(1000 + i);
      const carniz = level.boxes.filter((b) => b.kind === 'floor' && b.max[1] - b.min[1] > FLOOR_THICKNESS + 0.5 && b.max[0] - b.min[0] >= 3 && b.max[0] - b.min[0] < level.width - 1);
      const grottos = level.niches.filter((n) => n.kind !== 'tunnel' && n.kind !== 'ledge');
      const f = level.funnel!;
      const camp = level.safeZones[0]![1];
      const deg = Math.PI / 180;
      const bad: string[] = [];
      const runs = { carniz: 0, grotto: 0, fence: 0, funnel: 0 };
      for (let t = 0; t < TRIALS; t++) {
        const family = (['carniz', 'grotto', 'fence', 'funnel'] as const)[t % 4]!;
        let x = 0;
        let z = 0;
        let dir = 0;
        if (family === 'carniz') {
          const b = carniz[rng.int(carniz.length)]!;
          x = rng.range(b.min[0] + 1.5, b.max[0] - 1.5);
          z = b.min[2] - rng.range(2, 10);
          dir = rng.range(-70, 70) * deg;
        } else if (family === 'grotto') {
          const n = grottos[rng.int(grottos.length)]!;
          x = rng.range(n.box.min[0] + 1.5, n.box.max[0] - 1.5);
          z = rng.range(n.box.min[2] + 1.5, n.box.max[2] - 1.5);
          dir = rng.range(-180, 180) * deg;
        } else if (family === 'fence') {
          const sign = rng.chance(0.5) ? 1 : -1;
          z = rng.range(camp + 5, f.z0 - 5);
          if (grottos.some((n) => (n.side === 'left' ? -1 : 1) === sign && Math.abs(z - n.z) < (n.box.max[2] - n.box.min[2]) / 2 + 4)) continue;
          x = sign * (level.halfAt(z) - rng.range(2, 10));
          // Towards the fence, within 70° of straight at it.
          dir = sign * (90 + rng.range(-70, 70)) * deg;
        } else {
          const sign = rng.chance(0.5) ? 1 : -1;
          z = rng.range(f.z0 + 2, level.length - 2);
          const edge = f.x0 + (f.x1 - f.x0) * Math.min(1, (z - f.z0) / (f.z1 - f.z0));
          x = sign * Math.max(1, edge - rng.range(2, 8));
          dir = sign * (90 + rng.range(-70, 70)) * deg;
        }
        // In a grotto: its own floor (floorAt knows the track only).
        const y = family === 'grotto' ? grottos.find((n) => x >= n.box.min[0] && x <= n.box.max[0] && z >= n.box.min[2] && z <= n.box.max[2])!.y : level.floorAt(x, z);
        if (!Number.isFinite(y) || past(x, y, z)) continue;
        runs[family]++;
        const hero = createHero([x, y + 0.05, z]);
        const mx = Math.sin(dir);
        const mz = Math.cos(dir);
        hero.vel.set(mx * SPEED, 0, mz * SPEED);
        hero.onGround = true;
        for (let k = 0; k < 30; k++) {
          stepHero(hero, { moveX: mx, moveZ: mz, jump: false, jumpHeld: false }, DT, world, params, level.killY);
          const why = past(hero.pos.x, hero.pos.y, hero.pos.z);
          if (why) {
            if (bad.length < 10) bad.push(`${family} from (${x.toFixed(1)}, ${z.toFixed(1)}) course ${(dir / deg).toFixed(0)}°: ${why} at (${hero.pos.x.toFixed(2)}, ${hero.pos.y.toFixed(2)}, ${hero.pos.z.toFixed(2)})`);
            break;
          }
        }
      }
      expect(bad, bad.join('\n')).toEqual([]);
      // Every family ran (a start on a hole or in a wall is skipped).
      for (const [k, v] of Object.entries(runs)) expect(v, k).toBeGreaterThan(TRIALS / 8);
    }, 120_000);
  }

  it('the bots at 120 on mountains 1, 5, 10 with avalanches: never out of the slope but in a grotto, never in the funnel snow', () => {
    for (const i of [0, 4, 9]) {
      const w = worlds.worlds[i]!;
      const level = buildLevel(w, { wallHeight });
      const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: SPEED };
      const s = createSim(level, tuning, { balance, speedCurve: curve, stat: 1e30, bots: { cfg: bots, count: 6, seed: 77 + i } });
      const past = walls(level, false);
      let fastest = 0;
      const bad: string[] = [];
      for (let t = 0; t < 90 * 60; t++) {
        s.step({ moveX: 0, moveZ: 0, jump: false, jumpHeld: false }, DT);
        for (const b of s.bots!.list) {
          if (b.mode === 'away' || b.mode === 'off') continue;
          const why = past(b.x, b.y, b.z);
          if (why && bad.length < 10) bad.push(`mountain ${i + 1}, bot ${b.index} (${b.mode}) at (${b.x.toFixed(1)}, ${b.z.toFixed(1)}): ${why}`);
        }
      }
      for (const b of s.bots!.list) fastest = Math.max(fastest, b.speedFactor * SPEED);
      expect(bad, bad.join('\n')).toEqual([]);
      expect(fastest).toBeGreaterThan(100);
    }
  }, 120_000);
});
