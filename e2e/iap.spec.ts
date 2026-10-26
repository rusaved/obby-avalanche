import { test, expect } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { threshold } from './lv-stage-data.ts';

// M4-07 (docs/01-gdd.md 9.3; docs/03 IAP-01, IAP-03, IAP-04): purchases behind game.json payments.enabled (off in the
// game; ?payments=1 here). The «Special» tab from 300 s with the price and the currency picture of the catalog; every
// purchase shows a change within 5 s — never a window «success»: VIP — the gold star and «Was +a, now +b per step»;
// autopilot — the hero runs by himself; starter — the pet by the hero and on, the gold skin, trophies to spend only;
// no ads — its mark in the pause and no fullscreen ad. The fanfare of a summit and the pet jumps with each. Bought before —
// granted at the start. Off — no tab, no ysdk.payments call.

const calls = (page: Page, name: string): Promise<number> => page.evaluate((n) => window.__YA_MOCK__!.calls.filter((c) => c.name === n).length, name);
async function start(page: Page, openGame: (q?: string) => Promise<void>, q: string, play = 400): Promise<void> {
  await openGame(`pace=stages${q}`);
  await page.evaluate(([s, p]) => {
    const t = window.__TEST__!;
    t.setPlaySec(p);
    t.holdWave(9000);
    t.setStat(s);
    t.givePet('penguin');
  }, [threshold(3), play] as const);
  await page.mouse.click(480, 300);
  await page.waitForTimeout(500);
}
async function openSpecial(page: Page): Promise<void> {
  await page.locator('[data-hud="menu-shop"]').dispatchEvent('pointerdown');
  await expect(page.locator('[data-role="window"].open')).toHaveCount(1);
  await page.locator('[data-hud="shop-tab-special"]').click();
}
async function buy(page: Page, id: string): Promise<number> {
  await page.locator(`[data-role="window"].open [data-item="${id}"] [data-hud="shop-item"]`).click();
  return Date.now();
}

// G-10: on in the release now; off — the archive without purchases (VITE_NO_PAYMENTS), here ?payments=0 of the e2e build.
test('IAP off (?payments=0, as the archive without purchases): no «Special» tab, not a single call of ysdk.payments', async ({ page, openGame }) => {
  await start(page, openGame, '&payments=0');
  await page.locator('[data-hud="menu-shop"]').dispatchEvent('pointerdown');
  await expect(page.locator('[data-role="window"].open')).toHaveCount(1);
  await expect(page.locator('[data-hud="shop-tab-special"]')).toHaveCount(0);
  expect(await calls(page, 'getPayments')).toBe(0);
});

test('G-10: on by default (game.json payments.enabled) — «Special» in the shop', async ({ page, openGame }) => {
  await start(page, openGame, '');
  await openSpecial(page);
  await expect(page.locator('[data-role="window"].open [data-item="vip"]')).toHaveCount(1);
});

test('IAP-04 «Special» only from 300 s; IAP-01 the price and the currency picture of the catalog', async ({ page, openGame }) => {
  await start(page, openGame, '&payments=1', 200);
  await page.locator('[data-hud="menu-shop"]').dispatchEvent('pointerdown');
  await expect(page.locator('[data-role="window"].open')).toHaveCount(1);
  await expect(page.locator('[data-hud="shop-tab-special"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
  await page.reload();
  await page.waitForFunction(() => window.__TEST__?.ready === true);
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await page.waitForTimeout(500);
  await openSpecial(page);
  const prices = page.locator('[data-role="window"].open [data-role="iap-price"]');
  await expect(prices).toHaveCount(4);
  await expect(prices.first()).toContainText(/\d+ ян/);
  expect(await page.locator('[data-role="window"].open img.iap-cur').count()).toBe(4);
  mkdirSync('docs/evidence/M4', { recursive: true });
  await page.screenshot({ path: 'docs/evidence/M4/iap-special.png' });
});

test('the show after a purchase: VIP, autopilot, starter, no ads — a change within 5 s, the fanfare, the pet jumps', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await start(page, openGame, '&payments=1');
  const sfx = (): Promise<number> => page.evaluate(() => window.__TEST__!.state().sfx.filter((s) => s === 'rewardTrophy').length);
  const cheers = (): Promise<number> => page.evaluate(() => window.__TEST__!.state().petCheers);
  await openSpecial(page);

  // VIP: the star by the Speed, «Was +a, now +b per step».
  let f0 = await sfx();
  let c0 = await cheers();
  let t0 = await buy(page, 'vip');
  await expect(page.locator('.hud.vip')).toHaveCount(1, { timeout: 5_000 });
  await expect(page.locator('[data-role="toast"]')).toContainText(/Было \+\S+, стало \+\S+ за шаг/, { timeout: 5_000 });
  expect(Date.now() - t0).toBeLessThan(5_000);
  await expect.poll(sfx, { timeout: 5_000 }).toBeGreaterThan(f0);
  expect(await cheers()).toBeGreaterThan(c0);

  // Autopilot: on at once with «Turn off in the settings», the hero runs by himself.
  await openSpecial(page);
  await expect(page.locator('[data-role="window"].open [data-item="vip"]')).toContainText('Куплено');
  f0 = await sfx();
  c0 = await cheers();
  t0 = await buy(page, 'autopilot');
  await expect(page.locator('[data-role="toast"]')).toContainText('выключить в настройках', { timeout: 5_000 });
  const z0 = await page.evaluate(() => window.__TEST__!.state().hero!.z);
  await expect.poll(() => page.evaluate(() => window.__TEST__!.state().hero!.z), { timeout: 5_000 }).toBeGreaterThan(z0 + 1);
  await expect.poll(sfx, { timeout: 5_000 }).toBeGreaterThan(f0);
  expect(await cheers()).toBeGreaterThan(c0);
  await page.evaluate(() => window.__TEST__!.setAutoRun(false));

  // Starter: the gold penguin by the hero and on, the gold skin, 10 trophies to spend — not to the records.
  const tr0 = await page.evaluate(() => window.__TEST__!.state().trophies);
  await openSpecial(page);
  f0 = await sfx();
  t0 = await buy(page, 'starter');
  await expect.poll(() => page.evaluate(() => window.__TEST__!.state().petsOn), { timeout: 5_000 }).toContain('gold_penguin');
  expect(await page.evaluate(() => window.__TEST__!.state().skin)).toBe('golden');
  const tr1 = await page.evaluate(() => window.__TEST__!.state().trophies);
  expect(tr1.now - tr0.now).toBe(10);
  expect(tr1.total).toBe(tr0.total);
  await expect.poll(sfx, { timeout: 5_000 }).toBeGreaterThan(f0);

  // No ads: a toast and its mark in the pause; no fullscreen ad after 3 min of play.
  await openSpecial(page);
  f0 = await sfx();
  t0 = await buy(page, 'no_ads');
  await expect(page.locator('[data-role="toast"]')).toContainText('Полноэкранной рекламы больше нет', { timeout: 5_000 });
  await expect.poll(sfx, { timeout: 5_000 }).toBeGreaterThan(f0);
  await page.evaluate(() => window.__TEST__!.runSim(190));
  await page.evaluate(() => window.__TEST__!.openMenu(true));
  await expect(page.locator('[data-role="no-ads-mark"]')).toHaveText('Без рекламы');
  expect(await calls(page, 'adv.showFullscreenAdv')).toBe(0);
  expect(await calls(page, 'adv.hideBannerAdv')).toBeGreaterThan(0);
});

test('IAP-01 bought before (another device): granted at the start with its show', async ({ page, openGame }) => {
  await start(page, openGame, '&payments=1&mock_purchases=vip');
  await expect(page.locator('.hud.vip')).toHaveCount(1, { timeout: 5_000 });
  expect(await page.evaluate(() => window.__TEST__!.state().flags['iap_vip'])).toBe(true);
  expect(await calls(page, 'payments.getPurchases')).toBe(1);
});
