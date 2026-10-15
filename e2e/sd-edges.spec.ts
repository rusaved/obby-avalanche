import { test, expect, waitTicks } from './fixtures.ts';
import { STAGES } from './lv-stage-data.ts';

// SD-07 (docs/01-gdd.md 23.7): the edges of floors over a drop carry a coloured lip (white over white no more): frames of
// cracks and plates on mountains 1–3, draw calls in the budget (≤ 60).
for (const wi of [1, 2, 3]) {
  test(`mountain ${wi}: lips on the edges of the pits and plates; draw calls ≤ 60; screenshots`, async ({ page, openGame }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await openGame('pace=stages&quality=high');
    await waitTicks(page, 10);
    if (wi > 1) {
      await page.evaluate((i) => window.__TEST__!.gotoWorld(i), wi);
      await waitTicks(page, 20);
    }
    await page.evaluate(() => {
      window.__TEST__!.setStat(1e15);
      window.__TEST__!.holdWave(900);
    });
    for (const st of STAGES[wi - 1]!.stages.filter((s) => s.type === 'cracks' || s.type === 'plates').slice(0, 2)) {
      await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y + 0.5), [st.start - 4, st.y] as const);
      await waitTicks(page, 30);
      const calls = await page.evaluate(() => window.__TEST__!.renderInfo()?.calls ?? 0);
      expect(calls, `draw calls on ${st.type}`).toBeLessThanOrEqual(60);
      await page.screenshot({ path: `docs/evidence/sd/edges-m${wi}-${st.n}-${st.type}.png` });
    }
  });
}
