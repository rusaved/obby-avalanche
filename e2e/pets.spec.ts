import { test, expect, testState, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';

/** Buys the egg of the stand the hero stands at and waits for the pet (1 s of game time). */
async function buyEgg(page: Page): Promise<void> {
  const before = (await testState(page)).pets.length;
  await page.locator('[data-hud="egg"]').click();
  await page.waitForFunction((n) => window.__TEST__!.state().pets.length > n, before, { timeout: 30_000 });
}

// M3-03: eggs and pets (docs/01-gdd.md 7.2, 10.2): the stand in the camp sells the Snow Egg for 500, the egg hatches in
// 1 s without a window, 3 pets on hop next to the hero; the «Pets» window keeps 3 on at most and the game stands.
test('eggs and pets: buy at the camp stand, hatch in 1 s, 3 pets on next to the hero, the Pets window', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame('seed=7');
  let s = await testState(page);
  expect(s.menu).toEqual([]);
  // The stand of the camp (worlds.json: eggStand x 8, z 30): the hero walks up and stands — the button shows.
  await page.evaluate(() => window.__TEST__!.teleport(27.6, 8));
  await waitTicks(page, 20);
  s = await testState(page);
  expect(s.eggButton).toEqual({ shown: true, text: 'Снежное яйцо · 500', can: false, egg: 'snow' });
  await page.evaluate(() => window.__TEST__!.setCoins(2000));
  await waitTicks(page, 3);
  expect((await testState(page)).eggButton.can).toBe(true);

  const t0 = (await testState(page)).timeSec;
  await page.locator('[data-hud="egg"]').click();
  await waitTicks(page, 3);
  s = await testState(page);
  expect(s.coins).toBe(1500);
  expect(s.hatching?.egg).toBe('snow');
  expect(s.eggButton.shown).toBe(false);
  expect(s.window).toBeNull();
  await page.waitForFunction(() => window.__TEST__!.state().pets.length === 1, undefined, { timeout: 30_000 });
  s = await testState(page);
  // 1 s of game time from the tap to the pet, no window.
  expect(s.timeSec - t0).toBeGreaterThanOrEqual(1);
  expect(s.timeSec - t0).toBeLessThan(1.5);
  expect(s.window).toBeNull();
  expect(s.petsOn).toEqual(s.pets);
  for (let i = 0; i < 3; i++) {
    await waitTicks(page, 5);
    await buyEgg(page);
  }
  s = await testState(page);
  expect(s.pets).toHaveLength(4);
  expect(s.coins).toBe(0);
  expect(s.petsOn).toHaveLength(3);
  expect(s.petsShown).toBe(3);
  // Off the stand, the toast gone: the hero and his 3 pets from the front side.
  await page.evaluate(() => window.__TEST__!.teleport(34, -3));
  await page.evaluate(() => window.__TEST__!.setCamera({ yaw: Math.PI * 0.62, pitch: 0.55, dist: 12 }));
  await waitTicks(page, 160);
  expect((await testState(page)).petsShown).toBe(3);
  await page.screenshot({ path: 'docs/evidence/M3/pets_1920x1080_ru.png' });
  await page.evaluate(() => window.__TEST__!.setCamera('auto'));

  // The «Pets» button shows from 180 s of play (docs/01-gdd.md 6.4) and opens the window; the game stands.
  await page.evaluate(() => window.__TEST__!.setPlaySec(185));
  await waitTicks(page, 3);
  expect((await testState(page)).menu).toEqual(['shop', 'pets', 'daily']);
  await page.locator('[data-hud="menu-pets"]').dispatchEvent('pointerdown');
  await expect(page.locator('[data-role="window"][data-window="pets"]')).toBeVisible();
  s = await testState(page);
  expect(s.window).toBe('pets');
  expect(s.pauseReasons).toContain('menu');
  const ticks = s.ticks;
  await page.waitForTimeout(400);
  expect((await testState(page)).ticks).toBe(ticks);
  await expect(page.locator('[data-role="pets-count"]')).toHaveText('Питомцы 2/27');
  await expect(page.locator('[data-role="pets-grid"] .card')).toHaveCount(4);
  // The 4th pet cannot go on while 3 are on.
  const off = page.locator('[data-role="pets-grid"] .card:not(.on) [data-hud="pet-equip"]');
  await off.click();
  expect((await testState(page)).petsOn).toHaveLength(3);
  await page.screenshot({ path: 'docs/evidence/M3/pets_window_1920x1080_ru.png' });
  // Unequip one, equip the 4th; «Equip best» puts the 3 strongest back.
  await page.locator('[data-role="pets-grid"] .card.on [data-hud="pet-unequip"]').first().click();
  expect((await testState(page)).petsOn).toHaveLength(2);
  await page.locator('[data-hud="pets-best"]').click();
  expect((await testState(page)).petsOn).toHaveLength(3);
  // Esc, a tap on the veil and the cross close the window; the game goes on.
  await page.keyboard.press('Escape');
  await waitTicks(page, 3);
  s = await testState(page);
  expect(s.window).toBeNull();
  expect(s.pauseReasons).not.toContain('menu');
  await page.locator('[data-hud="menu-pets"]').dispatchEvent('pointerdown');
  await page.mouse.click(30, 540);
  expect((await testState(page)).window).toBeNull();
  await page.locator('[data-hud="menu-pets"]').dispatchEvent('pointerdown');
  await page.locator('[data-hud="win-close"]').click();
  await waitTicks(page, 3);
  expect((await testState(page)).window).toBeNull();
});
