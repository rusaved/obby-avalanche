import { test, expect, testState, waitTicks } from './fixtures.ts';

// M3-02: the shoes button (docs/01-gdd.md 6.4, 7.1, 10.1): appears the first time coins reach the next pair, at the
// bottom centre, one tap buys; after that it stays on the HUD, grey while coins are short.
test('shoes button: shows when coins first suffice, one tap buys, then stays grey while short', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame();
  let s = await testState(page);
  expect(s.shoeLevel).toBe(0);
  expect(s.shoesButton.shown).toBe(false);
  // 29 coins: the Runners cost 30 — still hidden.
  await page.evaluate(() => window.__TEST__!.setCoins(29));
  await waitTicks(page, 5);
  expect((await testState(page)).shoesButton.shown).toBe(false);
  await page.evaluate(() => window.__TEST__!.setCoins(30));
  await waitTicks(page, 5);
  s = await testState(page);
  expect(s.shoesButton).toEqual({ shown: true, text: 'Кроссовки ×2 · 30', can: true });
  // Bottom centre (docs/01-gdd.md 10.1).
  const box = (await page.locator('[data-hud="shoes"]').boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - 960)).toBeLessThan(4);
  expect(1080 - (box.y + box.height)).toBeLessThan(40);
  await page.screenshot({ path: 'docs/evidence/M3/shoes_can_1920x1080_ru.png' });

  await page.locator('[data-hud="shoes"]').click();
  await waitTicks(page, 5);
  s = await testState(page);
  expect(s.shoeLevel).toBe(1);
  expect(s.coins).toBe(0);
  expect(s.gainMult).toBe(2);
  expect(s.shoesButton).toEqual({ shown: true, text: 'Кроссовки ×3 · 200', can: false });
  // Short of coins: the button stays, grey, a tap does nothing.
  await page.evaluate(() => window.__TEST__!.setCoins(120));
  await waitTicks(page, 5);
  await page.locator('[data-hud="shoes"]').click();
  await waitTicks(page, 5);
  s = await testState(page);
  expect(s.shoeLevel).toBe(1);
  expect(s.coins).toBe(120);
  expect(s.shoesButton).toMatchObject({ shown: true, can: false });
  const grey = await page.locator('[data-hud="shoes"]').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(grey).toBe('rgb(154, 167, 180)');
  await page.screenshot({ path: 'docs/evidence/M3/shoes_short_1920x1080_ru.png' });
});
