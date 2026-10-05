import { test, expect, testState, waitTicks } from './fixtures.ts';

// M3-04: trails and auras for trophies (docs/01-gdd.md 7.3), the wardrobe with the default skin of skins.json (7.4).
test('wardrobe opens with the default skin on the hero; trail and aura bought for trophies go into the step and stay after F5', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame();
  let s = await testState(page);
  expect(s.skin).toBe('tangerine'); // skins.json default
  expect(s.trophyPlaque.shown).toBe(false);
  expect(s.menu).toEqual([]);
  // After the first summit (trophies) and 180 s of play: trophy plaque, Shop, Pets, Wardrobe (docs/01-gdd.md 6.4).
  await page.evaluate(() => {
    window.__TEST__!.setTrophies(30);
    window.__TEST__!.setPlaySec(181);
  });
  await waitTicks(page, 3);
  s = await testState(page);
  expect(s.trophyPlaque).toEqual({ shown: true, text: '30' });
  expect(s.menu).toEqual(['shop', 'pets', 'wardrobe']);

  await page.locator('[data-hud="menu-wardrobe"]').dispatchEvent('pointerdown');
  await expect(page.locator('[data-role="window"][data-window="wardrobe"]')).toBeVisible();
  await expect(page.locator('[data-role="wardrobe-hero"]')).toBeVisible();
  await expect(page.locator('[data-role="wardrobe-grid"] [data-skin="tangerine"]')).toHaveClass(/on/);
  await expect(page.locator('[data-hud="wardrobe-tab-skins"]')).toHaveText('Скины 1/1');
  s = await testState(page);
  expect(s.window).toBe('wardrobe');
  expect(s.pauseReasons).toContain('menu');
  expect(s.skin).toBe('tangerine');
  await page.screenshot({ path: 'docs/evidence/M3/wardrobe_1920x1080_ru.png' });
  await page.locator('[data-hud="win-close"]').click();

  // Shop: trail «Snow Trail» ×1.1 for 3 trophies, aura «Sparks» ×1.2 for 8.
  await page.locator('[data-hud="menu-shop"]').dispatchEvent('pointerdown');
  await expect(page.locator('[data-role="window"][data-window="shop"]')).toBeVisible();
  await expect(page.locator('[data-item="trail_comet"] [data-hud="shop-item"]')).toHaveText('Ещё 970');
  await page.locator('[data-item="trail_snow"] [data-hud="shop-item"]').click();
  s = await testState(page);
  expect(s.trophies.now).toBe(27);
  expect(s.trail).toBe('trail_snow');
  expect(s.gainMult).toBeCloseTo(1.1, 9);
  await expect(page.locator('[data-item="trail_snow"] [data-hud="shop-item"]')).toHaveText('Надето');
  await page.locator('[data-hud="shop-tab-auras"]').click();
  await page.locator('[data-item="aura_sparks"] [data-hud="shop-item"]').click();
  s = await testState(page);
  expect(s.trophies.now).toBe(19);
  expect(s.aura).toBe('aura_sparks');
  expect(s.gainMult).toBeCloseTo(1.1 * 1.2, 9);
  await page.screenshot({ path: 'docs/evidence/M3/shop_auras_1920x1080_ru.png' });
  await page.keyboard.press('Escape');
  await waitTicks(page, 3);
  expect((await testState(page)).window).toBeNull();

  // The hero runs with the trail and the aura on.
  const before = (await testState(page)).stat;
  await page.evaluate(() => window.__TEST__!.botPath([[0, 120]]));
  await waitTicks(page, 50);
  await page.evaluate(() => window.__TEST__!.setCamera({ yaw: -Math.PI * 0.3, pitch: 0.35, dist: 10 }));
  await waitTicks(page, 15);
  await page.screenshot({ path: 'docs/evidence/M3/trail_aura_1920x1080_ru.png' });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  s = await testState(page);
  expect(s.steps).toBeGreaterThan(0);
  expect(s.stat - before).toBeCloseTo(s.steps * 1.1 * 1.2, 6);

  await page.reload();
  await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 60_000 });
  await waitTicks(page, 3);
  s = await testState(page);
  expect([s.trail, s.aura, s.skin, s.trophies.now]).toEqual(['trail_snow', 'aura_sparks', 'tangerine', 19]);
  expect(s.gainMult).toBeCloseTo(1.1 * 1.2, 9);
});
