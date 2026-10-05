import { test, expect, testState, waitTicks } from './fixtures.ts';

// M3-06: rebirth (docs/01-gdd.md 7.5; GDD-08): the button from the first summit with «Mountain a/5», the window shows
// what resets and what stays before the button; the rebirth puts the hero into the camp of mountain 1 with the stat,
// coins and shoes at zero and the step ×3; the portal of mountain 5 opens «All mountains cleared!».
test('rebirth window ru: locked until mountain 5, then rebirth to tier 1 — camp of mountain 1, stat and coins 0, step ×3; screenshot rebirth_1920x1080_ru.png', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame();
  let s = await testState(page);
  expect(s.menu).not.toContain('rebirth');
  // First summit done: the button shows with a lock and «Mountain 1/5».
  await page.evaluate(() => {
    window.__TEST__!.setTrophies(3);
    window.__TEST__!.setSummits(1);
    window.__TEST__!.givePet('bunny');
  });
  await waitTicks(page, 3);
  s = await testState(page);
  expect(s.menu).toContain('rebirth');
  await expect(page.locator('[data-hud="menu-rebirth"]')).toContainText('Гора 1/5');
  await page.locator('[data-hud="menu-rebirth"]').dispatchEvent('pointerdown');
  await expect(page.locator('[data-role="window"][data-window="rebirth"]')).toBeVisible();
  await expect(page.locator('[data-hud="rebirth-do"]')).toBeDisabled();
  await expect(page.locator('[data-role="rebirth-locked"]')).toHaveText('Дойди до вершины горы 5 · Гора 1/5');
  s = await testState(page);
  expect(s.pauseReasons).toContain('menu');
  await page.locator('[data-hud="rebirth-later"]').click();
  await waitTicks(page, 2);
  expect((await testState(page)).window).toBeNull();

  // The summit of mountain 5 done on this tier, a big stat, coins enough for an egg, shoes bought.
  await page.evaluate(() => {
    window.__TEST__!.setSummits(5);
    window.__TEST__!.setStat(5e9);
    window.__TEST__!.setCoins(1e6);
  });
  await expect(page.locator('[data-hud="shoes"]')).toBeVisible();
  await page.locator('[data-hud="shoes"]').dispatchEvent('pointerdown');
  await waitTicks(page, 3);
  s = await testState(page);
  expect(s.shoeLevel).toBeGreaterThan(0);
  expect(s.gainMult).toBeGreaterThan(1.2);
  await expect(page.locator('[data-hud="menu-rebirth"]')).toContainText('Перерождение');
  await page.locator('[data-hud="menu-rebirth"]').dispatchEvent('pointerdown');
  const win = page.locator('[data-role="window"][data-window="rebirth"]');
  await expect(win.locator('.win-title')).toHaveText('Перерождение');
  await expect(page.locator('[data-role="rebirth-tier"]')).toHaveText('Ступень 1');
  await expect(page.locator('[data-role="rebirth-resets"]')).toContainText('Обнулится');
  await expect(page.locator('[data-role="rebirth-resets"] li')).toHaveText(['Скорость', 'Монеты', 'Кроссовки', 'Горы — снова с первой']);
  await expect(page.locator('[data-role="rebirth-keeps"] li')).toHaveText(['Питомцы', 'Скины и крылья', 'Трейлы и ауры', 'Кубки', 'Календарь и задания']);
  await expect(page.locator('[data-role="rebirth-gets"]')).toContainText('Каждый шаг ×3 навсегда: ×1 → ×3');
  await expect(page.locator('[data-role="rebirth-reward"]')).toContainText('Снежный ниндзя');
  await expect(page.locator('[data-role="rebirth-gets"]')).toContainText('Больше кубков за каждую вершину');
  await expect(win).toContainText('Горы станут выше');
  await expect(page.locator('[data-role="rebirth-hint"]')).toContainText('Потрать монеты на яйца — монеты обнулятся');
  // «To eggs» leads to the shop tab «Eggs» (M3-09).
  await expect(page.locator('[data-hud="rebirth-eggs"]')).toHaveText('К яйцам');
  await expect(page.locator('[data-hud="rebirth-do"]')).toBeEnabled();
  // One screen: the window body does not scroll.
  expect(await page.locator('.win-body').evaluate((b) => b.scrollHeight <= b.clientHeight + 1)).toBe(true);
  await page.screenshot({ path: 'docs/evidence/M3/rebirth_1920x1080_ru.png' });

  await page.locator('[data-hud="rebirth-do"]').click();
  await waitTicks(page, 5);
  s = await testState(page);
  expect(s.window).toBeNull();
  expect(s.tier).toBe(1);
  expect(s.world).toBe('slope');
  expect(s.hero!.z).toBeLessThan(40);
  expect(s.stat).toBe(0);
  expect(s.coins).toBe(0);
  expect(s.shoeLevel).toBe(0);
  expect(s.summits).toBe(0);
  expect(s.skin).toBe('snow_ninja');
  expect(s.trophies.now).toBe(3);
  expect(s.pets).toContain('bunny');
  expect(s.waveHud.toast).toContain('Ступень 1! Шаг ×3');
  // Step ×3 of the tier with the starting pair: the shoes multiplier went, the pet (Bunny +20%) stayed.
  expect(s.gainMult).toBeCloseTo(3 * 1.2, 6);
  // Walls of tier 1: × wallScale[1] = 15 (wall 1: 20 → 300).
  expect(await page.evaluate(() => window.__TEST__!.gateSign(0).text)).toBe('0/300');
  const names = (await page.evaluate(() => window.__TEST__!.analytics())).map((e) => e.name);
  expect(names.filter((n) => n === 'rebirth_1')).toHaveLength(1);
  // The button stays with the lock: no summit on the new tier yet.
  await expect(page.locator('[data-hud="menu-rebirth"]')).toContainText('Гора 0/5');
});

test('portal of mountain 5 opens «All mountains cleared!»: «Rebirth» opens the rebirth window, «Stay» keeps the hero on the summit', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openGame();
  await page.evaluate(() => {
    window.__TEST__!.setTrophies(10);
    window.__TEST__!.setSummits(4);
    window.__TEST__!.gotoWorld(5);
  });
  await waitTicks(page, 5);
  // Summit of mountain 5: wall 12 at z = 40 + 12 × 130 = 1600, the portal arch at z = 1650.
  await page.evaluate(() => {
    window.__TEST__!.setStat(2e10);
    window.__TEST__!.teleport(1620);
    window.__TEST__!.setAutoRun(true);
  });
  await page.waitForFunction(() => window.__TEST__!.state().window === 'allDone', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setAutoRun(false));
  let s = await testState(page);
  expect(s.summits).toBe(5);
  expect(s.rebirthReady).toBe(true);
  expect(s.world).toBe('aurora');
  await expect(page.locator('[data-role="window"][data-window="allDone"] .win-title')).toHaveText('Все горы пройдены!');
  await expect(page.locator('[data-role="window"][data-window="allDone"]')).toContainText('Переродись — шаг станет ×3. Или оставайся на вершине');
  await page.screenshot({ path: 'docs/evidence/M3/all_done_1280x720_ru.png' });
  await page.locator('[data-hud="alldone-rebirth"]').click();
  await expect(page.locator('[data-role="window"][data-window="rebirth"]')).toBeVisible();
  await expect(page.locator('[data-hud="rebirth-do"]')).toBeEnabled();
  await page.locator('[data-hud="rebirth-later"]').click();
  await waitTicks(page, 3);
  s = await testState(page);
  expect(s.window).toBeNull();
  expect(s.world).toBe('aurora');
  expect(s.tier).toBe(0);
  expect(s.hero!.z).toBeGreaterThan(1600);
});
