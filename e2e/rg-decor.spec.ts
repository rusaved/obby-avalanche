import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';

// RG-12: decor of the open slope (docs/01-gdd.md 18.7): penguins of mountain 1 walk within their patch, a bird of
// mountain 3 turns to the hero coming near; +2 draw calls against no decor (mountain 9, both kinds), +0 on low; no
// console error across the 10 mountains (the fixture checks it); screenshot.
const EVIDENCE = 'docs/evidence/rg';

async function start(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
}

const calls = async (page: Page): Promise<number> => {
  await waitTicks(page, 5);
  return (await page.evaluate(() => window.__TEST__!.renderInfo()))!.calls;
};

test('penguins of mountain 1 walk within their patch; a bird of mountain 3 turns to the hero; +1 draw call; screenshot', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high&seed=3');
  await start(page);
  await page.evaluate(() => window.__TEST__!.holdWave(300));
  let s = await testState(page);
  const w = s.decor!.walkers;
  expect(w.length).toBeGreaterThan(0);
  // Z-07: birds on every mountain now, mountain 1 too.
  expect(s.decor!.sitters.length).toBeGreaterThan(0);
  const [x0, z0, x1, z1] = w[0]!.patch;
  // The hero beside the first patch, looking at it.
  await page.evaluate(([z, x]) => window.__TEST__!.teleport(z, x), [z0 - 12, (x0 + x1) / 2 > 0 ? x0 - 4 : x1 + 4] as const);
  await waitTicks(page, 10);
  const before = (await testState(page)).decor!.walkers;
  await waitTicks(page, 300);
  s = await testState(page);
  const after = s.decor!.walkers;
  expect(after.some((p, i) => Math.hypot(p.x - before[i]!.x, p.z - before[i]!.z) > 0.3), 'penguins moved in 5 s').toBe(true);
  for (const p of after) {
    expect(p.x).toBeGreaterThanOrEqual(p.patch[0] - 1e-6);
    expect(p.x).toBeLessThanOrEqual(p.patch[2] + 1e-6);
    expect(p.z).toBeGreaterThanOrEqual(p.patch[1] - 1e-6);
    expect(p.z).toBeLessThanOrEqual(p.patch[3] + 1e-6);
  }
  // The shot: the hero just above the patch, the camera ahead of him looking down at him and the penguins.
  await page.evaluate(([z, x]) => window.__TEST__!.teleport(z, x), [z1 + 4, (x0 + x1) / 2] as const);
  await page.evaluate(() => window.__TEST__!.setCamera({ yaw: 2.7, pitch: 0.3, dist: 10 }));
  await waitTicks(page, 30);
  await shot1080(page, `${EVIDENCE}/decor_1920x1080_ru.png`, 1);
  await page.evaluate(() => window.__TEST__!.setCamera('auto'));

  // Mountain 3: a bird looks down the slope; the hero comes near on the slope — it turns to him.
  await page.evaluate(() => window.__TEST__!.gotoWorld(3));
  await waitTicks(page, 20);
  await page.evaluate(() => window.__TEST__!.holdWave(300));
  const bird = (await testState(page)).decor!.sitters[0]!;
  expect(bird).toBeDefined();
  await page.evaluate(([z, x]) => window.__TEST__!.teleport(z, x), [bird.z - 20, Math.max(-20, Math.min(20, bird.x))] as const);
  await waitTicks(page, 30);
  const far = (await testState(page)).decor!.sitters[0]!.yaw;
  expect(Math.abs(Math.atan2(Math.sin(far - Math.PI), Math.cos(far - Math.PI)))).toBeLessThan(0.05);
  // On the slope next to it: a bird on a border sits over the track edge.
  // SP-04: the edge of a wide section is far off the axis — 3 units in from the bird, whatever the width.
  const sideX = bird.x - Math.sign(bird.x) * 3;
  await page.evaluate(([z, x]) => window.__TEST__!.teleport(z, x), [bird.z - 3, sideX] as const);
  await waitTicks(page, 30);
  const near = (await testState(page)).decor!.sitters[0]!.yaw;
  expect(Math.abs(Math.atan2(Math.sin(near - Math.PI), Math.cos(near - Math.PI))), 'the bird turned').toBeGreaterThan(0.3);

  // Mountain 9 (aurora: both kinds): +1 draw call against no decor (Z-07: penguins and birds in one InstancedMesh).
  await page.evaluate(() => window.__TEST__!.gotoWorld(9));
  await waitTicks(page, 20);
  await page.evaluate(() => window.__TEST__!.holdWave(300));
  s = await testState(page);
  expect(s.decor!.walkers.length).toBeGreaterThan(0);
  expect(s.decor!.sitters.length).toBeGreaterThan(0);
  const on = await calls(page);
  await page.evaluate(() => window.__TEST__!.setDecor(false));
  const off = await calls(page);
  await page.evaluate(() => window.__TEST__!.setDecor(true));
  // Z-07: one mesh for both kinds, drawn only with animals within 150 units of the hero — at most one call.
  expect(on - off).toBeGreaterThanOrEqual(0);
  expect(on - off).toBeLessThanOrEqual(1);
  // Through every mountain: no console error (the fixture).
  for (let i = 1; i <= 10; i++) {
    await page.evaluate((k) => window.__TEST__!.gotoWorld(k), i);
    await waitTicks(page, 10);
  }
});

test('quality low: no decor, +0 draw calls', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await openGame('pace=open&quality=low&seed=3');
  await start(page);
  await page.evaluate(() => window.__TEST__!.gotoWorld(9));
  await waitTicks(page, 20);
  await page.evaluate(() => window.__TEST__!.holdWave(300));
  expect((await testState(page)).decor!.shown).toBe(false);
  const on = await calls(page);
  await page.evaluate(() => window.__TEST__!.setDecor(false));
  expect(on - (await calls(page))).toBe(0);
});
