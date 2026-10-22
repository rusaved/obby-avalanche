import { test, expect, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';

// M4-03 (docs/01-gdd.md 9.1; docs/03 ADS-04): the rewarded buttons of the HUD come after 1 s of standing, past 60 s of
// play and the first avalanche, and hide within a frame on a move and on the warning; none while the avalanche runs; the
// word «Ad» on them, never «Free»; locked until the answer; no callback for 10 s — the game goes on with a toast. The egg
// of the mountain for an ad: «▶ Ad: {egg}» in «Shop → Eggs», one view — the egg at once (ads.eggViews 1).

const buttons = (page: Page): Promise<string[]> => page.evaluate(() => window.__TEST__!.state().adButtons);
/** The open pace (its HUD has the buttons): past 60 s, the first avalanche over, standing on the belt of a grotto. */
async function onBelt(page: Page, openGame: (q?: string) => Promise<void>, q = ''): Promise<void> {
  await openGame(`pace=open${q}`);
  await page.evaluate(() => {
    window.__TEST__!.setPlaySec(61);
    window.__TEST__!.setFlag('firstWaveDone', true);
    window.__TEST__!.holdWave(9000);
  });
  await page.mouse.click(480, 300);
  const belt = (await page.evaluate(() => window.__TEST__!.shelters())).find((g) => g.belt !== null)!.belt!;
  await page.evaluate(([x, z]) => window.__TEST__!.teleport(z, x), belt);
}

test('ADS-04 HUD: after 1 s of standing; hidden within a frame on a move and on the warning; none while it runs', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await onBelt(page, openGame);
  await expect.poll(() => buttons(page), { timeout: 15_000 }).toContain('stat_now');
  const btn = page.locator('[data-hud="ad-stat_now"]');
  await expect(btn).toContainText('Реклама');
  await expect(btn).not.toContainText(/Бесплатно|Free/);
  // A move: gone within a frame.
  await page.evaluate(() => window.__TEST__!.stick(1, 0));
  await waitTicks(page, 2);
  expect(await buttons(page)).not.toContain('stat_now');
  await page.evaluate(() => window.__TEST__!.stick(0, 0));
  const belt = (await page.evaluate(() => window.__TEST__!.shelters())).find((g) => g.belt !== null)!.belt!;
  await page.evaluate(([x, z]) => window.__TEST__!.teleport(z, x), belt);
  await expect.poll(() => buttons(page), { timeout: 15_000 }).toContain('stat_now');
  // The warning: gone within a frame; none while the avalanche runs.
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'warn');
  await waitTicks(page, 2);
  expect(await buttons(page)).toEqual([]);
  await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'run', undefined, { timeout: 30_000 });
  expect(await buttons(page)).toEqual([]);
});

test('ADS-04 no callback for 10 s: the button locked, then the game goes on with a toast, no reward', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await onBelt(page, openGame, '&mock_ad=silent');
  await expect.poll(() => buttons(page), { timeout: 15_000 }).toContain('stat_now');
  const stat0 = await page.evaluate(() => window.__TEST__!.state().stat);
  await page.locator('[data-hud="ad-stat_now"]').dispatchEvent('click');
  expect(await page.evaluate(() => window.__TEST__!.state().adBusy)).toBe('stat_now');
  // Locked: a second press asks nothing.
  await page.locator('[data-hud="ad-stat_now"]').dispatchEvent('click').catch(() => undefined);
  expect(await page.evaluate(() => window.__YA_MOCK__!.calls.filter((c) => c.name === 'adv.showRewardedVideo').length)).toBe(1);
  await page.waitForFunction(() => window.__TEST__!.state().adBusy === null, undefined, { timeout: 15_000 });
  expect(await page.evaluate(() => window.__TEST__!.state().pauseReasons)).toEqual([]);
  expect(await page.evaluate(() => window.__TEST__!.state().stat)).toBe(stat0);
  await expect(page.locator('[data-role="toast"]')).toContainText(/недоступно|unavailable/);
});

test('ADS-04 egg: «▶ Ad: {egg}» on the egg of the mountain in «Shop → Eggs» — one view, the egg at once', async ({ page, openGame }) => {
  test.setTimeout(90_000);
  await openGame('pace=stages');
  await page.evaluate(() => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.setFlag('firstWaveDone', true);
    window.__TEST__!.holdWave(9000);
    window.__TEST__!.setCoins(0);
  });
  await page.mouse.click(480, 300);
  await page.waitForTimeout(1_200);
  await page.locator('[data-hud="menu-shop"]').dispatchEvent('pointerdown');
  await page.locator('[data-hud="shop-tab-eggs"]').click();
  const ad = page.locator('[data-hud="shop-egg-ad"]');
  await expect(ad).toHaveCount(1);
  await expect(ad).toHaveText(/Реклама: Снежное яйцо/);
  await page.screenshot({ path: 'docs/evidence/M4/egg-ad.png' });
  const pets0 = await page.evaluate(() => window.__TEST__!.state().pets.length);
  await ad.click();
  await expect(page.locator('[data-role="new-pet"]')).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => window.__TEST__!.state().pets.length)).toBe(pets0 + 1);
  expect(await page.evaluate(() => window.__TEST__!.state().coins)).toBe(0);
  expect(await page.evaluate(() => window.__YA_MOCK__!.calls.filter((c) => c.name === 'adv.showRewardedVideo').length)).toBe(1);
  // The pause of 30 s between views: no button right after.
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
  await page.locator('[data-hud="menu-shop"]').dispatchEvent('pointerdown');
  await page.locator('[data-hud="shop-tab-eggs"]').click();
  await expect(page.locator('[data-hud="shop-egg-ad"]')).toHaveCount(0);
  await page.screenshot({ path: 'docs/evidence/M4/egg-ad-after.png' }).catch(() => undefined);
});

test('ADS-04 x2_stat: «▶ Ad: ×2 per step for 3 min» while no boost runs; the boost of 180 s after the ad', async ({ page, openGame }) => {
  test.setTimeout(90_000);
  await onBelt(page, openGame);
  await expect.poll(() => buttons(page), { timeout: 15_000 }).toContain('x2_stat');
  const btn = page.locator('[data-hud="ad-x2_stat"]');
  await expect(btn).toContainText(/Реклама: ×2 за шаг на 3/);
  await btn.dispatchEvent('click');
  await page.waitForFunction(() => window.__TEST__!.state().adBusy === null && window.__TEST__!.state().pauseReasons.length === 0, undefined, { timeout: 20_000 });
  expect(await page.evaluate(() => window.__TEST__!.state().boostSec)).toBeGreaterThan(170);
  await page.waitForTimeout(1_500);
  expect(await buttons(page), 'no button while the boost runs').not.toContain('x2_stat');
});
