import { test, expect } from './fixtures.ts';

// M4-03 (docs/03 ADS-04, ?mock_device=mobile): standing 1.5 s with an ad button up, a touch in the middle of the left
// half moves the hero and never calls an ad.

test('ADS-04 phone: a touch in the middle of the left half runs the hero, no showRewardedVideo', async ({ page, openGame }) => {
  test.setTimeout(90_000);
  await openGame('pace=open&mock_device=mobile');
  await page.evaluate(() => {
    window.__TEST__!.setPlaySec(61);
    window.__TEST__!.setFlag('firstWaveDone', true);
    window.__TEST__!.holdWave(9000);
  });
  const { width, height } = page.viewportSize()!;
  await page.touchscreen.tap(width * 0.75, height * 0.3);
  const belt = (await page.evaluate(() => window.__TEST__!.shelters())).find((g) => g.belt !== null)!.belt!;
  await page.evaluate(([x, z]) => window.__TEST__!.teleport(z, x), belt);
  await page.waitForTimeout(1_500);
  const before = await page.evaluate(() => window.__TEST__!.state().hero!);
  const cdp = await page.context().newCDPSession(page);
  const x = width / 4;
  const y = height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 8, id: 1 }] });
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(600);
  const mid = await page.evaluate(() => window.__TEST__!.state().hero!);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(Math.hypot(mid.x - before.x, mid.z - before.z), 'the hero ran').toBeGreaterThan(0.5);
  expect(await page.evaluate(() => window.__YA_MOCK__!.calls.filter((c) => c.name === 'adv.showRewardedVideo').length)).toBe(0);
});
