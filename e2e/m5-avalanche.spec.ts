import { test, expect, testState, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';

// M5-02 (docs/01-gdd.md 4.8, docs/02-tech.md 8.3): the avalanche of the release pace on mountains 1, 4 and 10 — at most
// 4 draw calls of its own, the clumps at the front, its own look and rumble on each mountain; frames warn, run and
// shelter (880 × 405) in docs/evidence/M5/, and warn on low on mountain 4 (the spawn point visible).
const avalancheCalls = async (page: Page): Promise<Record<string, number>> =>
  Object.fromEntries((await page.evaluate(() => window.__TEST__!.drawList())).filter(([n]) => n.startsWith('avalanche')));

test.describe('880 × 405', () => {
  test.use({ viewport: { width: 880, height: 405 }, hasTouch: true, isMobile: true });
  for (const wi of [1, 4, 10])
    test(`M5-02 mountain ${wi}: warn, run and shelter — at most 4 draw calls, clumps, rumble`, async ({ page, openGame }) => {
      test.setTimeout(180_000);
      await openGame('pace=stages&mock_device=mobile&seed=42');
      await waitTicks(page, 10);
      // Sound starts on the first gesture (a key nobody uses).
      await page.keyboard.press('F8');
      await page.evaluate(() => {
        window.__TEST__!.setPlaySec(400);
        window.__TEST__!.setFlag('firstWaveDone', true);
        window.__TEST__!.setTutor(9);
      });
      if (wi > 1) {
        await page.evaluate((i) => window.__TEST__!.gotoWorld(i), wi);
        await waitTicks(page, 20);
      }
      // A cave halfway up: the hero 30 units above it, the wave from 160 above him.
      const caves = await page.evaluate(() => window.__TEST__!.shelters());
      const cave = caves.filter((c) => c.kind !== 'tunnel')[Math.floor(caves.length / 2)]!;
      await page.evaluate(([x, z]) => window.__TEST__!.teleport(z + 30, x), cave.inside);
      await waitTicks(page, 10);
      // The view up the slope, where the wave comes from (the frame only; the game keeps its own camera).
      await page.evaluate(() => window.__TEST__!.setCamera({ yaw: 0, pitch: 0.12, dist: 12 }));
      await page.evaluate(() => window.__TEST__!.triggerWave());
      await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'warn', undefined, { timeout: 30_000 });
      await waitTicks(page, 30);
      let s = await testState(page);
      const name = `docs/evidence/M5/avalanche-m${String(wi).padStart(2, '0')}`;
      await page.screenshot({ path: `${name}-1-warn.png` });
      const warnCalls = await avalancheCalls(page);
      expect(Object.values(warnCalls).reduce((a, b) => a + b, 0), JSON.stringify(warnCalls)).toBeLessThanOrEqual(4);
      expect(s.hums['avalancheRumble'] ?? 0).toBeGreaterThan(0);
      if (wi === 4) {
        await page.evaluate(() => window.__TEST__!.setQuality('low'));
        await waitTicks(page, 10);
        await page.screenshot({ path: `${name}-1-warn-low.png` });
        await page.evaluate(() => window.__TEST__!.setQuality('auto'));
      }
      // The front comes down at him on the slope: the run frame, then into the lit cave below.
      await page.evaluate(() => window.__TEST__!.setTimeScale(3));
      await page.waitForFunction(() => {
        const st = window.__TEST__!.state();
        return st.wave!.phase === 'run' && st.wave!.frontZ - st.hero!.z < 50;
      }, undefined, { timeout: 90_000 });
      await page.evaluate(() => window.__TEST__!.setTimeScale(1));
      s = await testState(page);
      await page.screenshot({ path: `${name}-2-run.png` });
      const runCalls = await avalancheCalls(page);
      expect(Object.values(runCalls).reduce((a, b) => a + b, 0), JSON.stringify(runCalls)).toBeLessThanOrEqual(4);
      expect(runCalls['avalanche-clumps'], JSON.stringify(runCalls)).toBe(1);
      expect(runCalls['avalanche-front'], JSON.stringify(runCalls)).toBe(1);
      expect(s.hums['avalancheRumble'] ?? 0).toBeGreaterThan(0.2);
      await page.evaluate(() => window.__TEST__!.setCamera('auto'));
      const shelter = caves[s.wave!.shelter]!;
      await page.evaluate(([x, z, yy]) => window.__TEST__!.teleport(z, x, yy + 0.05), [shelter.inside[0], shelter.inside[1], shelter.y] as const);
      await page.waitForFunction(() => {
        const st = window.__TEST__!.state();
        return st.wave!.phase !== 'run' || st.wave!.frontZ - st.hero!.z < 6;
      }, undefined, { timeout: 60_000 });
      await page.screenshot({ path: `${name}-3-shelter.png` });
      await page.evaluate(() => window.__TEST__!.setTimeScale(3));
      await page.waitForFunction(() => window.__TEST__!.simEvents.some((e) => e.name === 'waveSurvived'), undefined, { timeout: 60_000 });
      await page.evaluate(() => window.__TEST__!.setTimeScale(1));
      s = await testState(page);
      // «Phew, made it!» heard: the whoosh over the cave and its three notes.
      expect(s.sfx).toContain('avalancheWhoosh');
      expect(s.sfx).toContain('phew');
      // M5-03: snow sparkles round him at «Phew».
      expect(s.funFx.world?.phew ?? 0).toBeGreaterThan(0);
    });
});

// M5-03 (docs/01-gdd.md 10.3): snow from under the feet on the run, ice shards and the melt sound of a wall opening.
test('M5-03: snow off the feet, a melting wall bursts and sounds', async ({ page, openGame }) => {
  await openGame('pace=fast');
  await page.keyboard.press('F8');
  await expect.poll(() => page.evaluate(() => window.__TEST__!.state().audioRunning), { timeout: 15_000 }).toBe(true);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__TEST__!.keyDown('KeyW'));
  await waitTicks(page, 120);
  await page.evaluate(() => window.__TEST__!.keyUp('KeyW'));
  let s = await testState(page);
  expect(s.funFx.world?.feet ?? 0).toBeGreaterThan(0);
  expect(s.gatesOpen.some((o) => !o)).toBe(true);
  await page.evaluate(() => window.__TEST__!.setStat(1e9));
  await expect.poll(async () => (await testState(page)).funFx.world?.melt ?? 0, { timeout: 10_000 }).toBeGreaterThan(0);
  s = await testState(page);
  expect(s.sfx).toContain('wallMelt');
});
