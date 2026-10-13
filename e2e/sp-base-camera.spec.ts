import type { Page } from '@playwright/test';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import { toFirstBase } from './base-route.ts';
import base from '../content/avalanche/pace/open/base.json' with { type: 'json' };
import tuning from '../content/avalanche/tuning.json' with { type: 'json' };
import openTuning from '../content/avalanche/pace/open/tuning.json' with { type: 'json' };

// Q-066 (playtest of «Размах»: on the base the frames of the arches took a quarter to 60% of the view): the first base
// walked round as a player does — the spawn to arch 2, along the arc to arch 10 and back, to the shop, to arch 9 — and a
// turn by hand of 360° in front of arch 5; in every sampled frame no drawn arch covers more than SHARE of it (its outline:
// pillars, lintel and the light or ice between them, cut by the near plane and the frame), and the same walk without the
// arches hidden (camera.archHide 0) shows more. Screenshot by arch 5.
const SHARE = 0.3;
const EVIDENCE = 'docs/evidence/sp';
const H = (base.portals as { height: number }).height;

/** The largest share of the frame the outline of one drawn arch covers now, and which. */
async function archShare(page: Page): Promise<{ max: number; world: number; at: string }> {
  return page.evaluate((h) => {
    const T = window.__TEST__!;
    const s = T.state();
    const f = s.field ?? { width: innerWidth, height: innerHeight };
    let max = 0;
    let world = 0;
    for (const p of s.basePortals) {
      if (p.hidden) continue;
      const c = Math.cos(p.yaw);
      const sn = Math.sin(p.yaw);
      const pts = [
        [-p.width / 2, 0],
        [p.width / 2, 0],
        [p.width / 2, h],
        [-p.width / 2, h],
      ].map(([u, y]) => [p.x + u! * c, y!, p.z - u! * sn] as [number, number, number]);
      const ahead = (q: [number, number, number]): boolean => T.project(q[0], q[1], q[2]).ahead;
      // The outline cut by the near plane first (a part of it behind the camera covers nothing): the crossing of an edge
      // by bisection on «ahead».
      const front: Array<[number, number, number]> = [];
      for (let i = 0; i < 4; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % 4]!;
        const ia = ahead(a);
        if (ia) front.push(a);
        if (ia !== ahead(b)) {
          let lo = 0;
          let hi = 1;
          for (let k = 0; k < 24; k++) {
            const m = (lo + hi) / 2;
            const q: [number, number, number] = [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m];
            if (ahead(q) === ia) lo = m;
            else hi = m;
          }
          const t = ia ? lo : hi;
          front.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
        }
      }
      let share = 0;
      if (front.length >= 3) {
        // Then by the frame (Sutherland–Hodgman), then its area (shoelace).
        let poly = front.map((q) => {
          const r = T.project(q[0], q[1], q[2]);
          return [r.x, r.y] as [number, number];
        });
        const edges: Array<(q: [number, number]) => number> = [(q) => q[0], (q) => f.width - q[0], (q) => q[1], (q) => f.height - q[1]];
        for (const e of edges) {
          const out: Array<[number, number]> = [];
          for (let i = 0; i < poly.length; i++) {
            const a = poly[i]!;
            const b = poly[(i + 1) % poly.length]!;
            if (e(a) >= 0) out.push(a);
            if (e(a) >= 0 !== e(b) >= 0) {
              const t = e(a) / (e(a) - e(b));
              out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
            }
          }
          poly = out;
        }
        let area = 0;
        for (let i = 0; i < poly.length; i++) area += poly[i]![0] * poly[(i + 1) % poly.length]![1] - poly[(i + 1) % poly.length]![0] * poly[i]![1];
        share = Math.abs(area) / 2 / (f.width * f.height);
      }
      if (share > max) {
        max = share;
        world = p.world;
      }
    }
    return { max, world, at: `camera ${s.cameraPos.map((v) => v.toFixed(1))} hero ${s.hero!.x.toFixed(1)},${s.hero!.z.toFixed(1)}` };
  }, H);
}

test('the first base walked round and a turn by hand by an arch: no drawn arch over SHARE of the frame; screenshot', async ({ page, openGame }) => {
  test.setTimeout(420_000);
  await toFirstBase(page, openGame);
  await waitTicks(page, 30);
  const ports = (await testState(page)).basePortals;
  expect(ports.length).toBe(10);
  // A point `d` units in front of an arch, towards the middle of the arc.
  const [cx, cz] = base.portals.center as number[];
  const front = (p: { x: number; z: number }, d: number): [number, number] => {
    const l = Math.hypot(cx! - p.x, cz! - p.z);
    return [p.x + ((cx! - p.x) / l) * d, p.z + ((cz! - p.z) / l) * d];
  };
  const round = async (shot: boolean): Promise<{ worst: number; rows: string[]; hid: number }> => {
    const shop = base.stands.shop;
    const route: Array<[string, Array<[number, number]>]> = [
      ['spawn → arch 2', [front(ports[1]!, 7)]],
      ['along the arc → 6', [front(ports[3]!, 9), front(ports[5]!, 9)]],
      ['along the arc → 10', [front(ports[7]!, 9), front(ports[9]!, 9)]],
      ['back along the arc → 1', [front(ports[6]!, 8), front(ports[3]!, 8), front(ports[0]!, 8)]],
      ['to the shop', [[shop.x - 6, shop.z]]],
      ['to arch 9', [front(ports[8]!, 7)]],
    ];
    const rows: string[] = [];
    let worst = 0;
    let hid = 0;
    for (const [label, pts] of route) {
      await page.evaluate((p) => window.__TEST__!.botPath(p), pts);
      let w = { max: 0, world: 0, at: '' };
      let n = 0;
      for (let i = 0; i < 200; i++) {
        await waitTicks(page, 4);
        const r = await archShare(page);
        n++;
        hid += (await testState(page)).basePortals.filter((p) => p.hidden).length > 0 ? 1 : 0;
        if (r.max > w.max) w = r;
        if (i > 5 && (await page.evaluate(() => window.__TEST__!.botLeft())) === 0) break;
      }
      worst = Math.max(worst, w.max);
      const end = await testState(page);
      rows.push(`${label}: ${n} frames, max ${(w.max * 100).toFixed(0)}% (arch ${w.world}) at ${w.at}; ends at ${end.hero!.x.toFixed(1)},${end.hero!.z.toFixed(1)}, left ${await page.evaluate(() => window.__TEST__!.botLeft())}`);
    }
    await page.evaluate((p) => window.__TEST__!.botPath(p), [front(ports[4]!, 7)]);
    for (let i = 0; i < 100 && (await page.evaluate(() => window.__TEST__!.botLeft())) > 0; i++) await waitTicks(page, 4);
    await page.evaluate(() => window.__TEST__!.botPath(null));
    const px = 15 / tuning.camera.mouseDegPerPx;
    let w = { max: 0, world: 0, at: '' };
    for (let i = 0; i < 24; i++) {
      await page.mouse.move(400, 300);
      await page.mouse.down();
      await page.mouse.move(400 + px, 300, { steps: 2 });
      await page.mouse.up();
      await waitTicks(page, 4);
      const r = await archShare(page);
      if (r.max > w.max) w = r;
      if (i === 11 && shot) await shot1080(page, `${EVIDENCE}/base_arch_turn_1920x1080_ru.png`);
    }
    worst = Math.max(worst, w.max);
    rows.push(`turn by arch 5: max ${(w.max * 100).toFixed(0)}% (arch ${w.world}) at ${w.at}`);
    return { worst, rows, hid };
  };
  // Without the arches hidden (camera.archHide 0), then as the game is: from the spawn both times.
  await page.evaluate(() => window.__TEST__!.setTuning('camera.archHide', 0));
  const off = await round(false);
  await page.evaluate(([z, x]) => window.__TEST__!.teleport(z, x), [base.spawn.z, base.spawn.x] as const);
  await page.evaluate((v) => window.__TEST__!.setTuning('camera.archHide', v), openTuning.camera.archHide);
  await waitTicks(page, 30);
  const on = await round(true);
  console.log(`base arches (share of the frame; SHARE ${SHARE}): without hiding — max ${(off.worst * 100).toFixed(0)}%; hidden — max ${(on.worst * 100).toFixed(0)}%, frames with an arch hidden ${on.hid}:\n` + on.rows.join('\n'));
  expect(on.worst, on.rows.join('\n')).toBeLessThanOrEqual(SHARE);
  expect(off.worst).toBeGreaterThan(on.worst);
});
