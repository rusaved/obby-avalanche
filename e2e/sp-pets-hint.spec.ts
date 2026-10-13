import { test, expect, testState, waitTicks } from './fixtures.ts';
import ru from '../content/avalanche/i18n/ru.json' with { type: 'json' };

// SP-09 (docs/01-gdd.md 20.9, Q-065): «Pets speed up your steps» on the open slope — an open egg worth its coins
// (balance.json hints.pets) and the «Shop» button on screen: the plaque is up; no coins for it — gone.
test('the pets hint: up with the shop on screen and the coins for the egg, never before the shop, gone without the coins', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await openGame('pace=open');
  await page.evaluate(() => {
    window.__TEST__!.setPlaySec(60);
    window.__TEST__!.setCoins(5000);
  });
  // No «Shop» yet (ui.unlockMenusSec): no pets hint, whatever the coins.
  for (let k = 0; k < 10; k++) {
    await waitTicks(page, 30);
    expect((await testState(page)).hint).not.toBe('hint.pets');
  }
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await page.waitForFunction(() => window.__TEST__!.state().hint === 'hint.pets', undefined, { timeout: 40_000 });
  expect((await testState(page)).hintText).toBe(ru['hint.pets']);
  await page.evaluate(() => window.__TEST__!.setCoins(0));
  await waitTicks(page, 5);
  expect((await testState(page)).hint).not.toBe('hint.pets');
});
