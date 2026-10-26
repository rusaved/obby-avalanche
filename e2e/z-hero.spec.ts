import { mkdirSync } from 'node:fs';
import { test, expect, waitTicks } from './fixtures.ts';

// Z-02, Z-03 (producer 26.10, «Lavina 19 · Winter look»): the blocky hero of the genre's canon — a rounded-cylinder head,
// clothes drawn on the body, hair of rounded boxes, the smile by default, the pompom hat upright; the characters stay
// instanced (8 draw calls before, +2 at most). Frames of the lineup and of the hero at 880×405 and 815×290.
for (const vp of [{ width: 880, height: 405 }, { width: 815, height: 290 }]) {
  test.describe(`${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp, hasTouch: true, isMobile: true });
    test(`Z-03: the new hero and the skins lineup, draw calls of the characters ≤ 10 (${vp.width}×${vp.height})`, async ({ page, openGame }) => {
      const dir = `docs/evidence/Z/${vp.width}x${vp.height}`;
      mkdirSync(dir, { recursive: true });
      await openGame('pace=stages&mock_device=mobile');
      await page.evaluate(() => {
        window.__TEST__!.setPlaySec(400);
        window.__TEST__!.setFlag('firstWaveDone', true);
        window.__TEST__!.setTutor(9);
        window.__TEST__!.holdWave(9000);
      });
      await waitTicks(page, 10);
      expect(await page.evaluate(() => window.__TEST__!.state().skin)).toBe('tangerine');
      expect(await page.evaluate(() => window.__TEST__!.charactersDrawCalls())).toBeLessThanOrEqual(10);
      await page.evaluate(() => window.__TEST__!.setCamera({ yaw: Math.PI, pitch: 0.15, dist: 7 }));
      await waitTicks(page, 20);
      await page.screenshot({ path: `${dir}/hero-front.png` });
      await page.evaluate(() => window.__TEST__!.setCamera('auto'));
      await page.evaluate(() => window.__TEST__!.stick(0, 1));
      await page.evaluate(() => window.__TEST__!.runSim(1.2));
      await page.screenshot({ path: `${dir}/hero-run.png` });
      await page.evaluate(() => window.__TEST__!.stick(0, 0));
      await page.evaluate(() => window.__TEST__!.showLineup(['tangerine', 'skier', 'snowboarder', 'aurora_skin', 'golden', 'snow_ninja', 'stargazer', 'explorer'], []));
      await waitTicks(page, 20);
      await page.screenshot({ path: `${dir}/hero-lineup.png` });
      expect(await page.evaluate(() => window.__TEST__!.charactersDrawCalls())).toBeLessThanOrEqual(10);
    });
  });
}
