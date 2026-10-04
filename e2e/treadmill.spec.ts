import { test, expect, testState, waitTicks } from './fixtures.ts';

// M2-05: a cave with a treadmill ×N — the hero runs in place by himself, the first belt step sends treadmill_first (docs/06, step 10).
test('belt of cave 1: steps without input × treadmill, the hero is in shelter, treadmill_first once', async ({ page, openGame }) => {
  await openGame();
  // Cave 1 of mountain 1: left side at z = 103, floor y = 6, belt centre x = −19 (3 × 5 at the back wall).
  await page.evaluate(() => window.__TEST__!.teleport(103, -19, 6.05));
  await waitTicks(page, 10);
  let s = await testState(page);
  expect(s.onBelt).toBe(true);
  expect(s.inShelter).toBe(true);
  expect(s.shelter).toBe(0);
  const steps0 = s.steps;
  const z0 = s.hero!.z;
  await waitTicks(page, 120);
  s = await testState(page);
  expect(s.steps - steps0).toBeGreaterThanOrEqual(6);
  expect(Math.abs(s.hero!.z - z0)).toBeLessThan(0.2);
  const gains = await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'gain').slice(-3));
  for (const g of gains) expect(g).toMatchObject({ amount: 5, belt: true });
  // Step off and back on: the funnel event stays single (kind player).
  await page.evaluate(() => window.__TEST__!.teleport(103, -10, 6.05));
  await waitTicks(page, 30);
  await page.evaluate(() => window.__TEST__!.teleport(103, -19, 6.05));
  await waitTicks(page, 60);
  const names = (await page.evaluate(() => window.__TEST__!.analytics())).map((e) => e.name);
  expect(names.filter((n) => n === 'treadmill_first')).toHaveLength(1);
});
