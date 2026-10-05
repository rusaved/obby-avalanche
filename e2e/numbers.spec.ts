import { test, expect, waitTicks } from './fixtures.ts';

// M3-11: big numbers on the HUD (docs/01-gdd.md 10.4): 3 significant digits and a suffix from i18n, ru with a comma.
test('Speed of a late tier on the HUD: «1,23Qa» with the suffix from ru.json; screenshot', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame();
  await page.evaluate(() => window.__TEST__!.setStat(1.234e15));
  await waitTicks(page, 10);
  const value = await page.evaluate(() => document.querySelector('.hud-stat-value')?.textContent);
  expect(value).toBe('1,23Qa');
  await page.screenshot({ path: 'docs/evidence/M3/numbers_1920x1080_ru.png' });
});
