import { test, expect, testState, waitTicks } from './fixtures.ts';

// M2-02: the sign counts «15/20», turns green and the wall melts when the stat reaches the number (docs/01-gdd.md 3.3).
test('gate 1 sign counts up to 20, turns green, the hero passes; screenshot gate_1920x1080_ru.png', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame();
  const before = await page.evaluate(() => window.__TEST__!.gateSign(0));
  expect(before.open).toBe(false);
  // 100 units to the wall at z = 130: the number reaches 20 on the approach (80 units), not at the wall, where a closed gate stops the path.
  await page.evaluate(() => window.__TEST__!.teleport(30));
  await page.evaluate(() => window.__TEST__!.setAutoRun(true));
  await waitTicks(page, 90);
  const mid = await page.evaluate(() => window.__TEST__!.gateSign(0));
  expect(mid.open).toBe(false);
  expect(mid.text).toMatch(/^\d+\/20$/);
  expect(Number(mid.text.split('/')[0])).toBeGreaterThan(0);
  await page.waitForFunction(() => window.__TEST__!.state().gatesOpen[0] === true, undefined, { timeout: 60_000 });
  const s = await testState(page);
  expect(s.stat).toBeGreaterThanOrEqual(20);
  await waitTicks(page, 30);
  const after = await page.evaluate(() => window.__TEST__!.gateSign(0));
  expect(after).toEqual({ text: '20', open: true });
  await page.screenshot({ path: 'docs/evidence/M2/gate_1920x1080_ru.png' });
  await page.waitForFunction(() => (window.__TEST__!.state().hero?.z ?? 0) > 131, undefined, { timeout: 60_000 });
  const names = (await page.evaluate(() => window.__TEST__!.analytics())).map((e) => e.name);
  expect(names.filter((n) => n === 'gate_1')).toHaveLength(1);
});
