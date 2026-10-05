import { mkdirSync } from 'node:fs';
import { test, expect, testState, waitTicks } from './fixtures.ts';
import tuning from '../content/avalanche/tuning.json' with { type: 'json' };
import { paceWorlds } from './pace-data.ts';

// PR-04 (docs/01-gdd.md 16.4): fun between the gates of the fast pace. The bot runs straight up the middle of
// stretches 1–3 through every gift on the path: the trampoline of stretch 2 throws the hero more than 10 units over
// its plate and he takes its gift in the air, the ice slide of stretch 3 runs him × fun.slideMult with a snow trail.
type Seg = { type: string; z: number; x?: number; y: number; length?: number; pad?: boolean };
const world = paceWorlds<{ segments: Seg[] }>('fast')[0]!;
const gates = world.segments.filter((s) => s.type === 'gate').sort((a, b) => a.z - b.z) as Array<Seg & { requires: number }>;
const pad = world.segments.find((s) => s.type === 'jumpPad')!;
const slide = world.segments.find((s) => s.type === 'slide')!;
const EVIDENCE = 'docs/evidence/proto';

test('fast pace: straight up the middle — every gift on the path, the trampoline throws above 10 units, the slide boosts; screenshots', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame('pace=fast');
  mkdirSync(EVIDENCE, { recursive: true });
  // Sound starts on the first gesture; gates 1–3 open for the run.
  await page.keyboard.press('KeyD');
  await page.evaluate((n) => window.__TEST__!.setStat(n), gates[2]!.requires);
  await waitTicks(page, 5);
  const end = gates[2]!.z - 4;
  const s0 = await testState(page);
  const path = s0.gifts
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => Math.abs(g.x) < 1 && g.z < end)
    .sort((a, b) => a.g.z - b.g.z);
  expect(path.length).toBe(4 + 1 + 3);
  await page.evaluate((pts) => window.__TEST__!.botPath(pts), [...path.map(({ g }) => [0, g.z] as [number, number]), [0, end] as [number, number]]);
  let padShot = false;
  let camera = 'auto';
  let slideShot = false;
  let maxCalls = 0;
  for (let i = 0; i < 3000; i++) {
    await waitTicks(page, 2);
    const s = await testState(page);
    const h = s.hero!;
    // The evidence frames: the trampoline flight from the side, the slide from behind and above.
    if (!padShot && h.z > pad.z - 12 && camera !== 'side') {
      await page.evaluate(() => window.__TEST__!.setCamera({ yaw: Math.PI / 2, pitch: 0.3, dist: 17 }));
      camera = 'side';
    }
    if (!padShot && s.fun.padFlight && h.y - pad.y > 9) {
      await page.screenshot({ path: `${EVIDENCE}/jumppad_1920x1080_ru.png` });
      padShot = true;
      await page.evaluate(() => window.__TEST__!.setCamera({ pitch: 0.55, dist: 13, yaw: 0 }));
      camera = 'above';
    }
    if (!slideShot && s.fun.onSlide >= 0 && h.z > slide.z && s.funFx.trail > 0) {
      await page.screenshot({ path: `${EVIDENCE}/slide_1920x1080_ru.png` });
      slideShot = true;
      await page.evaluate(() => window.__TEST__!.setCamera('auto'));
    }
    maxCalls = Math.max(maxCalls, (await page.evaluate(() => window.__TEST__!.renderInfo()?.calls ?? 0)));
    if ((await page.evaluate(() => window.__TEST__!.botLeft())) === 0) break;
  }
  const s = await testState(page);
  expect(s.hero!.z).toBeGreaterThan(end - 1);
  for (const { g, i } of path) expect(s.giftsTaken[i], `gift on the path at z ${g.z}`).toBe(true);
  expect(s.fun.top, 'trampoline height over its plate').toBeGreaterThan(10);
  expect(s.fun.launches).toBe(1);
  expect(s.funFx.puffs).toBe(1);
  expect(s.funFx.slides).toBe(1);
  expect(padShot && slideShot).toBe(true);
  expect(maxCalls).toBeLessThanOrEqual(60);
  // «Boing», «whoosh» and the «ding» of every gift on the path.
  expect(s.audioRunning).toBe(true);
  for (const name of ['jumpPad', 'slide', 'pathGift']) expect(s.sfx, name).toContain(name);
  expect(s.sfx.filter((n) => n === 'pathGift').length).toBeGreaterThanOrEqual(path.length);
});

test('fast pace: the slide runs × fun.slideMult and holds it fun.slideSec after; gifts on the path in a row ring higher each', async ({ page, openGame }) => {
  await openGame('pace=fast');
  await page.keyboard.press('KeyD');
  await page.evaluate((n) => window.__TEST__!.setStat(n), gates[2]!.requires);
  await page.evaluate((z) => window.__TEST__!.teleport(z, 0), slide.z - (slide.length ?? 16) / 2 - 4);
  await waitTicks(page, 10);
  const notes: number[] = [];
  const ratios: Array<{ on: number; left: number; r: number }> = [];
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 200; i++) {
    await waitTicks(page, 2);
    const s = await testState(page);
    if (s.hero!.onGround && s.hero!.speed > 1) ratios.push({ on: s.fun.onSlide, left: s.fun.slideLeft, r: s.hero!.speed / s.fun.runSpeed });
    if (notes.at(-1) !== s.funFx.giftNote) notes.push(s.funFx.giftNote);
    if (s.hero!.z > slide.z + (slide.length ?? 16) / 2 + 3) break;
  }
  await page.keyboard.up('KeyW');
  const on = ratios.filter((x) => x.on >= 0).slice(-3);
  expect(on.length).toBeGreaterThan(0);
  for (const x of on) expect(x.r).toBeCloseTo(tuning.fun.slideMult, 1);
  const after = ratios.filter((x) => x.on < 0 && x.left > 0 && x.left < tuning.fun.slideSec - 0.1);
  expect(after.length).toBeGreaterThan(0);
  for (const x of after) expect(x.r).toBeCloseTo(tuning.fun.slideMult, 1);
  // Three gifts on the slide in a row: the note steps 0 → 1 → 2.
  expect(notes.slice(-3)).toEqual([0, 1, 2]);
});
