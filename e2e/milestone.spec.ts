import { test, expect, testState, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';

/** Runs uphill from Speed `from` until the plaque flashes; returns the state at that moment. */
async function crossOneK(page: Page, from: number): Promise<Awaited<ReturnType<typeof testState>>> {
  await page.keyboard.press('KeyD');
  await page.evaluate((n) => window.__TEST__!.setStat(n), from);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__TEST__!.state().statFlash, undefined, { timeout: 30_000 });
  const s = await testState(page);
  await page.keyboard.up('KeyW');
  return s;
}

// M2-13, Q-023: a round number of Speed — the plaque flashes, the number bounces, a short chime, a toast; no analytics.
test('1K Speed: flash class, toast «1K Скорости!», chime, one event per load, no analytics; screenshot', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame();
  const s = await crossOneK(page, 990);
  expect(s.stat).toBeGreaterThanOrEqual(1000);
  expect(s.waveHud.toast).toBe('1K Скорости!');
  await waitTicks(page, 15);
  expect((await testState(page)).statFlash).toBe(true);
  await page.screenshot({ path: 'docs/evidence/M2/stat_milestone_1920x1080_ru.png' });
  expect(s.audioRunning).toBe(true);
  expect(s.sfx).toContain('statMilestone');
  // The same threshold again in this load: nothing.
  await page.evaluate(() => window.__TEST__!.setStat(995));
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__TEST__!.state().stat >= 1005, undefined, { timeout: 30_000 });
  await page.keyboard.up('KeyW');
  await waitTicks(page, 10);
  const events = await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'statMilestone').map((e) => e.value));
  expect(events).toEqual([1000]);
  const names = (await page.evaluate(() => window.__TEST__!.analytics())).map((e) => e.name);
  expect(names.filter((n) => /milestone/i.test(n))).toEqual([]);
});

test('en: «1K Speed!»', async ({ page, openGame }) => {
  await openGame('mock_lang=en');
  const s = await crossOneK(page, 990);
  expect(s.waveHud.toast).toBe('1K Speed!');
});
