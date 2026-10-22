import { test, expect } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { STAGES, threshold } from './lv-stage-data.ts';

// M4-11, M4-12 (docs/02-tech.md 11.11; docs/06 4, 8.1; Q-025): getFlags once at boot with the defaults of every flag of
// game.json; a flag of the mock changes its parameter without a rebuild; getFlags failing — the defaults, no error; the
// flags set go with game_ready. M4-04: ads.skipFirstPortal false — the first portal brings the ad too.

const fullscreen = (page: Page): Promise<number> => page.evaluate(() => window.__YA_MOCK__!.calls.filter((c) => c.name === 'adv.showFullscreenAdv').length);
const menuAd = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const before = window.__YA_MOCK__!.calls.filter((c) => c.name === 'adv.showFullscreenAdv').length;
    window.__TEST__!.openMenu(true);
    return window.__YA_MOCK__!.calls.filter((c) => c.name === 'adv.showFullscreenAdv').length > before;
  });
async function closeMenu(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__TEST__!.state().adBusy === null, undefined, { timeout: 10_000 });
  await page.evaluate(() => window.__TEST__!.openMenu(false));
}
async function start(page: Page, openGame: (q?: string) => Promise<void>, flags: string): Promise<void> {
  await openGame(`pace=stages&mock_flags=${encodeURIComponent(flags)}`);
  await page.evaluate((s) => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.holdWave(9000);
    window.__TEST__!.setStat(s);
  }, threshold(3));
  await page.mouse.click(480, 300);
}

test('M4-12 interstitialCooldownSec 120 from the flag: the second fullscreen ad after 120 s, not before; getFlags once; the flags in game_ready', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await start(page, openGame, '{"interstitialCooldownSec":"120"}');
  expect(await page.evaluate(() => window.__YA_MOCK__!.calls.filter((c) => c.name === 'getFlags').length)).toBe(1);
  const ready = await page.evaluate(() => window.__TEST__!.analytics().find((e) => e.name === 'game_ready')?.params);
  expect(ready?.['flags']).toEqual({ interstitialCooldownSec: 120 });
  await page.evaluate(() => window.__TEST__!.runSim(185));
  expect(await menuAd(page)).toBe(true);
  await closeMenu(page);
  await page.evaluate(() => window.__TEST__!.runSim(110));
  expect(await menuAd(page), '110 s: not yet').toBe(false);
  await closeMenu(page);
  await page.evaluate(() => window.__TEST__!.runSim(15));
  expect(await menuAd(page), '125 s: allowed').toBe(true);
  await closeMenu(page);
  expect(await fullscreen(page)).toBe(2);
});

test('M4-11 a flag below its range is clamped (cooldown 60 → 120), getFlags failing keeps the defaults with no error', async ({ page, openGame }) => {
  await start(page, openGame, '{"interstitialCooldownSec":"60"}');
  const ready = await page.evaluate(() => window.__TEST__!.analytics().find((e) => e.name === 'game_ready')?.params);
  expect(ready?.['flags']).toEqual({ interstitialCooldownSec: 120 });
  await page.goto('/?pace=stages&mock_flags=error');
  await page.waitForFunction(() => window.__TEST__?.ready === true);
  const again = await page.evaluate(() => window.__TEST__!.analytics().find((e) => e.name === 'game_ready')?.params);
  expect(again?.['flags']).toEqual({});
  // The fixture checks: no console.error and no pageerror.
});

test('M4-04 ads.skipFirstPortal false (flag): the first «Next» of a new player brings the ad too', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await start(page, openGame, '{"skipFirstPortal":"false"}');
  await page.evaluate(() => window.__TEST__!.runSim(200));
  const W = STAGES[0]!;
  const last = W.stages[W.stages.length - 1]!;
  const portal = W.segments.find((s) => s.type === 'portal')!;
  await page.evaluate((s) => window.__TEST__!.setStat(s), threshold(40));
  await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y), [last.finish[0] + 2, last.y + 0.5] as const);
  await page.evaluate((z) => window.__TEST__!.botPath([[0, z + 2]]), portal.z);
  await expect(page.locator('[data-role="window"].open')).toBeVisible({ timeout: 40_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  const before = await fullscreen(page);
  await page.locator('[data-hud="win-next"]').click();
  expect(await fullscreen(page), 'the first portal brings the ad').toBe(before + 1);
  expect(await page.evaluate(() => window.__TEST__!.state().flags['firstPortalDone'])).toBe(true);
});
