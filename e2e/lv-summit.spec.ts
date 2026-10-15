import { test, expect, waitTicks } from './fixtures.ts';
import { STAGES, threshold } from './lv-stage-data.ts';

// LV-03 (docs/01-gdd.md 22.4): past the last stage the summit of mountain 1 as before — the portal takes the hero on
// (the summit window, the next mountain).
const W = STAGES[0]!;
const last = W.stages[W.stages.length - 1]!;
test('mountain 1: from the finish of the last stage up to the portal of the summit', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openGame('pace=stages');
  await waitTicks(page, 10);
  const portal = W.segments.find((s) => s.type === 'portal')!;
  await page.evaluate(([s, z, y]) => {
    window.__TEST__!.setStat(s);
    window.__TEST__!.teleport(z, 0, y + 0.5);
  }, [threshold(last.level) * 2, last.finish[0] + 2, last.y] as const);
  await waitTicks(page, 10);
  await page.evaluate((z) => window.__TEST__!.botPath([[0, z + 2]]), portal.z);
  await expect(page.locator('[data-role=window]')).toBeVisible({ timeout: 40_000 });
  await page.screenshot({ path: 'docs/evidence/lv/summit.png' });
});
