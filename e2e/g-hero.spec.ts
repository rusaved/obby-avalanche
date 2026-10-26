import { test, expect, waitTicks } from './fixtures.ts';

// G-08 (producer 26.10: «the hero and his actions brighter and more colourful»): the outline of the hero is drawn (one
// draw call more for him alone), the jump bursts in sparks; frames of the run and the jump at 880×405.
test.use({ viewport: { width: 880, height: 405 }, hasTouch: true, isMobile: true });

test('G-08: the hero outlined, a jump bursts; frames', async ({ page, openGame }) => {
  await openGame('pace=stages&mock_device=mobile');
  await page.evaluate(() => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.setFlag('firstWaveDone', true);
    window.__TEST__!.holdWave(9000);
  });
  await waitTicks(page, 10);
  const draws = await page.evaluate(() => window.__TEST__!.drawList());
  expect(draws.some(([n]) => n === 'char-outline'), 'the outline is drawn').toBe(true);
  await page.evaluate(() => window.__TEST__!.stick(0, 1));
  await page.evaluate(() => window.__TEST__!.runSim(1.5));
  await page.screenshot({ path: 'docs/evidence/G/880x405/hero-run.png' });
  await page.evaluate(() => window.__TEST__!.jump());
  await page.evaluate(() => window.__TEST__!.runSim(0.15));
  await page.screenshot({ path: 'docs/evidence/G/880x405/hero-jump.png' });
  await page.evaluate(() => window.__TEST__!.stick(0, 0));
});
