import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLevel } from '../../src/level/builder.ts';
import { OPEN_SLOPE } from '../../src/level/open-slope.ts';
import { createSim } from '../../src/sim/world.ts';
import { mergePatch } from '../../src/content/pace.ts';
import type { BalanceJson, BotsJson, OpenFork, OpenSpecJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

// SP-05 (docs/01-gdd.md 20.5; docs/01a-content.md 19.3): a fork of the open slope is two lanes 44 wide either side of a
// crevasse `between` wide (30 / 36 / 44 / 52 / 60 by mountain), 3 deep, its flat bottom with gifts, a slope up to both
// lanes at most every 60; 150–300 long, the lanes meet 40 before the ridge; the bots take the lanes by bots.boldShare.
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const tuning = mergePatch(read('tuning.json'), read('pace/open/tuning.json')) as unknown as TuningJson;
const balance = mergePatch(read('balance.json'), read('pace/open/balance.json')) as unknown as BalanceJson;
const bots = mergePatch(read('bots.json'), read('pace/open/bots.json')) as unknown as BotsJson;
const spec = read('pace/open/worlds-spec.json') as OpenSpecJson;
const worlds = read('pace/open/worlds.json') as WorldsJson;
const cfg = spec.forkSplit!;
const BETWEEN = [30, 36, 36, 44, 44, 44, 52, 52, 60, 60];
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
const DT = 1 / 60;

describe('SP-05: forks on two lanes', () => {
  it('the spec: every fork of 17.1 is split, lanes 44, the crevasse by mountain, 150–300 long; 3 deep, a slope every 60, meet 40 before the ridge', () => {
    expect(cfg).toEqual({ depth: 3, rampEvery: 60, converge: 40, bottomGifts: 3 });
    spec.mountains.forEach((m, mi) => {
      for (const s of m.sections) {
        if (!s.fork) continue;
        expect(s.fork).toEqual({ kind: 'split', track: 44, between: BETWEEN[mi]!, length: [150, 300] } satisfies OpenFork);
        // 19.3: the section is at least as wide as its two lanes and the crevasse.
        expect(s.width!).toBeGreaterThanOrEqual(2 * 44 + BETWEEN[mi]!);
      }
      expect(m.sections.some((s) => s.fork), m.id).toBe(true);
    });
    expect(bots.boldShare).toBe(0.5);
  });

  for (const [wi, w] of worlds.worlds.entries()) {
    it(`mountain ${wi + 1} (${w.id}): both lanes ≥ 44 at every z, the crevasse ${BETWEEN[wi]} wide and 3 deep, out of it up to both lanes within 60, no dead end`, () => {
      const level = buildLevel(w);
      const forks = w.segments.filter((s) => s.type === 'fork');
      expect(forks.length).toBeGreaterThan(0);
      for (const f of forks) {
        expect(f['kind']).toBe('split');
        const N = f['between'] as number;
        expect(N).toBe(BETWEEN[wi]);
        const z0 = f.z;
        const z1 = f.z + (f['length'] as number);
        const y = f['y'] as number;
        const zone = w.zones[(f['section'] as number) - 1]!;
        const ridge = zone.zEnd;
        expect(z1, 'the lanes meet before the ridge').toBeLessThanOrEqual(ridge - cfg.converge + 1e-6);
        expect(z1, 'and before the approach rise').toBeLessThanOrEqual(zone.zStart + OPEN_SLOPE.approach.start * (zone.zEnd - zone.zStart));
        let pitStart = z0;
        let deepest = 0;
        for (let z = z0 + 0.25; z < z1; z += 0.5) {
          const e = level.halfAt(z);
          // Each lane 44 wide off the crevasse: its floor (at the lane's own level or a crevasse of its own, 17.7), up to the edge.
          for (const sign of [-1, 1]) for (let x = N / 2 + 0.5; x <= N / 2 + 44; x += 2) expect(level.floorAt(sign * Math.min(x, e - 0.5), z), `lane x ${sign * x}, z ${z}`).toBeGreaterThan(y - 3.5);
          expect(N / 2 + 44, 'room for the lanes').toBeLessThanOrEqual(e);
          // The crevasse: down `depth` between its slopes, never a hole.
          const c = level.floorAt(0, z);
          expect(c, `crevasse z ${z}`).toBeGreaterThanOrEqual(y - cfg.depth - 1e-6);
          if (c < y - 1e-6) {
            deepest = Math.max(deepest, y - c);
            expect(z - pitStart, `the way up within ${cfg.rampEvery} at z ${z}`).toBeLessThanOrEqual(cfg.rampEvery);
          } else pitStart = z;
          // Its walls: a lane's floor at each edge reaches down to its bottom (nothing to walk under).
          for (const sign of [-1, 1]) {
            const edge = level.boxes.filter((b) => b.kind === 'floor' && z >= b.min[2] && z <= b.max[2] && Math.abs((sign > 0 ? b.min[0] : -b.max[0]) - N / 2) < 1e-6);
            expect(edge.some((b) => b.min[1] <= y - cfg.depth + 1e-6), `wall z ${z}, side ${sign}`).toBe(true);
          }
        }
        expect(deepest).toBeCloseTo(cfg.depth, 6);
        // Gifts on its bottom.
        const bottom = w.segments.filter((s) => s.type === 'gift' && s['bottom'] === true && s.z > z0 && s.z < z1 && Math.abs(s['x'] as number) < N / 2);
        expect(bottom).toHaveLength(cfg.bottomGifts);
      }
    });
  }

  it('a hero on the bottom runs out up its slope within 4 s, at the minimum speed of the section; no respawn', () => {
    for (const wi of [0, 4, 9]) {
      const w = worlds.worlds[wi]!;
      const level = buildLevel(w);
      const f = w.segments.find((s) => s.type === 'fork')!;
      const zone = w.zones[(f['section'] as number) - 1]!;
      const stat = zone.k >= 2 ? spec.mountains[wi]!.ridges[zone.k - 2]!.requires : 0;
      const y = f['y'] as number;
      for (const t of [0.1, 0.5, 0.9]) {
        const z = f.z + t * (f['length'] as number);
        const s = createSim(level, tuning, { balance, speedCurve: curve, stat });
        let respawns = 0;
        s.events.on('respawn', () => respawns++);
        s.teleport(0, level.floorAt(0, z) + 0.1, z);
        let out = -1;
        for (let k = 0; k < 4 * 60 && out < 0; k++) {
          s.step({ moveX: 0, moveZ: 1, jump: false, jumpHeld: false }, DT);
          if (s.hero.pos.y > y - 0.2 && s.hero.onGround) out = k;
        }
        expect(out, `mountain ${wi + 1}, z ${z.toFixed(0)}`).toBeGreaterThanOrEqual(0);
        expect(respawns).toBe(0);
      }
    }
  }, 120_000);

  it('the bots take the bold lane by bots.boldShare: 1 — all of them, 0 — none', () => {
    const w = worlds.worlds[0]!;
    const level = buildLevel(w);
    const f = level.forks[0]!;
    const boldSign = f.bold === 'left' ? -1 : 1;
    for (const share of [0, 1]) {
      const s = createSim(level, tuning, { balance, speedCurve: curve, stat: 1e9, bots: { cfg: { ...bots, boldShare: share }, count: 6, seed: 3 } });
      const seen = new Map<number, number>();
      // Those that came up to the fork from below (a bot out of a grotto inside it keeps the lane it has).
      const below = new Set<number>();
      for (let t = 0; t < 40 * 60; t++) {
        s.step({ moveX: 0, moveZ: 0, jump: false, jumpHeld: false }, DT);
        for (const b of s.bots!.list) {
          if (b.mode === 'up' && b.z > f.z0 - 30 && b.z < f.z0 - 2) below.add(b.index);
          else if (b.mode !== 'up' && b.z > f.z0) below.delete(b.index);
          if (b.mode === 'up' && below.has(b.index) && b.z > f.z0 + 20 && b.z < f.z1 - 20) seen.set(b.index, Math.sign(b.x));
        }
      }
      expect(seen.size, `share ${share}`).toBeGreaterThan(2);
      for (const side of seen.values()) expect(side, `share ${share}`).toBe(share === 1 ? boldSign : -boldSign);
    }
  }, 60_000);
});
