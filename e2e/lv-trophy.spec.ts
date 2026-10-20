import { test, expect, testState, waitTicks } from './fixtures.ts';
import { STAGES } from './lv-stage-data.ts';

// LV-07 (docs/01-gdd.md 22.8), SD-03, SD-11 (23.3, Q-088): the safe finish of a stage has the reward button at its side —
// «+N» over it; standing on it gives N coins (trophies are only those of summits), then the hero flies to the camp: once a run.
const st = STAGES[0]!.stages[1]!;
test(`stage ${st.n}: the reward button gives +${st.trophies} coins once a run, then the camp`, async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openGame('pace=stages');
  await waitTicks(page, 10);
  // MU round 3: the pad stands by the edge of the field, off the runs to the passes — seen from its side of the finish.
  await page.evaluate(([z, x, y]) => window.__TEST__!.teleport(z, x, y + 0.5), [st.finish[0] + 2, st.pad.x * 0.85, st.y] as const);
  await waitTicks(page, 20);
  const label = page.locator('[data-role=pad-label]');
  await expect(label).toBeVisible();
  await expect(label).toContainText(String(st.trophies));
  const before = await testState(page);
  await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z]]), [st.pad.x, st.pad.z] as const);
  await page.waitForFunction(() => window.__TEST__!.state().padsTaken >= 1, undefined, { timeout: 20_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await waitTicks(page, 5);
  let s = await testState(page);
  expect(s.coins - before.coins).toBe(st.trophies);
  expect(s.trophies.now).toBe(before.trophies.now);
  await page.screenshot({ path: 'docs/evidence/sd/trophy-pad.png' });
  // Then the camp: a new run.
  await page.waitForFunction((z0) => window.__TEST__!.state().hero!.z < z0, STAGES[0]!.stages[1]!.z0, { timeout: 10_000 });
  s = await testState(page);
  expect(s.coins - before.coins).toBe(st.trophies);
});
