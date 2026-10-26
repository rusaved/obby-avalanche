import { test, expect } from './fixtures.ts';
import { STAGES, threshold } from './lv-stage-data.ts';

// Z-09 (producer 26.10, «Lavina 19 · Winter look»): the music by roles over the player of G-09 — the slope loop on a
// mountain, the fanfare once at its summit, the base loop at the base. Without the files (the staff brings them in a
// branch) the roles still switch and nothing errs in the console.
test('Z-09: the slope loop, the fanfare of the summit once, the base loop; no files — silence, no errors', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await openGame('pace=stages');
  await page.evaluate(() => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.setFlag('firstWaveDone', true);
    window.__TEST__!.setFlag('firstPortalDone', true);
    window.__TEST__!.setTutor(9);
    window.__TEST__!.holdWave(9000);
  });
  await page.mouse.click(10, 300);
  expect((await page.evaluate(() => window.__TEST__!.state().music))!.role).toBe('mountain');
  const W = STAGES[0]!;
  const last = W.stages[W.stages.length - 1]!;
  const portal = W.segments.find((s) => s.type === 'portal')!;
  await page.evaluate((s) => window.__TEST__!.setStat(s), threshold(40));
  await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y), [last.finish[0] + 2, last.y + 0.5] as const);
  await page.evaluate((z) => window.__TEST__!.botPath([[0, z + 2]]), portal.z);
  await expect(page.locator('[data-role="window"].open')).toBeVisible({ timeout: 40_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  expect((await page.evaluate(() => window.__TEST__!.state().music))!.fanfares).toBe(1);
  await page.locator('[data-hud="win-next"]').click();
  await page.waitForFunction(() => window.__TEST__!.state().onBase === true, undefined, { timeout: 30_000 });
  const m = (await page.evaluate(() => window.__TEST__!.state().music))!;
  expect(m.role).toBe('base');
  expect(m.fanfares).toBe(1);
});
