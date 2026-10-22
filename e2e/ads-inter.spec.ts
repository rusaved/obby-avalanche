import { test, expect } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { STAGES, threshold } from './lv-stage-data.ts';

// M4-04 (docs/01-gdd.md 9.2; docs/03 ADS-03): a fullscreen ad only after a press of the player at its points — «Next» of
// «Mountain cleared» (portal), «Rebirth» (rebirth), the pause opened by the player (menu); called within the press (≤ 200
// ms), not in the first 180 s of play of the load, not oftener than ads.interstitialCooldownSec; the first portal of a new
// player passes with no ad (ads.skipFirstPortal) and sets firstPortalDone; with «No ads» — none. Game time (runSim).

const fullscreen = (page: Page): Promise<number> => page.evaluate(() => window.__YA_MOCK__!.calls.filter((c) => c.name === 'adv.showFullscreenAdv').length);
/** Opens the pause as the player and tells whether the ad was asked within the press (synchronously). */
const openMenu = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const before = window.__YA_MOCK__!.calls.filter((c) => c.name === 'adv.showFullscreenAdv').length;
    window.__TEST__!.openMenu(true);
    return window.__YA_MOCK__!.calls.filter((c) => c.name === 'adv.showFullscreenAdv').length > before;
  });
async function closeMenu(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__TEST__!.state().adBusy === null, undefined, { timeout: 10_000 });
  await page.evaluate(() => window.__TEST__!.openMenu(false));
  await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
}
async function start(page: Page, openGame: (q?: string) => Promise<void>, q = ''): Promise<void> {
  await openGame(`pace=stages${q}`);
  await page.evaluate((s) => {
    const t = window.__TEST__!;
    t.setPlaySec(400);
    t.holdWave(9000);
    t.setStat(s);
  }, threshold(3));
  await page.mouse.click(480, 300);
}

test('ADS-03 menu: no fullscreen ad in the first 180 s, then within the press, then not before the cooldown', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await start(page, openGame);
  expect(await openMenu(page), 'the first 180 s: no ad').toBe(false);
  await closeMenu(page);
  await page.evaluate(() => window.__TEST__!.runSim(150));
  expect(await openMenu(page), '150 s: no ad').toBe(false);
  await closeMenu(page);
  await page.evaluate(() => window.__TEST__!.runSim(35));
  expect(await openMenu(page), 'past 180 s: the ad within the press').toBe(true);
  // The game stands while it plays, the pause is still there after it.
  await expect.poll(() => page.evaluate(() => window.__TEST__!.state().pauseReasons)).toContain('ad');
  await closeMenu(page);
  expect(await page.evaluate(() => window.__TEST__!.state().pauseReasons)).not.toContain('ad');
  expect(await openMenu(page), 'right after: the cooldown').toBe(false);
  await closeMenu(page);
  await page.evaluate(() => window.__TEST__!.runSim(120));
  expect(await openMenu(page), '120 s later: still the cooldown of 180').toBe(false);
  await closeMenu(page);
  await page.evaluate(() => window.__TEST__!.runSim(65));
  expect(await openMenu(page), '185 s later: the ad again').toBe(true);
  await closeMenu(page);
  expect(await fullscreen(page)).toBe(2);
  const events = await page.evaluate(() => window.__TEST__!.analytics().map((e) => e.name));
  expect(events.filter((e) => e === 'inter_shown')).toHaveLength(2);
});

test('ADS-03 portal: the first «Next» of a new player passes with no ad and sets firstPortalDone; the next one shows it', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  await start(page, openGame);
  await page.evaluate(() => window.__TEST__!.runSim(200));
  const W = STAGES[0]!;
  const last = W.stages[W.stages.length - 1]!;
  const portal = W.segments.find((s) => s.type === 'portal')!;
  const toSummit = async (): Promise<void> => {
    await page.evaluate((s) => window.__TEST__!.setStat(s), threshold(40));
    await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y), [last.finish[0] + 2, last.y + 0.5] as const);
    await page.evaluate((z) => window.__TEST__!.botPath([[0, z + 2]]), portal.z);
    await expect(page.locator('[data-role="window"].open')).toBeVisible({ timeout: 40_000 });
    await page.evaluate(() => window.__TEST__!.botPath(null));
  };
  await toSummit();
  const before = await fullscreen(page);
  await page.locator('[data-hud="win-next"]').click();
  expect(await fullscreen(page), 'the first portal: no ad').toBe(before);
  expect(await page.evaluate(() => window.__TEST__!.state().flags['firstPortalDone'] ?? null)).toBe(true);
  // Back to mountain 1 and its summit again: not the first portal now.
  await page.waitForFunction(() => window.__TEST__!.state().window === null, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__TEST__!.gotoWorld(1));
  await page.waitForTimeout(500);
  await toSummit();
  await page.locator('[data-hud="win-next"]').click();
  expect(await fullscreen(page), 'the next portal: the ad').toBe(before + 1);
});

test('ADS-03 «No ads»: no fullscreen ad at any point', async ({ page, openGame }) => {
  await start(page, openGame);
  await page.evaluate(() => {
    window.__TEST__!.setFlag('noAds', true);
    window.__TEST__!.runSim(200);
  });
  expect(await openMenu(page)).toBe(false);
  await closeMenu(page);
});
