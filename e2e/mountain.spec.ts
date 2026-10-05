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
  // The portal opens «Mountain 1 cleared!» (M3-09); «Next» goes on to mountain 2.
  await page.waitForFunction(() => window.__TEST__!.state().window === 'summit', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setAutoRun(false));
  await page.locator('[data-hud="win-next"]').click();
  await page.waitForFunction(() => window.__TEST__!.state().world === 'pass', undefined, { timeout: 60_000 });
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

// M3-05: mountains 2–5 by data (GDD-14): every mountain loads as through a portal, the hero stands in its camp,
// walks its slope by teleport (a wall, a cave, the summit) without a console error; grey look for now.
test('teleport to every mountain 1–5: camp, middle and summit load without errors; screenshots mountain_N_960x540_ru.png', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 960, height: 540 });
  await openGame();
  const ids = ['slope', 'pass', 'canyon', 'blizzard', 'aurora'];
  const lengths = [1180, 1300, 1420, 1540, 1660];
  for (let n = 1; n <= 5; n++) {
    await page.evaluate((i) => window.__TEST__!.gotoWorld(i), n);
    await waitTicks(page, 30);
    let s = await testState(page);
    expect(s.world).toBe(ids[n - 1]);
    expect(s.hero!.z).toBeLessThan(40);
    expect(s.hero!.onGround).toBe(true);
    expect(s.gatesOpen).toHaveLength(12);
    // The middle of the slope: just behind wall 6 by its flag, then the summit; the hero lands on the floor each time.
    const len = lengths[n - 1]!;
    for (const z of [40 + 5.5 * ((len - 100) / 12), len - 50]) {
      await page.evaluate((zz) => window.__TEST__!.teleport(zz), z);
      await waitTicks(page, 30);
      s = await testState(page);
      expect(s.respawning, `mountain ${n} at z ${z}`).toBe(false);
      expect(Math.abs(s.hero!.z - z), `mountain ${n} at z ${z}`).toBeLessThan(3);
    }
    await page.evaluate(() => window.__TEST__!.teleport(26));
    await waitTicks(page, 20);
    await page.screenshot({ path: `docs/evidence/M3/mountain_${n}_960x540_ru.png` });
  }
});
