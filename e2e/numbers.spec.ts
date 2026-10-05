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

// Playtest M2: the wall sign read «4 ,2K/12K» and ran past its plaque. Same format as the HUD, proportional glyphs.
test('wall sign in progress: «4,2K/12K» as on the HUD goal bar, plaque fits; screenshot', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame();
  // Wall 6 of mountain 1: 12K at z = 580; the hero below it.
  await page.evaluate(() => window.__TEST__!.teleport(568, 0));
  await page.evaluate(() => window.__TEST__!.setStat(4200));
  await waitTicks(page, 30);
  const sign = await page.evaluate(() => window.__TEST__!.gateSign(5));
  expect(sign).toEqual({ text: '4,2K/12K', open: false });
  await page.screenshot({ path: 'docs/evidence/M3/gate_sign_1920x1080_ru.png' });
});
