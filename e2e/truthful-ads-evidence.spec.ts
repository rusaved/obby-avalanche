import { test, expect } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { STAGES, threshold } from './lv-stage-data.ts';

// M4 frames (producer 22.10): at 880 × 405 and 815 × 290 — the banner on the right, the fullscreen stub, every «Ad»
// button in its place («Gifts», «Shop → Eggs», «Mountain cleared») and the toast of the reward. docs/evidence/M4/<size>/.

const dirOf = (page: Page): string => {
  const { width, height } = page.viewportSize()!;
  const d = `docs/evidence/M4/${width}x${height}`;
  mkdirSync(d, { recursive: true });
  return d;
};
async function tap(page: Page, hud: string): Promise<void> {
  const b = page.locator(`[data-hud="${hud}"]`).first();
  await b.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
  await b.dispatchEvent('click', { detail: 1 });
}
async function start(page: Page, openGame: (q?: string) => Promise<void>, q = ''): Promise<void> {
  await openGame(`pace=stages&mock_fullscreen=deny&mock_banner=1&mock_ad_ms=3000${q}`);
  const { height } = page.viewportSize()!;
  await page.evaluate((s) => {
    const t = window.__TEST__!;
    t.setPlaySec(400);
    t.setFlag('firstWaveDone', true);
    t.holdWave(9000);
    t.setStat(s);
    t.setCoins(120);
  }, threshold(3));
  await page.touchscreen.tap(200, height / 2);
  await page.waitForTimeout(600);
}

test('frames: «Gifts» with «Ad», its toast; «Shop → Eggs» with «Ad: Snow egg»; the fullscreen stub over the pause', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await start(page, openGame);
  const dir = dirOf(page);
  await tap(page, 'gift');
  await expect(page.locator('[data-role="window"].open [data-hud="gift-ad"]')).toBeVisible();
  await page.screenshot({ path: `${dir}/ad-gifts.png` });
  await page.locator('[data-role="window"].open [data-hud="gift-ad"]').click();
  await expect(page.locator('#__ya_mock_ad__')).toBeVisible();
  await page.screenshot({ path: `${dir}/ad-rewarded-stub.png` });
  await expect(page.locator('#__ya_mock_ad__')).toHaveCount(0, { timeout: 8_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-role="toast"]')).toContainText(/Скорости/, { timeout: 5_000 });
  await page.screenshot({ path: `${dir}/ad-toast.png` });
  await page.waitForTimeout(3_500);
  await tap(page, 'menu-shop');
  await page.locator('[data-hud="shop-tab-eggs"]').click();
  await expect(page.locator('[data-hud="shop-egg-ad"]')).toBeVisible();
  await page.screenshot({ path: `${dir}/ad-egg.png` });
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__TEST__!.runSim(185));
  await tap(page, 'pause');
  await expect(page.locator('#__ya_mock_ad__')).toBeVisible();
  await page.screenshot({ path: `${dir}/ad-fullscreen-menu.png` });
});

test('frames: «Mountain cleared» — «Next» and «Ad: ×2» by the chest apart', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await start(page, openGame);
  const W = STAGES[0]!;
  const last = W.stages[W.stages.length - 1]!;
  const portal = W.segments.find((s) => s.type === 'portal')!;
  await page.evaluate((s) => window.__TEST__!.setStat(s), threshold(40));
  await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y), [last.finish[0] + 2, last.y + 0.5] as const);
  await page.evaluate((z) => window.__TEST__!.botPath([[0, z + 2]]), portal.z);
  await expect(page.locator('[data-role="window"].open')).toBeVisible({ timeout: 40_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dirOf(page)}/ad-summit.png` });
});
