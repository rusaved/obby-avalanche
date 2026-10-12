import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLevel, BORDER_WIDTH } from '../../src/level/builder.ts';
import { createSim } from '../../src/sim/world.ts';
import { mergePatch } from '../../src/content/pace.ts';
import type { BalanceJson, OpenSpecJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

// SP-01 (docs/01-gdd.md 20.2): the summit of the open slope is a funnel — snow walls from the edges of the slope to the
// portal pillars and on beside the portal to the end. The way past the portal is closed by the hero's physics, and
// running straight up from anywhere across leads into it.
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const tuning = mergePatch(read('tuning.json'), read('pace/open/tuning.json')) as unknown as TuningJson;
const balance = mergePatch(read('balance.json'), read('pace/open/balance.json')) as unknown as BalanceJson;
const spec = read('pace/open/worlds-spec.json') as OpenSpecJson;
const worlds = read('pace/open/worlds.json') as WorldsJson;
const wallHeight = tuning.bounds?.wallHeight ?? 0;
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };

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

describe('SP-01: the summit funnel', () => {
  it('the spec turns it on, the portal is 32 wide', () => {
    expect(spec.summit?.funnel).toBe(true);
    expect(spec.portalWidth).toBe(32);
  });

  for (const w of worlds.worlds) {
    it(`mountain ${w.index} (${w.id}): snow walls close the summit from the edges to the portal, no gaps`, () => {
      const level = buildLevel(w, { wallHeight });
      const f = level.funnel!;
      expect(f).toBeDefined();
      const portal = level.points.find((p) => p.type === 'portal')!;
      const portalHalf = (portal['width'] as number) / 2;
      // SP-04: the mouth is as wide as the giant's zone.
      const half = level.halfAt(f.z0);
      expect(f.z1).toBe(portal.z);
      expect(f.z1 - f.z0).toBe(spec.summit!.funnelLength);
      expect(f.x0).toBe(half);
      expect(f.x1).toBe(portalHalf);
      const prisms = (level.prisms ?? []).filter((p) => p.kind === 'funnel');
      expect(prisms).toHaveLength(2);
      const end = w.length;
      // Every point between the inner line and the border, from the mouth of the funnel to the end, is snow.
      let checked = 0;
      for (let z = f.z0 + 0.25; z < end; z += 0.5) {
        const inner = z >= f.z1 ? f.x1 : f.x0 + ((f.x1 - f.x0) * (z - f.z0)) / (f.z1 - f.z0);
        for (const sign of [-1, 1]) {
          for (let x = inner + 0.1; x <= half + BORDER_WIDTH - 0.1; x += 0.5) {
            expect(prisms.some((p) => inside(p.pts, sign * x, z)), `x ${sign * x}, z ${z}`).toBe(true);
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(100);
      // The snow stands over the floor of the summit, as high as a border.
      for (const p of prisms) expect(p.y1 - level.floorAt(0, f.z0 + 1)).toBeGreaterThanOrEqual(3);
    });
  }

  it('running straight up from anywhere across the summit leads into the portal; never past it outside (mountains 1, 5, 10)', () => {
    for (const i of [0, 4, 9]) {
      const w = worlds.worlds[i]!;
      const level = buildLevel(w, { wallHeight });
      const f = level.funnel!;
      const portal = level.points.find((p) => p.type === 'portal')!;
      const portalHalf = (portal['width'] as number) / 2;
      const half = level.halfAt(f.z0);
      for (const stat of [0, 1e9]) {
        const s = createSim(level, tuning, { balance, speedCurve: curve, stat });
        let entered = 0;
        s.events.on('portal', () => entered++);
        for (let x = -half + 1.5; x <= half - 1.5; x += 4) {
          s.portalEntered = false;
          entered = 0;
          const z0 = f.z0 - 6;
          s.teleport(x, level.floorYAt(z0) + 0.1, z0);
          let outside = 0;
          // SP-04: from the edge of a zone 160–200 wide at stat 0 (16 units/s) the slide along the snow wall takes ~9 s.
          for (let t = 0; t < 15 * 60 && entered === 0; t++) {
            s.step({ moveX: 0, moveZ: 1, jump: t % 30 === 0, jumpHeld: t % 30 === 0 }, 1 / 60);
            if (s.hero.pos.z > portal.z && Math.abs(s.hero.pos.x) > portalHalf) outside++;
          }
          expect(entered, `mountain ${i + 1}, stat ${stat}, from x ${x}`).toBe(1);
          expect(outside, `mountain ${i + 1}, stat ${stat}, from x ${x}`).toBe(0);
        }
        // Along the walls outwards and up, jumping: never beside the portal past its plane.
        for (const sign of [-1, 1]) {
          s.portalEntered = true;
          const z0 = f.z0 + 4;
          // 4 units in from the snow line there (SP-04: from a zone 160–200 wide it is steep).
          const edge = f.x0 + ((f.x1 - f.x0) * (z0 - f.z0)) / (f.z1 - f.z0);
          s.teleport(sign * (edge - 4), level.floorYAt(z0) + 0.1, z0);
          let outside = 0;
          for (let t = 0; t < 6 * 60; t++) {
            const jump = t % 20 === 0;
            s.step({ moveX: sign, moveZ: 1, jump, jumpHeld: jump }, 1 / 60);
            if (s.hero.pos.z > portal.z && Math.abs(s.hero.pos.x) > portalHalf) outside++;
          }
          expect(outside, `mountain ${i + 1}, stat ${stat}, along side ${sign}`).toBe(0);
        }
      }
    }
  }, 180_000);
});
