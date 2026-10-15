import { test, expect, testState, waitTicks } from './fixtures.ts';
import { STAGES } from './lv-stage-data.ts';

// LV-07 (docs/01-gdd.md 22.8), SD-03 (23.3): the safe finish of a stage has the trophy button at its side — «+N» over it;
// standing on it gives N trophies (their own wallet, not coins), then the hero flies to the camp: once a run.
const st = STAGES[0]!.stages[1]!;
test(`stage ${st.n}: the trophy button gives +${st.trophies} trophies once a run, then the camp`, async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openGame('pace=stages');
  await waitTicks(page, 10);
  await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y + 0.5), [st.finish[0] + 2, st.y] as const);
  await waitTicks(page, 20);
  const label = page.locator('[data-role=pad-label]');
  await expect(label).toBeVisible();
  await expect(label).toContainText(`+${st.trophies}`);
  const before = await testState(page);
  await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z]]), [st.pad.x, st.pad.z] as const);
  await page.waitForFunction(() => window.__TEST__!.state().padsTaken >= 1, undefined, { timeout: 20_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await waitTicks(page, 5);
  let s = await testState(page);
  expect(s.trophies.now - before.trophies.now).toBe(st.trophies);
  expect(s.coins).toBe(before.coins);
  await expect(page.locator('[data-role=trophies]')).toHaveClass(/shown/);
  await page.screenshot({ path: 'docs/evidence/sd/trophy-pad.png' });
  // Then the camp: a new run.
  await page.waitForFunction((z0) => window.__TEST__!.state().hero!.z < z0, STAGES[0]!.stages[1]!.z0, { timeout: 10_000 });
  s = await testState(page);
  expect(s.trophies.now - before.trophies.now).toBe(st.trophies);
});
