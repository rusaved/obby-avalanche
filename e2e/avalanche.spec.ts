import { test, expect, testState, waitTicks } from './fixtures.ts';
import type { TestState } from '../src/test-api/index.ts';
import type { Page } from '@playwright/test';

const waveEnds = (page: Page): Promise<number> =>
  page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'waveEnd').length);

async function waitWaveEnd(page: Page, count: number): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setTimeScale(3));
  await page.waitForFunction((n) => window.__TEST__!.simEvents.filter((e) => e.name === 'waveEnd').length >= n, count, { timeout: 90_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
}

async function takeGift(page: Page, index: number): Promise<void> {
  const g = (await testState(page)).gifts[index]!;
  await page.evaluate(([x, y, z]) => window.__TEST__!.teleport(z, x, y + 0.05), [g.x, g.y, g.z] as const);
  await page.waitForFunction((i) => window.__TEST__!.state().giftsTaken[i] === true, index, { timeout: 30_000 });
}

// M2-06: the avalanche (docs/01-gdd.md 4; docs/02-tech.md 7, 8). Fresh save: the first wave is the scripted one.
test('avalanche: scripted wave in cave 1, then a normal wave — warn and shelter screenshots, camera in the cave, gifts back after gone', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame();
  let s: TestState = await testState(page);
  expect(s.wave).toMatchObject({ phase: 'idle', scriptedPending: true });

  // 1. Scripted first wave (docs/01-gdd.md 4.6): the hero waits in cave 1, a gift of zone 1 is taken before it.
  await takeGift(page, 0);
  await page.evaluate(() => window.__TEST__!.teleport(103, -17, 6.05));
  await waitTicks(page, 5);
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await waitTicks(page, 3);
  s = await testState(page);
  expect(s.wave).toMatchObject({ phase: 'warn', scripted: true, warnSec: 5 });
  await waitWaveEnd(page, 1);
  s = await testState(page);
  expect(s.giftsTaken.every((t) => !t)).toBe(true);
  let names = (await page.evaluate(() => window.__TEST__!.analytics())).map((e) => ({ name: e.name, params: e.params }));
  expect(names.filter((e) => e.name === 'first_wave_survived')).toEqual([{ name: 'first_wave_survived', params: { inShelter: true } }]);

  // 2. A normal wave: the hero on the slope beside cave 3 (left, z 283), the cave off screen → arrow; crack 160 above.
  await takeGift(page, 1);
  await page.evaluate(() => window.__TEST__!.teleport(290, 10));
  await waitTicks(page, 10);
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await waitTicks(page, 60);
  s = await testState(page);
  expect(s.wave).toMatchObject({ phase: 'warn', scripted: false, shelter: 2 });
  expect(s.wave!.spawnZ).toBeCloseTo(s.hero!.z + 160, 0);
  expect(s.waveHud.banner).toMatch(/^Лавина через \d+$/);
  expect(s.waveHud.arrow).toBe(true);
  await page.screenshot({ path: 'docs/evidence/M2/warn_1920x1080_ru.png' });

  // 3. Into the cave; the front goes over it: camera frame on the wave, never inside the level or the snow body.
  await page.evaluate(() => window.__TEST__!.teleport(283, -17, 18.05));
  await page.waitForFunction(() => {
    const st = window.__TEST__!.state();
    return st.wave!.phase === 'run' && st.wave!.frontZ - st.hero!.z < 25;
  }, undefined, { timeout: 60_000 });
  let shotSeen = false;
  let shotShot = false;
  for (let i = 0; i < 40; i++) {
    const probe = await page.evaluate(() => ({
      st: window.__TEST__!.state(),
      inGeo: window.__TEST__!.cameraInsideGeometry(),
      inBody: window.__TEST__!.cameraInsideAvalanche(),
    }));
    const dz = probe.st.wave!.frontZ - probe.st.hero!.z;
    if (probe.st.wave!.phase !== 'run' || dz < -30) break;
    expect(probe.inGeo, `camera inside the level at dz ${dz.toFixed(1)}`).toBe(false);
    expect(probe.inBody, `camera inside the snow body at dz ${dz.toFixed(1)}`).toBe(false);
    if (probe.st.waveHud.shot) shotSeen = true;
    if (!shotShot && probe.st.waveHud.shot && Math.abs(dz) < 6) {
      await page.screenshot({ path: 'docs/evidence/M2/shelter_1920x1080_ru.png' });
      shotShot = true;
    }
    await waitTicks(page, 2);
  }
  expect(shotSeen).toBe(true);
  expect(shotShot).toBe(true);
  await waitWaveEnd(page, 2);
  s = await testState(page);
  expect(s.wave!.outcome).toBe('survived');
  // Gifts are back after a real avalanche (balance.gifts.respawn: onWaveGone), coins stay.
  expect(s.giftsTaken.every((t) => !t)).toBe(true);
  expect(s.coins).toBeGreaterThan(5 + 10);
  const survived = await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'waveSurvived'));
  expect(survived).toHaveLength(2);
  names = (await page.evaluate(() => window.__TEST__!.analytics())).map((e) => ({ name: e.name, params: e.params }));
  expect(names.filter((e) => e.name === 'wave_real_1')).toEqual([{ name: 'wave_real_1', params: { caught: false } }]);
  expect(await waveEnds(page)).toBe(2);
});
