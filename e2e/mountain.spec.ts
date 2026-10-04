import { test, expect, testState, waitTicks } from './fixtures.ts';

// M2-03: mountain 1 in full, the summit portal leads to mountain 2 (docs/01-gdd.md 5.2).
test('summit of mountain 1: walking into the portal moves the hero to the camp of mountain 2; screenshot summit_1920x1080_ru.png', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame();
  let s = await testState(page);
  expect(s.world).toBe('slope');
  // Summit of mountain 1 starts after wall 12 (z = 1120); the portal arch stands at z = 1170.
  await page.evaluate(() => window.__TEST__!.teleport(1135));
  await waitTicks(page, 20);
  await page.screenshot({ path: 'docs/evidence/M2/summit_1920x1080_ru.png' });
  await page.evaluate(() => window.__TEST__!.setAutoRun(true));
  await page.waitForFunction(() => window.__TEST__!.state().world === 'pass', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setAutoRun(false));
  s = await testState(page);
  expect(s.hero!.z).toBeLessThan(60);
  expect(s.gatesOpen).toHaveLength(12);
  expect(s.gatesOpen.every((o) => !o)).toBe(true);
  const portal = await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'portal'));
  expect(portal).toHaveLength(1);
  expect(portal[0]).toMatchObject({ from: 1, next: 2 });
  const names = (await page.evaluate(() => window.__TEST__!.analytics())).map((e) => e.name);
  expect(names.filter((n) => n === 'gameTutorialComplete')).toHaveLength(1);
  // The new mountain is playable: the hero stands on its floor and does not fall.
  await waitTicks(page, 60);
  s = await testState(page);
  expect(s.hero!.onGround).toBe(true);
  expect(s.respawning).toBe(false);
});
