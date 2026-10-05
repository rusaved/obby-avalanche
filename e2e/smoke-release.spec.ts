import { test, expect, mockCalls } from './fixtures.ts';

// Release archive smoke (docs/02-tech.md 16.3): the unpacked release/*.zip served statically, mock on /sdk.js.
// There is no __TEST__ in a release build, so readiness is read from the mock and the DOM.
test('release build: ready() exactly once, first frame drawn, zero console errors', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__YA_MOCK__?.calls.some((c) => c.name === 'LoadingAPI.ready'), undefined, { timeout: 60_000 });
  await page.waitForTimeout(1000);
  expect(await mockCalls(page, 'LoadingAPI.ready')).toBe(1);
  expect(await mockCalls(page, 'GameplayAPI.start')).toBe(1);
  await expect(page.locator('#preloader')).toHaveClass(/hidden/);
  const drawn = await page.evaluate(() => {
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    return canvas.width > 0 && canvas.height > 0;
  });
  expect(drawn).toBe(true);
  expect(await page.locator('[data-role="build-label"]').count()).toBe(0);
  const hasTest = await page.evaluate(() => typeof (window as unknown as { __TEST__?: unknown }).__TEST__);
  expect(hasTest).toBe('undefined');
});

// PR-01 (docs/01-gdd.md 16.1): the release never reads ?pace= — it plays game.json `pace` (fast), so the save goes to
// the fast slot of the mirror and the classic key stays empty.
test('release build ignores ?pace=classic: the save lands in the slot of the game.json pace', async ({ page }) => {
  await page.goto('/?pace=classic');
  await page.waitForFunction(() => window.__YA_MOCK__?.calls.some((c) => c.name === 'LoadingAPI.ready'), undefined, { timeout: 60_000 });
  await page.waitForFunction(() => Object.keys(localStorage).some((k) => /:save(\.|$)/.test(k)), undefined, { timeout: 30_000 });
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => /:save(\.|$)/.test(k)));
  expect(keys.some((k) => k.endsWith(':save.fast'))).toBe(true);
  expect(keys.some((k) => k.endsWith(':save'))).toBe(false);
});
