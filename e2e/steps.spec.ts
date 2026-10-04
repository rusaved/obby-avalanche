import { test, expect, testState, waitTicks } from './fixtures.ts';

// M2-01: running shows «+N» above the hero on the first step and sends gameTutorialStart once (docs/06, step 4).
test('«+N» pops above the hero on the first step; gameTutorialStart exactly once', async ({ page, openGame }) => {
  await openGame();
  expect((await testState(page)).steps).toBe(0);
  await page.keyboard.down('KeyW');
  await waitTicks(page, 50);
  const pop = page.locator('.hud-gain.show').first();
  await expect(pop).toHaveText(/^\+\d/);
  await page.keyboard.up('KeyW');
  const s = await testState(page);
  expect(s.steps).toBeGreaterThanOrEqual(2);
  expect(s.stat).toBeGreaterThanOrEqual(2);
  const names = (await page.evaluate(() => window.__TEST__!.analytics())).map((e) => e.name);
  expect(names.filter((n) => n === 'gameTutorialStart')).toHaveLength(1);
});
