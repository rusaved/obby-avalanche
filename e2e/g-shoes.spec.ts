import { test, expect, waitTicks } from './fixtures.ts';
import { STAGES } from './lv-stage-data.ts';

// G-03 (producer 26.10: «I did not get when to buy sneakers. The hint was gone fast»): with coins for a pair the tutorial's
// «Buy sneakers» stays up on the run, with an arrow over the sneakers button, until a pair is bought or the shop opened.
const W = STAGES[0]!;
const SHOES_STEP = 4;

for (const viewport of [{ width: 880, height: 405 }, { width: 815, height: 290 }]) {
  test.describe(`G-03 · ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });

    test('«Buy sneakers» holds on the run with the arrow; the shop opened — gone', async ({ page, openGame }) => {
      await openGame('pace=stages&mock_device=mobile');
      await page.evaluate((z) => {
        window.__TEST__!.setPlaySec(400);
        window.__TEST__!.setFlag('firstWaveDone', true);
        window.__TEST__!.setFlag('giantFree', true);
        window.__TEST__!.holdWave(9000);
        window.__TEST__!.setTutor(4);
        window.__TEST__!.setCoins(0);
        window.__TEST__!.teleport(z, 0);
      }, W.stages[1]!.z0 - 30);
      await waitTicks(page, 10);
      const tutor = page.locator('[data-role="tutor"]');
      const shoes = page.locator('[data-hud="shoes"]');
      await expect(shoes).not.toHaveClass(/point/);
      await page.evaluate(() => window.__TEST__!.setCoins(5000));
      await waitTicks(page, 10);
      await expect(tutor).toContainText(/Купи кроссовки|Buy sneakers/i);
      await expect(shoes).toHaveClass(/point/);
      // On the run for 10 s: still up.
      await page.evaluate(() => window.__TEST__!.stick(0, 1));
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.__TEST__!.runSim(2));
        await expect(tutor).toContainText(/Купи кроссовки|Buy sneakers/i);
        await expect(shoes).toHaveClass(/point/);
      }
      await page.evaluate(() => window.__TEST__!.stick(0, 0));
      expect(await page.evaluate(() => window.__TEST__!.state().tutor)).toBe(SHOES_STEP);
      await page.screenshot({ path: `docs/evidence/G/${viewport.width}x${viewport.height}/shoes-hint.png` });
      await page.locator('[data-hud="menu-shop"]').dispatchEvent('pointerdown');
      await expect(page.locator('[data-role="window"].open')).toHaveCount(1);
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => window.__TEST__!.state().tutor)).toBe(SHOES_STEP + 1);
      await page.locator('[data-hud="win-close"]').click();
      await waitTicks(page, 5);
      await expect(shoes).not.toHaveClass(/point/);
    });
  });
}
