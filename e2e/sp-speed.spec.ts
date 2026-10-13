import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import { passX } from './base-route.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };
import openTuning from '../content/avalanche/pace/open/tuning.json' with { type: 'json' };

// SP-03 (docs/01-gdd.md 20.3; docs/01a-content.md 19.1, 19.7): the run grows on the eye. At ridge 2 of mountain 1 the hero
// runs ≥ 2,2 × the start, at the giant ≥ 2,6 ×; the camera there stands ≥ 4 units farther and wider than at the start;
// on a belt the hero does not speed up. Screenshots of the start and the giant: the difference of distance and angle.
type Seg = { type: string; z: number; kind?: string; requires?: number; passes?: number[] };
type OpenWorld = { segments: Seg[]; bosses: Array<{ zone: [number, number]; requires: number }> };
const w1 = (openWorlds as unknown as { worlds: OpenWorld[] }).worlds[0]!;
const ridges = w1.segments.filter((s) => s.type === 'gate' && s.kind === 'ridge');
const EVIDENCE = 'docs/evidence/sp';

/** Runs up at the Speed `stat` from z for `ticks` (the camera settles), then the state. */
async function runAt(page: Page, z: number, stat: number, ticks: number, x = -10): Promise<Awaited<ReturnType<typeof testState>>> {
  await page.evaluate(([zz, st, xx]) => {
    window.__TEST__!.setStat(st);
    window.__TEST__!.teleport(zz, xx);
    window.__TEST__!.setAutoRun(true);
  }, [z, stat, x] as const);
  await waitTicks(page, ticks);
  return testState(page);
}

test('mountain 1: the run at ridge 2 ≥ 2.2 ×, at the giant ≥ 2.6 × the start; the camera farther and wider; screenshots', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => {
    window.__TEST__!.setTimeScale(1);
    window.__TEST__!.holdWave(900);
  });
  // The start: Speed 0 at the foot — the run speed of the stat (16) and the camera before the first step (a step already
  // gives Speed, and the run grows from it at once).
  await page.evaluate(() => {
    window.__TEST__!.setStat(0);
    window.__TEST__!.teleport(60, -10);
  });
  await waitTicks(page, 120);
  const start = await testState(page);
  const v0 = start.fun.runSpeed;
  expect(v0).toBeCloseTo(16, 0);
  await page.evaluate(() => window.__TEST__!.setAutoRun(true));
  await waitTicks(page, 30);
  await shot1080(page, `${EVIDENCE}/speed_m1_start_1920x1080_ru.png`, 2);
  await page.evaluate(() => window.__TEST__!.setAutoRun(false));
  // Ridge 2 with its number.
  const r2 = ridges[1]!;
  const at2 = await runAt(page, r2.z - 140, r2.requires!, 150);
  await page.evaluate(() => window.__TEST__!.setAutoRun(false));
  expect(at2.hero!.speed / v0, `ridge 2: ${at2.hero!.speed.toFixed(1)} vs ${v0.toFixed(1)}`).toBeGreaterThanOrEqual(2.2);
  // The giant's zone with his advice: run in from below the line through the pass of ridge 3 nearest the middle (SP-04; Q-064:
  // on the axis), the camera settled (it backs off at retreatSpeed).
  const zone = w1.bosses[0]!.zone;
  const px = passX(ridges[2]!);
  const giant = await runAt(page, zone[0] - 160, w1.bosses[0]!.requires, 200, px);
  expect(giant.hero!.speed / v0, `giant: ${giant.hero!.speed.toFixed(1)} vs ${v0.toFixed(1)}`).toBeGreaterThanOrEqual(2.6);
  expect(giant.cameraDistance - start.cameraDistance, `distance ${giant.cameraDistance.toFixed(1)} vs ${start.cameraDistance.toFixed(1)}`).toBeGreaterThanOrEqual(4);
  expect(giant.cameraFov).toBeGreaterThan(start.cameraFov);
  // The shot on the run up to his line (in the zone he fills the frame): the camera as far and as wide.
  await runAt(page, zone[0] - 160, w1.bosses[0]!.requires, 110, px);
  await shot1080(page, `${EVIDENCE}/speed_m1_giant_1920x1080_ru.png`, 2);
  await page.evaluate(() => window.__TEST__!.setAutoRun(false));
  expect(start.cameraDistance).toBeCloseTo(openTuning.camera.distance, 0);
});

test('on a belt the hero does not speed up: the belt runs, not he', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await openGame('pace=open');
  await page.evaluate(() => {
    window.__TEST__!.holdWave(900);
    window.__TEST__!.setStat(2000);
  });
  const belt = ((await page.evaluate(() => window.__TEST__!.shelters())) as Array<{ belt: [number, number] | null }>).find((s) => s.belt)!.belt!;
  await page.evaluate(([x, z]) => window.__TEST__!.teleport(z, x), belt);
  await waitTicks(page, 30);
  let top = 0;
  for (let k = 0; k < 10; k++) {
    const s = await testState(page);
    expect(s.onBelt).toBe(true);
    top = Math.max(top, s.hero!.speed);
    await waitTicks(page, 12);
  }
  expect(top).toBeLessThan(1);
});
