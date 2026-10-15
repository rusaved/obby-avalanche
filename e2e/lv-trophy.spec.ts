import { test, expect, testState, waitTicks } from './fixtures.ts';
import { STAGES } from './lv-stage-data.ts';

// LV-07 (docs/01-gdd.md 22.8): the safe finish of a stage has the trophy button at its side — «+N» over it, standing on
// it gives N trophies once a pass; the wallet plaque is a cup.
const st = STAGES[0]!.stages[1]!;
test(`stage ${st.n}: the trophy button gives +${st.trophies} once a pass; the wallet is a cup`, async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openGame('pace=stages');
  await waitTicks(page, 10);
  await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y + 0.5), [st.finish[0] + 2, st.y] as const);
  await waitTicks(page, 20);
  const label = page.locator('[data-role=pad-label]');
  await expect(label).toBeVisible();
  await expect(label).toContainText(`+${st.trophies}`);
  expect(await page.locator('[data-role=coins] svg').count(), 'the wallet plaque shows a cup').toBeGreaterThan(0);
  const before = (await testState(page)).coins;
  await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z]]), [st.pad.x, st.pad.z] as const);
  await page.waitForFunction(() => window.__TEST__!.state().padsTaken >= 1, undefined, { timeout: 20_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await waitTicks(page, 5);
  expect((await testState(page)).coins - before).toBe(st.trophies);
  await page.screenshot({ path: 'docs/evidence/lv/trophy-pad.png' });
  // Off it and back on: no second pay on the same pass.
  await page.evaluate(([x, z]) => window.__TEST__!.botPath([[0, z - 6], [x, z]]), [st.pad.x, st.pad.z] as const);
  await page.waitForFunction(() => window.__TEST__!.botLeft() === 0, undefined, { timeout: 20_000 });
  await waitTicks(page, 10);
  expect((await testState(page)).coins - before).toBe(st.trophies);
});
