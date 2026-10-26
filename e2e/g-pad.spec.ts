import { test, expect } from './fixtures.ts';
import { STAGES, threshold } from './lv-stage-data.ts';

// G-02 (producer 26.10, Q-ST-2 «B with standing»): the stage pad flies to the camp only if the hero stands on it ~0.5 s —
// a run over it keeps him on the slope; while he stands, «+N · to camp» with a ring; a spent pad never flies.
const W = STAGES[0]!;
const ST = W.stages[1]!;

for (const viewport of [{ width: 880, height: 405 }, { width: 815, height: 290 }]) {
  test.describe(`G-02 · ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });

    test.beforeEach(async ({ page, openGame }) => {
      await openGame('pace=stages&mock_device=mobile');
      await page.evaluate((stat) => {
        window.__TEST__!.setPlaySec(400);
        window.__TEST__!.setFlag('firstWaveDone', true);
        window.__TEST__!.setFlag('giantFree', true);
        window.__TEST__!.holdWave(9000);
        window.__TEST__!.setStat(stat);
      }, threshold(ST.level + 3));
    });

    test('a run over the pad does not fly to the camp', async ({ page }) => {
      await page.evaluate((p) => window.__TEST__!.teleport(p.z - 8, p.x), ST.pad);
      await page.evaluate(() => window.__TEST__!.stick(0, 1));
      await page.evaluate(() => window.__TEST__!.runSim(2));
      await page.evaluate(() => window.__TEST__!.stick(0, 0));
      const s = await page.evaluate(() => window.__TEST__!.state());
      expect(s.hero!.z, 'still past the pad, on the slope').toBeGreaterThan(ST.pad.z);
    });

    test('standing on it shows «+N · to camp» with the ring and flies after ~0.5 s', async ({ page }) => {
      await page.evaluate((p) => window.__TEST__!.teleport(p.z, p.x), ST.pad);
      await page.evaluate(() => window.__TEST__!.runSim(0.25));
      const label = page.locator('[data-role="pad-label"]');
      await expect(label).toContainText(/в лагерь|to camp/);
      await expect(label.locator('.hud-pad-ring')).toBeVisible();
      await page.screenshot({ path: `docs/evidence/G/${viewport.width}x${viewport.height}/pad-stand.png` });
      await page.evaluate(() => window.__TEST__!.runSim(0.6));
      const z = await page.evaluate(() => window.__TEST__!.state().hero!.z);
      expect(z, 'in the camp').toBeLessThan(W.stages[0]!.z0 + 1);
    });
  });
}
