import { test, expect } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { threshold } from './lv-stage-data.ts';

// M4-00 (producer 22.10, the truthful stand on the producer's link): the sticky banner of the platform on the right — a
// stub of 160 px out of the frame of the game, the game narrows by itself (Q-MU-16 А); a fullscreen ad — a dark screen
// «Реклама» for 3 s, the sound and the game stand while it plays and go on after. On the truthful profile.

const dirOf = (page: Page): string => {
  const { width, height } = page.viewportSize()!;
  const d = `docs/evidence/M4/${width}x${height}`;
  mkdirSync(d, { recursive: true });
  return d;
};

test('the banner stub on the right: the canvas and the HUD wholly left of it', async ({ page, openGame }) => {
  await openGame('pace=stages&mock_fullscreen=deny&mock_banner=1');
  const { width, height } = page.viewportSize()!;
  await page.evaluate((s) => {
    const t = window.__TEST__!;
    t.setPlaySec(400);
    t.setCoins(5300);
    t.holdWave(900);
    t.setStat(s);
  }, threshold(3));
  await page.touchscreen.tap(200, height / 2);
  const banner = page.locator('#__ya_mock_banner__');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/Реклама|Ad/);
  expect(await banner.boundingBox()).toMatchObject({ x: width - 160, width: 160 });
  await expect.poll(async () => (await page.locator('#game').boundingBox())!.width).toBe(width - 160);
  const over = await page.evaluate((edge) => Array.from(document.querySelectorAll<HTMLElement>('.hud [data-hud], .hud [data-role]')).filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && r.right > edge + 0.5;
  }).map((e) => e.dataset['hud'] ?? e.dataset['role']), width - 160);
  expect(over, 'nothing of the HUD under the banner').toEqual([]);
  expect(await page.evaluate(() => window.__YA_MOCK__!.calls.some((c) => c.name === 'adv.showBannerAdv'))).toBe(false);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${dirOf(page)}/stand-banner.png` });
});

test('a fullscreen ad: the dark screen «Реклама» for 3 s, the game and the sound stand, then go on', async ({ page, openGame }) => {
  await openGame('pace=stages&mock_fullscreen=deny&mock_ad_ms=3000');
  const { width, height } = page.viewportSize()!;
  await page.evaluate((s) => {
    const t = window.__TEST__!;
    t.setPlaySec(400);
    t.holdWave(900);
    t.setStat(s);
  }, threshold(3));
  await page.touchscreen.tap(width / 2, height / 2);
  await expect.poll(() => page.evaluate(() => window.__TEST__!.state().audioRunning)).toBe(true);
  const done = page.evaluate(() => window.__TEST__!.showAd('interstitial'));
  const ad = page.locator('#__ya_mock_ad__');
  await expect(ad).toBeVisible();
  await expect(ad).toContainText('Реклама');
  const t0 = Date.now();
  await expect.poll(() => page.evaluate(() => window.__TEST__!.state().audioRunning), { timeout: 2_000 }).toBe(false);
  const tick0 = await page.evaluate(() => window.__TEST__!.state().simTick);
  await page.waitForTimeout(1_000);
  expect(await page.evaluate(() => window.__TEST__!.state().simTick), 'the game stands').toBe(tick0);
  await page.screenshot({ path: `${dirOf(page)}/stand-fullscreen.png` });
  await expect(ad).toHaveCount(0, { timeout: 5_000 });
  expect(Date.now() - t0, 'about 3 s').toBeGreaterThanOrEqual(2_000);
  expect(await done).toMatchObject({ shown: true });
  await expect.poll(() => page.evaluate(() => window.__TEST__!.state().audioRunning)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__TEST__!.state().simTick)).toBeGreaterThan(tick0);
});
