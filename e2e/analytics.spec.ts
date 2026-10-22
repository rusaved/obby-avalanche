import { test, expect } from './fixtures.ts';

// M4-09 (docs/06-analytics.md section 2): the funnel in its order and multiplicity — game_ready, then first_input once for
// the player's life, session_60s…600s once a load in game time; the Metrika script is not loaded outside Yandex.

test('M4-09 the funnel: game_ready → first_input once; session_60s, 180s, 300s, 600s once each in game time; no Metrika', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await openGame('pace=stages');
  await page.evaluate(() => window.__TEST__!.holdWave(9000));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyW');
  await page.keyboard.press('Space');
  await page.evaluate(() => window.__TEST__!.runSim(610));
  const names = await page.evaluate(() => window.__TEST__!.analytics().map((e) => e.name));
  const once = (n: string): number => names.filter((x) => x === n).length;
  expect(once('game_ready')).toBe(1);
  expect(once('first_input')).toBe(1);
  expect(names.indexOf('game_ready')).toBeLessThan(names.indexOf('first_input'));
  for (const s of ['session_60s', 'session_180s', 'session_300s', 'session_600s']) expect(once(s), s).toBe(1);
  expect(names.indexOf('session_60s')).toBeLessThan(names.indexOf('session_180s'));
  expect(names.indexOf('session_300s')).toBeLessThan(names.indexOf('session_600s'));
  // Outside Yandex (counter 0): no script of Metrika on the page.
  expect(await page.evaluate(() => Array.from(document.scripts).some((s) => s.src.includes('mc.yandex')))).toBe(false);
  // F5: first_input is the player's, not the load's.
  await page.reload();
  await page.waitForFunction(() => window.__TEST__?.ready === true);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyW');
  expect(await page.evaluate(() => window.__TEST__!.analytics().filter((e) => e.name === 'first_input').length)).toBe(0);
});
