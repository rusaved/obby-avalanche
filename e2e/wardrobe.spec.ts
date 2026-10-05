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
  // After the first summit (trophies) and 180 s of play: trophy plaque, Shop, Pets, Wardrobe, Rebirth (docs/01-gdd.md 6.4).
  await page.evaluate(() => {
    window.__TEST__!.setTrophies(30);
    window.__TEST__!.setPlaySec(185);
  });
  await waitTicks(page, 3);
  s = await testState(page);
  expect(s.trophyPlaque).toEqual({ shown: true, text: '30' });
  expect(s.menu).toEqual(['shop', 'pets', 'wardrobe', 'daily', 'quests', 'rebirth']);

  await page.locator('[data-hud="menu-wardrobe"]').dispatchEvent('pointerdown');
  await expect(page.locator('[data-role="window"][data-window="wardrobe"]')).toBeVisible();
  await expect(page.locator('[data-role="wardrobe-hero"]')).toBeVisible();
  await expect(page.locator('[data-role="wardrobe-grid"] [data-skin="tangerine"]')).toHaveClass(/on/);
  await expect(page.locator('[data-hud="wardrobe-tab-skins"]')).toHaveText('Скины 1/12');
  s = await testState(page);
  expect(s.window).toBe('wardrobe');
  expect(s.pauseReasons).toContain('menu');
  expect(s.skin).toBe('tangerine');
  await page.screenshot({ path: 'docs/evidence/M3/wardrobe_1920x1080_ru.png' });
  await page.locator('[data-hud="win-close"]').click();

  // Shop: trail «Snow Trail» ×1.1 for 3 trophies, aura «Sparks» ×1.2 for 8.
  await page.locator('[data-hud="menu-shop"]').dispatchEvent('pointerdown');
  await expect(page.locator('[data-role="window"][data-window="shop"]')).toBeVisible();
  await page.locator('[data-hud="shop-tab-trails"]').click();
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

// M3-04b: skins and wings (docs/01-gdd.md 7.4): bought for trophies in the wardrobe, locked ones show their source,
// the change is seen on the hero, numbers stay, everything survives F5.
test('wardrobe: a skin and wings for trophies go onto the hero, locked cards show the source; F5 keeps them', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame();
  await page.evaluate(() => {
    window.__TEST__!.setTrophies(20);
    window.__TEST__!.setPlaySec(185);
  });
  await waitTicks(page, 3);
  const gain0 = (await testState(page)).gainMult;
  await page.locator('[data-hud="menu-wardrobe"]').dispatchEvent('pointerdown');
  await expect(page.locator('[data-hud="wardrobe-tab-skins"]')).toHaveText('Скины 1/12');
  await expect(page.locator('[data-hud="wardrobe-tab-wings"]')).toHaveText('Крылья 0/8');
  const grid = page.locator('[data-role="wardrobe-grid"]');
  await expect(grid.locator('[data-skin="snow_ninja"] [data-role="look-source"]')).toHaveText('Ступень 1');
  await expect(grid.locator('[data-skin="penguin_suit"] [data-role="look-source"]')).toHaveText('День 2');
  await expect(grid.locator('[data-skin="golden"] [data-role="look-source"]')).toHaveText('Стартовый набор');
  await expect(grid.locator('[data-skin="ice_knight"] [data-hud="wardrobe-item"]')).toHaveText('Ещё 20');
  // Skier for 5 trophies: on the hero at once.
  await grid.locator('[data-skin="skier"] [data-hud="wardrobe-item"]').click();
  let s = await testState(page);
  expect(s.skin).toBe('skier');
  expect(s.trophies.now).toBe(15);
  await expect(page.locator('[data-hud="wardrobe-tab-skins"]')).toHaveText('Скины 2/12');
  await expect(grid.locator('[data-skin="skier"] [data-hud="wardrobe-item"]')).toHaveText('Надето');
  await page.screenshot({ path: 'docs/evidence/M3/wardrobe_skins_1920x1080_ru.png' });
  // Wings: ice wings for 10; comet wings locked behind tier 10.
  await page.locator('[data-hud="wardrobe-tab-wings"]').click();
  await expect(grid.locator('[data-wings="wings_comet"] [data-role="look-source"]')).toHaveText('Ступень 10');
  await expect(grid.locator('[data-wings="wings_snow"] [data-role="look-source"]')).toHaveText('День 7');
  await grid.locator('[data-wings="wings_ice"] [data-hud="wardrobe-item"]').click();
  s = await testState(page);
  expect(s.wings).toBe('wings_ice');
  expect(s.trophies.now).toBe(5);
  await expect(page.locator('[data-hud="wardrobe-tab-wings"]')).toHaveText('Крылья 1/8');
  await page.screenshot({ path: 'docs/evidence/M3/wardrobe_wings_1920x1080_ru.png' });
  // Back to the default skin and on again: the hero follows.
  await page.locator('[data-hud="wardrobe-tab-skins"]').click();
  await grid.locator('[data-skin="tangerine"] [data-hud="wardrobe-item"]').click();
  expect((await testState(page)).skin).toBe('tangerine');
  await grid.locator('[data-skin="skier"] [data-hud="wardrobe-item"]').click();
  expect((await testState(page)).skin).toBe('skier');
  await page.keyboard.press('Escape');
  await waitTicks(page, 3);
  // Looks only: the step is the same; the hero runs with the skin and wings, seen from behind and the side.
  expect((await testState(page)).gainMult).toBe(gain0);
  await page.evaluate(() => window.__TEST__!.botPath([[0, 120]]));
  await waitTicks(page, 40);
  await page.evaluate(() => window.__TEST__!.setCamera({ yaw: -0.5, pitch: 0.25, dist: 8 }));
  await waitTicks(page, 15);
  await page.screenshot({ path: 'docs/evidence/M3/skin_wings_1920x1080_ru.png' });
  await page.evaluate(() => window.__TEST__!.botPath(null));

  await page.reload();
  await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 60_000 });
  await waitTicks(page, 3);
  s = await testState(page);
  expect([s.skin, s.wings, s.trophies.now]).toEqual(['skier', 'wings_ice', 5]);
  expect(s.gainMult).toBe(gain0);
});
