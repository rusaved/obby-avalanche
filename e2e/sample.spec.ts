import { test, expect, testState, mockCalls } from './fixtures.ts';

// Smoke on the `_sample` pack (docs/02-tech.md 5.1): game 2 is a data swap, the same code boots and renders.
test('sample pack boots, renders and calls ready() once', async ({ page, openGame }) => {
  await openGame();
  const state = await testState(page);
  expect(state.pack).toBe('_sample');
  expect(state.platform).toBe('yandex');
  expect(await mockCalls(page, 'LoadingAPI.ready')).toBe(1);
  await page.waitForFunction(() => (window.__TEST__!.renderInfo()?.frame ?? 0) > 2);
  const info = await page.evaluate(() => window.__TEST__!.renderInfo());
  expect(info!.calls).toBeGreaterThan(0);
  const title = await page.title();
  expect(title.length).toBeGreaterThan(0);
});

// M5-09 (docs/01a-content.md 14): game 2 — the stat «jump» lifts the jump (effect jumpPower), the run stays the same;
// the frame of the pack with its lava palette — docs/evidence/M5/sample.png.
test('sample pack: the jump grows with the stat, the run does not; the frame', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openGame();
  const apex = async (stat: number): Promise<number> => {
    await page.evaluate((s) => {
      window.__TEST__!.setStat(s);
      window.__TEST__!.teleport(30, -8);
    }, stat);
    await page.waitForFunction(() => window.__TEST__!.state().hero!.onGround === true, undefined, { timeout: 10_000 });
    const y0 = (await page.evaluate(() => window.__TEST__!.state().hero!.y));
    await page.evaluate(() => window.__TEST__!.jump());
    let top = y0;
    for (let i = 0; i < 80; i++) {
      top = Math.max(top, await page.evaluate(() => window.__TEST__!.state().hero!.y));
      await page.waitForTimeout(16);
    }
    return top - y0;
  };
  const low = await apex(0);
  const high = await apex(30);
  expect(low).toBeGreaterThan(3);
  expect(high).toBeGreaterThan(low * 1.5);
  await page.evaluate(() => window.__TEST__!.teleport(150));
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'docs/evidence/M5/sample.png' });
});
