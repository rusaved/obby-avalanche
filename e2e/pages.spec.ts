import { test, expect, mockCalls } from './fixtures.ts';

// Producer link build (docs/05, section 2): relative sdk.js, milestone label, no console errors.
test('pages build shows the scene with the milestone label and relative sdk.js', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__YA_MOCK__?.calls.some((c) => c.name === 'LoadingAPI.ready'), undefined, { timeout: 60_000 });
  expect(await mockCalls(page, 'LoadingAPI.ready')).toBe(1);
  const label = page.locator('[data-role="build-label"]');
  await expect(label).toHaveText(/^(M\d|PR) · \d{4}-\d{2}-\d{2} · [0-9a-f]{7}$/);
  const sdkSrc = await page.evaluate(() => Array.from(document.querySelectorAll('script[src]')).map((s) => s.getAttribute('src')));
  expect(sdkSrc).toContain('sdk.js');
  expect(sdkSrc).not.toContain('/sdk.js');
  await expect(page.locator('#preloader')).toHaveClass(/hidden/);
});
