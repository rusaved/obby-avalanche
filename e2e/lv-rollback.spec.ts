import { test, expect, testState, waitTicks } from './fixtures.ts';
import { STAGES, flagOf, ready, threshold } from './lv-stage-data.ts';

// LV-08 (docs/01-gdd.md 22.9): a fall rolls the hero to the flag of the stage before within 2 s, nothing lost; «Continue
// from stage N» for 60 s — the first of a mountain free, the next one by the rewarded ad.
const st = STAGES[0]!.stages[3]!;
const prev = STAGES[0]!.stages[2]!;
test(`a fall on stage ${st.n} (${st.type}) → the flag of stage ${prev.n}; continue free once, then by the ad`, async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openGame('pace=stages&mock_ad=ok');
  await waitTicks(page, 10);
  await ready(page);
  const fall = async (): Promise<void> => {
    await page.evaluate(([s, z, y]) => {
      window.__TEST__!.setStat(s);
      window.__TEST__!.teleport(z, 0, y + 0.5);
    }, [threshold(st.level) * 1.01, st.start - 4, st.y] as const);
    await waitTicks(page, 10);
    const t0 = (await testState(page)).timeSec;
    await page.evaluate((z) => window.__TEST__!.botPath([[30, z]]), st.start + 6);
    await page.waitForFunction(() => window.__TEST__!.state().caught !== null, undefined, { timeout: 20_000 });
    await page.evaluate(() => window.__TEST__!.botPath(null));
    await page.waitForFunction(() => !window.__TEST__!.state().caught, undefined, { timeout: 20_000 });
    const s = await testState(page);
    expect(s.timeSec - t0, 'the roll ≤ 2 s past the fall').toBeLessThanOrEqual(4);
    expect(Math.abs(s.hero!.z - flagOf(1, prev).z), `at the flag of the stage before: hero ${s.hero!.z} ${s.hero!.y}`).toBeLessThanOrEqual(4);
    expect(s.rollFrom).toBe(st.n);
  };
  await fall();
  const free = page.locator('button.hud-ad[data-ad=continue_free]');
  await expect(free).toBeVisible();
  await expect(free).toContainText(String(st.n));
  await expect(free).not.toContainText(/Реклама|Ad/);
  await page.screenshot({ path: 'docs/evidence/lv/continue-free.png' });
  await free.click();
  await waitTicks(page, 10);
  expect(Math.abs((await testState(page)).hero!.z - flagOf(1, st).z)).toBeLessThanOrEqual(4);
  await fall();
  const paid = page.locator('button.hud-ad[data-ad=continue_here]');
  await expect(paid).toBeVisible();
  await expect(paid).toContainText(/Реклама|Ad/);
  await paid.click();
  await page.waitForFunction((z) => Math.abs(window.__TEST__!.state().hero!.z - z) <= 4, flagOf(1, st).z, { timeout: 20_000 });
});
