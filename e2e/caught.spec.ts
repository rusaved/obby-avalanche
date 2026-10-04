import { test, expect, testState, waitTicks } from './fixtures.ts';

// M2-07, GDD-04: «Snowed in!» — the ball rolls into the nearest cave below, the clip lasts ≤ 2 s, nothing is lost.
test('snowed in on the slope: toast, the ball rolls into the cave below within 2 s, nothing lost; screenshot caught_1920x1080_ru.png', async ({ page, openGame }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame();
  // The scripted first wave never catches (docs/01-gdd.md 4.6): let it pass while the hero waits in the camp.
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.evaluate(() => window.__TEST__!.setTimeScale(3));
  await page.waitForFunction(() => window.__TEST__!.simEvents.some((e) => e.name === 'waveEnd'), undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));

  // A normal wave over the hero on the slope just below wall 1 (z 125; all walls closed, cave 1 below at z 103).
  await page.evaluate(() => window.__TEST__!.teleport(125, 0));
  await waitTicks(page, 10);
  const before = await testState(page);
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.evaluate(() => window.__TEST__!.setTimeScale(2));
  await page.waitForFunction(() => window.__TEST__!.state().caught !== null, undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  let s = await testState(page);
  expect(s.waveHud.toast).toBe('Накрыло снегом!');
  expect(s.caught!.total).toBeLessThanOrEqual(2.0);
  await page.waitForFunction(() => (window.__TEST__!.state().caught?.t ?? 9) > 0.7, undefined, { timeout: 30_000 });
  await page.screenshot({ path: 'docs/evidence/M2/caught_1920x1080_ru.png' });
  await page.waitForFunction(() => window.__TEST__!.state().caught === null, undefined, { timeout: 30_000 });
  const ev = await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'waveCaught' || e.name === 'caughtEnd'));
  expect(ev.map((e) => e.name)).toEqual(['waveCaught', 'caughtEnd']);
  expect((ev[1]!.tick - ev[0]!.tick + 1) / 60).toBeLessThanOrEqual(2.0);
  s = await testState(page);
  expect(s.hero!.z).toBeLessThan(125);
  expect(s.shelter).toBe(0); // cave 1, the nearest one below
  expect(s.stat).toBe(before.stat);
  expect(s.coins).toBe(before.coins);
  expect(s.gatesOpen).toEqual(before.gatesOpen);
  // Controls are back: the hero walks out of the cave.
  await page.keyboard.down('KeyD');
  await waitTicks(page, 30);
  await page.keyboard.up('KeyD');
  expect(Math.abs((await testState(page)).hero!.x - s.hero!.x)).toBeGreaterThan(0.5);
  // The same wave does not catch twice; the funnel sends wave_real_1 with caught: true.
  await page.evaluate(() => window.__TEST__!.setTimeScale(3));
  await page.waitForFunction(() => window.__TEST__!.simEvents.filter((e) => e.name === 'waveEnd').length >= 2, undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  const caughtCount = await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'waveCaught').length);
  expect(caughtCount).toBe(1);
  const real = (await page.evaluate(() => window.__TEST__!.analytics())).filter((e) => e.name === 'wave_real_1');
  expect(real.map((e) => e.params)).toEqual([{ caught: true }]);
});
