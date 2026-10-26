import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, testState, waitTicks } from './fixtures.ts';
import { intoPortal, toFirstBase, worlds } from './base-route.ts';
import base from '../content/avalanche/pace/open/base.json' with { type: 'json' };

// SP-08 (docs/01-gdd.md 20.8; docs/01a-content.md 19.6): the base ×2 — 150 × 130, the arc of 10 arches 10 × 12 at
// radius 64. The first base: from the spawn to the portal of mountain 2 the bot takes ≤ 8 s; every arch and its sign is
// seen from the spawn (the view turned to it) at 1920×1080 and 640×360; draw calls ≤ 30 at the spawn, by the shop and
// on the treadmill; screenshots at both sizes.
const EVIDENCE = 'docs/evidence/sp';
const CALLS = 30;
/** The sign over an arch (render/base-view.ts): this far over its top, this tall. */
const SIGN_OVER = 1.2;
const SIGN_H = 2.2;

/** Arches (their middle) and signs of the base that project into the frame with the view turned to each from the spawn. */
async function seenFromSpawn(page: Page): Promise<string[]> {
  const s = await testState(page);
  const missing: string[] = [];
  const height = (base.portals as { height: number }).height;
  for (const p of s.basePortals) {
    const yaw = Math.atan2(p.x - s.hero!.x, p.z - s.hero!.z);
    await page.evaluate((y) => window.__TEST__!.setCamera({ yaw: y, pitch: 0.15, dist: 10 }), yaw);
    await waitTicks(page, 3);
    const pts = await page.evaluate(
      ([x, z, h, sign]) => {
        const f = window.__TEST__!.state().field ?? { width: innerWidth, height: innerHeight };
        return [window.__TEST__!.project(x, h / 2, z), window.__TEST__!.project(x, sign, z)].map((q) => q.ahead && q.x >= 0 && q.x <= f.width && q.y >= 0 && q.y <= f.height);
      },
      [p.x, p.z, height, height + SIGN_OVER + SIGN_H / 2] as const,
    );
    if (!pts[0]) missing.push(`arch ${p.world}`);
    if (!pts[1]) missing.push(`sign ${p.world}`);
  }
  await page.evaluate(() => window.__TEST__!.setCamera('auto'));
  return missing;
}

test('the first base ×2: portal 2 within 8 s; every arch and sign seen from the spawn at 1920×1080 and 640×360; ≤ 30 draw calls at 3 points; screenshots', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await toFirstBase(page, openGame);
  let s = await testState(page);
  expect(s.world).toBe('base');
  expect(s.basePortals).toHaveLength(worlds.length);
  expect(Math.hypot(s.hero!.x - base.spawn.x, s.hero!.z - base.spawn.z)).toBeLessThan(1);
  // The arches and signs from the spawn, both sizes; the screenshots in the frame of the spawn.
  for (const [w, h, name] of [
    [1920, 1080, 'base_1920x1080_ru.png'],
    [640, 360, 'base_640x360_ru.png'],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await waitTicks(page, 30);
    // The frame of the spawn first (the view at the own portal), then the arches one by one.
    await page.screenshot({ path: `${EVIDENCE}/${name}` });
    expect(await seenFromSpawn(page), `${w}×${h}`).toEqual([]);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  // Draw calls at the spawn, by the shop, on the treadmill.
  const calls: string[] = [];
  for (const [name, x, z] of [
    ['spawn', base.spawn.x, base.spawn.z],
    ['shop', base.stands.shop.x - 6, base.stands.shop.z],
    ['treadmill', base.treadmill.x, base.treadmill.z],
  ] as const) {
    await page.evaluate(([xx, zz]) => window.__TEST__!.teleport(zz, xx), [x, z] as const);
    await waitTicks(page, 20);
    const info = (await page.evaluate(() => window.__TEST__!.renderInfo()))!;
    calls.push(`${name}: ${info.calls}`);
    const list = info.calls > CALLS ? JSON.stringify(await page.evaluate(() => window.__TEST__!.drawList())) : '';
    expect(info.calls, `${calls.join(', ')} ${list}`).toBeLessThanOrEqual(CALLS);
  }
  console.log(`base draw calls — ${calls.join(', ')}`);
  // From the spawn to the portal of mountain 2 (the bot runs at the hero's speed of mountain 1).
  await page.evaluate(([xx, zz]) => window.__TEST__!.teleport(zz, xx), [base.spawn.x, base.spawn.z] as const);
  await waitTicks(page, 10);
  const sec = await intoPortal(page, 2);
  console.log(`spawn → portal 2: ${sec.toFixed(1)} s`);
  expect(sec).toBeLessThanOrEqual(8);
  s = await testState(page);
  expect(s.world).toBe(worlds[1]!.id);
});
