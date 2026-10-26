import { test, expect } from './fixtures.ts';

// G-06 (producer 26.10, Q-M6-3 A): no «Enter a code» in the pause for the first submission; the remote flag `promo`
// (game.json → flags) brings it back with an update or from the console, no new build.
async function pause(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.openMenu(true));
  await page.waitForTimeout(300);
  await expect(page.locator('[data-role="pause"]')).toBeVisible();
}

test('G-06: the pause has no «Enter a code»', async ({ page, openGame }) => {
  await openGame('pace=stages');
  await pause(page);
  await expect(page.locator('[data-hud="promo"]')).toHaveCount(0);
});

test('G-06: the flag promo=true brings «Enter a code» back', async ({ page, openGame }) => {
  await openGame(`pace=stages&mock_flags=${encodeURIComponent('{"promo":"true"}')}`);
  await pause(page);
  await expect(page.locator('[data-hud="promo"]')).toHaveCount(1);
});
