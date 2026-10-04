import { test, expect, testState, waitTicks } from './fixtures.ts';

// M2-04: a gift pays the coins of its zone; the coin plaque slides in on the first coin (docs/01-gdd.md 6.4, 10.1).
test('first gift: coins of zone 1, the gift disappears, the coin plaque slides in; after the avalanche gifts return', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame();
  let s = await testState(page);
  expect(s.coins).toBe(0);
  expect(s.coinPlaque.shown).toBe(false);
  const gift = s.gifts[0]!;
  await page.evaluate(([x, z]) => window.__TEST__!.teleport(z, x), [gift.x, gift.z - 8] as const);
  await waitTicks(page, 10);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__TEST__!.state().coins > 0, undefined, { timeout: 30_000 });
  await page.keyboard.up('KeyW');
  s = await testState(page);
  expect(s.coins).toBe(5);
  expect(s.giftsTaken[0]).toBe(true);
  await waitTicks(page, 30);
  s = await testState(page);
  expect(s.coinPlaque).toEqual({ shown: true, text: '5' });
  await page.screenshot({ path: 'docs/evidence/M2/coins_1920x1080_ru.png' });
  const take = await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'giftTake'));
  expect(take).toHaveLength(1);
  expect(take[0]).toMatchObject({ index: 0, coins: 5, total: 5, rarity: 'common' });
  // Phase gone of the avalanche (the threat of M2-06 emits it): every gift is back, the coins stay.
  // The hero waits in the camp, away from the gift spot (in the game it is in a cave when the wave melts).
  await page.evaluate(() => window.__TEST__!.teleport(30));
  await waitTicks(page, 5);
  await page.evaluate(() => window.__TEST__!.waveGone());
  await waitTicks(page, 2);
  s = await testState(page);
  expect(s.giftsTaken.every((t) => !t)).toBe(true);
  expect(s.coins).toBe(5);
  expect(s.coinPlaque.shown).toBe(true);
});
