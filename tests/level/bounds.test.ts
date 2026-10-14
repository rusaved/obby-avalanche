import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLevel, BORDER_WIDTH } from '../../src/level/builder.ts';
import { createSim } from '../../src/sim/world.ts';
import { mergePatch } from '../../src/content/pace.ts';
import type { Aabb } from '../../src/level/types.ts';
import type { BalanceJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

// FM-01 (docs/01-gdd.md 19.9, Q-048): the invisible wall over the side borders, along the summit and behind its portal.
// Its top over the floor at the edge is above the highest flight the hero can make there (a jump, or a trampoline from
// the top of a cliff or a hump of the mountain) + 1 unit, at every z of every mountain of the open pace.
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const tuning = mergePatch(read('tuning.json'), read('pace/open/tuning.json')) as unknown as TuningJson;
const balance = mergePatch(read('balance.json'), read('pace/open/balance.json')) as unknown as BalanceJson;
const worlds = read('pace/open/worlds.json') as WorldsJson;
const wallHeight = tuning.bounds?.wallHeight ?? 0;
const c = tuning.controller;
const apex = Math.max(c.jumpSpeed, tuning.fun.padSpeed) ** 2 / (2 * c.gravity);

const covers = (b: Aabb, x: number, z: number): boolean => x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2];
/** Is (x, z) inside a convex polygon (either winding). */
function inside(pts: Array<[number, number]>, x: number, z: number): boolean {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const c = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (Math.abs(c) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

describe('FM-01: the invisible wall of the open slope', () => {
  it('tuning of the open pace sets the wall; classic and fast have none', () => {
    expect(wallHeight).toBeGreaterThan(0);
    expect((read('tuning.json') as TuningJson).bounds).toBeUndefined();
  });

  for (const w of worlds.worlds) {
    it(`mountain ${w.index} (${w.id}): over both borders at every z the wall tops the highest flight + 1`, () => {
      const level = buildLevel(w, { wallHeight });
      const half = level.width / 2;
      // Over the snow of a change of width and of the summit funnel (SP-01, SP-04) the wall stands on the snow.
      const prisms = level.prisms ?? [];
      const prismTop = (x: number, z: number): number => Math.max(-Infinity, ...prisms.filter((p) => inside(p.pts, x, z)).map((p) => p.y1 - 3 + wallHeight));
      // The highest standing place by the edge of this mountain: an ice cliff of a bold lane, a hump crest.
      const rise = Math.max(0, ...w.segments.filter((s) => s.type === 'cliff').map((s) => Number(s['height'])), ...w.segments.filter((s) => s.type === 'hump').map((s) => Number(s['rise'])));
      const need = rise + apex + 1;
      const bounds = level.bounds ?? [];
      expect(bounds.length).toBeGreaterThan(0);
      let checked = 0;
      for (let z = 0.5; z < w.length; z += 1) {
        // SP-04: the edge where the slope is at z.
        const e = level.halfAt(z);
        for (const sign of [-1, 1]) {
          const floor = level.floorAt(sign * (e - 0.5), z);
          if (!Number.isFinite(floor)) continue;
          const x = sign * (e + BORDER_WIDTH / 2);
          const top = Math.max(-Infinity, prismTop(x, z), ...bounds.filter((b) => covers(b, x, z)).map((b) => b.max[1]));
          expect(top - floor, `z ${z}, side ${sign}`).toBeGreaterThanOrEqual(need);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(w.length);
      // Behind the summit portal: a wall across the whole width, as high.
      const portal = level.points.find((p) => p.type === 'portal')!;
      const end = Math.max(...w.segments.filter((s) => s.type === 'floor').map((s) => s.z + Number(s['length'])));
      expect(end).toBeGreaterThan(portal.z);
      for (let x = -half; x <= half; x += 2) {
        const top = Math.max(-Infinity, prismTop(x, end + 1), ...bounds.filter((b) => covers(b, x, end + 1)).map((b) => b.max[1]));
        expect(top - level.floorAt(x, end - 1), `behind the portal, x ${x}`).toBeGreaterThanOrEqual(need);
      }
    });
  }

  it('the hero jumping sideways at the border never leaves the slope (mountains 1, 5, 9)', () => {
    const curve = { ...balance.speedCurve, base: c.baseSpeed, max: c.maxSpeed };
    for (const i of [0, 4, 8]) {
      const w = worlds.worlds[i]!;
      const level = buildLevel(w, { wallHeight });
      const s = createSim(level, tuning, { balance, speedCurve: curve, stat: 1e9 });
      let falls = 0;
      s.events.on('fall', () => falls++);
      // RL: off the pits, chasms and dips (there a fall or a dip is the element, not the border).
      const holes = [...(level.shapes ?? []).filter((q) => q.kind === 'pit' || q.kind === 'chasm').map((q) => [q.z0, q.z1]), ...w.segments.filter((x) => x.type === 'dip').map((d) => [d.z, d.z + (d['length'] as number)])];
      const clear = (z: number): number => (holes.some(([a, b]) => z > a! - 10 && z < b! + 10) ? clear(z + 20) : z);
      for (const z of [60, w.length * 0.35, w.length * 0.7, w.length - 30].map(clear)) {
        // The summit funnel (SP-01): its snow walls are the border there.
        const f = level.funnel;
        const edge = f && z > f.z0 ? f.x0 + (f.x1 - f.x0) * Math.min(1, (z - f.z0) / (f.z1 - f.z0)) : level.halfAt(z);
        for (const sign of [-1, 1]) {
          falls = 0;
          const y0 = level.floorYAt(z);
          s.teleport(sign * (edge - 3), y0 + 0.1, z);
          let low = 0;
          for (let t = 0; t < 4 * 60; t++) {
            const jump = t % 20 === 0;
            s.step({ moveX: sign, moveZ: t % 60 < 30 ? 0.3 : -0.3, jump, jumpHeld: jump }, 1 / 60);
            if (s.hero.pos.y < y0 - 4) low++;
          }
          expect(falls + low, `mountain ${i + 1}, z ${z}, side ${sign}`).toBe(0);
        }
      }
    }
  });

  it('without the option the level is as before: no wall', () => {
    const level = buildLevel(worlds.worlds[0]!);
    expect(level.bounds ?? []).toHaveLength(0);
  });
});
