import { test, expect, testState, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { STAGES, ready, threshold } from './lv-stage-data.ts';

// ST-07 (producer 22.10, the rest of «Avalanche 12»): «Sneakers» over the blue button, the button smaller and the level bar
// the main plaque; no fullscreen ad in the first seconds after a roll-back; «×2» by the chest stays after a failed load;
// an egg for an ad at most 5 a day; 2 sets of steps for an ad through the common logic of the ads; «×2 per step · 3 min»
// in «Gifts» (grey with the boost's time while it runs) and the boost badge on the HUD (Q-M4-1 B); the banner stub of the
// link only on a desktop (Q-M4-3 B).
const W = STAGES[0]!;
const tap = (page: Page, hud: string): Promise<void> => page.locator(`[data-hud="${hud}"]`).dispatchEvent('pointerdown');
const rewarded = (page: Page): Promise<number> => page.evaluate(() => window.__YA_MOCK__!.calls.filter((c) => c.name === 'adv.showRewardedVideo').length);

test.describe('the phone 815 × 290', () => {
  test.use({ viewport: { width: 815, height: 290 }, hasTouch: true, isMobile: true });

  test('ST-07: «Sneakers» over the button, the button 44 high, the level bar 30+ high', async ({ page, openGame }) => {
    await openGame('pace=stages&mock_device=mobile');
    await page.evaluate((z) => {
      window.__TEST__!.setPlaySec(400);
      window.__TEST__!.setFlag('firstWaveDone', true);
      window.__TEST__!.holdWave(9000);
      window.__TEST__!.setStat(20000);
      window.__TEST__!.setCoins(5000);
      window.__TEST__!.teleport(z, 0, 9);
    }, W.stages[1]!.z0 - 20);
    await waitTicks(page, 30);
    const shoes = page.locator('[data-hud="shoes"]');
    await expect(shoes).toBeVisible();
    const cap = shoes.locator('.hud-shoes-cap');
    await expect(cap).toHaveText(/Кроссовки|Sneakers/);
    const b = (await shoes.boundingBox())!;
    const c = (await cap.boundingBox())!;
    expect(c.y + c.height, 'the caption over the button').toBeLessThanOrEqual(b.y + 1);
    expect(b.height).toBeLessThanOrEqual(46);
    expect(b.width, 'the button smaller (MU round 5: 158)').toBeLessThan(158);
    const bar = (await page.locator('.hud-level-bar').boundingBox())!;
    expect(bar.height, 'the level bar the main plaque').toBeGreaterThanOrEqual(30);
    await page.screenshot({ path: 'docs/evidence/ST/815x290/hud-shoes-level.png' });
  });

  test('ST-07, Q-M4-1 B: «×2 per step · 3 min» in «Gifts», grey with the time while the boost runs; the badge on the HUD', async ({ page, openGame }) => {
    await openGame('pace=stages&mock_device=mobile');
    await page.evaluate(() => {
      window.__TEST__!.setPlaySec(400);
      window.__TEST__!.setFlag('firstWaveDone', true);
      window.__TEST__!.holdWave(9000);
    });
    await page.evaluate(() => window.__TEST__!.runSim(65));
    await tap(page, 'gift');
    const card = page.locator('[data-role="window"].open [data-role="gift-boost"]');
    await expect(card).toContainText(/×2 за шаг|×2 per step/);
    const btn = card.locator('[data-hud="gift-boost-ad"]');
    await expect(btn).toBeEnabled();
    await expect(btn).toContainText(/Реклама|Ad/);
    await btn.click();
    await expect.poll(() => rewarded(page), { timeout: 10_000 }).toBe(1);
    await page.waitForFunction(() => window.__TEST__!.state().adBusy === null, undefined, { timeout: 15_000 });
    await expect(card).toContainText(/идёт|on/);
    await expect(btn).toBeDisabled();
    await page.screenshot({ path: 'docs/evidence/ST/815x290/gifts-boost.png' });
    await page.locator('[data-hud="win-close"]').click();
    await expect(page.locator('[data-role="boost"]')).toBeVisible();
    await expect(page.locator('[data-role="boost"]')).toContainText('×2');
  });

  test('ST-07: no more than 5 eggs for an ad a day; 2 sets of steps for an ad, through the common ad', async ({ page, openGame }) => {
    await openGame('pace=stages&mock_device=mobile');
    await page.evaluate(() => {
      window.__TEST__!.setPlaySec(400);
      window.__TEST__!.setFlag('firstWaveDone', true);
      window.__TEST__!.holdWave(9000);
      window.__TEST__!.setCoins(0);
      window.__TEST__!.setAdEggToday(5);
    });
    await page.evaluate(() => window.__TEST__!.runSim(65));
    await tap(page, 'menu-shop');
    await page.locator('[data-hud="shop-tab-eggs"]').click();
    await expect(page.locator('[data-hud="shop-egg-ad"]')).toHaveCount(0);
    await page.evaluate(() => window.__TEST__!.setAdEggToday(4));
    await page.locator('[data-hud="shop-tab-steps"]').click();
    await page.locator('[data-hud="shop-tab-eggs"]').click();
    await expect(page.locator('[data-hud="shop-egg-ad"]')).toHaveCount(1);
    // The steps: two sets with «▶ Ad: open».
    await page.locator('[data-hud="shop-tab-steps"]').click();
    const ads = page.locator('[data-role="window"].open [data-hud="shop-steps-ad"]');
    await expect(ads).toHaveCount(2);
    await page.screenshot({ path: 'docs/evidence/ST/815x290/steps-ad.png' });
    await ads.first().click();
    await expect.poll(() => rewarded(page), { timeout: 10_000 }).toBe(1);
    // The common logic: the game stands while the ad runs, the set is on after it, one toast.
    await page.waitForFunction(() => window.__TEST__!.state().adBusy === null, undefined, { timeout: 15_000 });
    await expect.poll(async () => (await testState(page)).footsteps?.set).toBe('frost_chime');
    expect((await testState(page)).pauseReasons).not.toContain('ad');
  });
});

test('ST-07: no fullscreen ad in the pause 10 s after a roll-back; past them — the ad', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openGame('pace=stages&mock_ad=ok');
  await waitTicks(page, 10);
  await ready(page);
  await page.evaluate(() => window.__TEST__!.runSim(190));
  // A bridge stage after the maze (no wave of its own there to take the pause away).
  const st = W.stages.find((s) => s.n > 2 && s.width === 'bridge' && W.stages[s.n - 2]!.type === 'maze')!;
  await page.evaluate(([s, z, y]) => {
    window.__TEST__!.setStat(s);
    window.__TEST__!.teleport(z, 0, y + 0.5);
  }, [threshold(st.level) * 1.01, st.start - 4, st.y] as const);
  await waitTicks(page, 10);
  await page.evaluate((z) => window.__TEST__!.botPath([[30, z]]), st.start + 6);
  await page.waitForFunction(() => window.__TEST__!.state().caught !== null, undefined, { timeout: 20_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await page.waitForFunction(() => !window.__TEST__!.state().caught, undefined, { timeout: 20_000 });
  // No wave of the stage in the way (a fullscreen ad never comes on the warning or while it runs).
  await page.evaluate(() => window.__TEST__!.holdWave(9000));
  const asked = (): Promise<boolean> =>
    page.evaluate(() => {
      const before = window.__YA_MOCK__!.calls.filter((c) => c.name === 'adv.showFullscreenAdv').length;
      window.__TEST__!.openMenu(true);
      return window.__YA_MOCK__!.calls.filter((c) => c.name === 'adv.showFullscreenAdv').length > before;
    });
  expect(await asked(), 'right after the roll-back: the pause with no ad').toBe(false);
  await page.waitForFunction(() => window.__TEST__!.state().adBusy === null);
  await page.evaluate(() => window.__TEST__!.openMenu(false));
  await page.evaluate(() => window.__TEST__!.runSim(11));
  expect(await asked(), '11 s later: the ad').toBe(true);
});

test('ST-07: «×2» by the chest stays after a failed load', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 880, height: 405 });
  await openGame('pace=stages&mock_ad=error&mock_device=mobile');
  await waitTicks(page, 10);
  await page.evaluate(() => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.setFlag('firstWaveDone', true);
  });
  const last = W.stages[W.stages.length - 1]!;
  const portal = W.segments.find((s) => s.type === 'portal')!;
  await page.evaluate(([s, z, y]) => {
    window.__TEST__!.setStat(s);
    window.__TEST__!.teleport(z, 0, y + 0.5);
  }, [threshold(last.level) * 2, last.finish[0] + 2, last.y] as const);
  await waitTicks(page, 10);
  await page.evaluate((z) => window.__TEST__!.botPath([[0, z + 2]]), portal.z);
  const win = page.locator('[data-role="window"][data-window="summit"]');
  await expect(win).toBeVisible({ timeout: 40_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  const ad = win.locator('[data-hud="summit-ad"]');
  await expect(ad).toBeVisible();
  await ad.click();
  await page.waitForFunction(() => window.__TEST__!.state().adBusy === null, undefined, { timeout: 15_000 });
  await expect(page.locator('[data-role="toast"]')).toContainText(/недоступно|unavailable/);
  await expect(ad).toBeVisible();
});

for (const [w, h, touch] of [[815, 290, true], [1280, 720, false]] as const)
  test(`ST-07, Q-M4-3 B: the banner stub of the link ${touch ? 'off on a phone' : 'on the right on a desktop'} (${w} × ${h})`, async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL ?? '', viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      (window as unknown as { __YA_MOCK_PAGES__: boolean }).__YA_MOCK_PAGES__ = true;
    });
    await page.goto(`/?pace=stages${touch ? '&mock_device=mobile' : ''}`);
    await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 60_000 });
    await page.waitForTimeout(5_000);
    await expect(page.locator('#__ya_mock_banner__')).toHaveCount(touch ? 0 : 1);
    await ctx.close();
  });
