import { test, expect, testState, waitTicks } from './fixtures.ts';
import { STAGES } from './lv-stage-data.ts';

// LV-03…LV-05 (docs/01-gdd.md 22.4–22.6): mountains 1 and 2 are chains of stages — on each the HUD names it
// («stage 3/10»), the trial is in the frame; draw calls stay in the budget on the maze and the avalanche; frames of a
// field and a bridge for the producer.
for (const wi of [1, 2]) {
  test(`mountain ${wi}: every stage named on the HUD, draw calls ≤ 60, frames of a field and a bridge`, async ({ page, openGame }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await openGame('pace=stages&quality=high');
    await waitTicks(page, 10);
    if (wi > 1) {
      await page.evaluate((i) => window.__TEST__!.gotoWorld(i), wi);
      await waitTicks(page, 20);
    }
    await page.evaluate(() => window.__TEST__!.setStat(1e15));
    const stages = STAGES[wi - 1]!.stages;
    for (const st of stages) {
      await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y + 0.5), [st.start - 4, st.y] as const);
      await waitTicks(page, 20);
      const s = await testState(page);
      expect(s.stage, `stage ${st.n} under the hero`).toBe(st.n);
      await expect(page.locator('[data-role=mountain]')).toContainText(`${st.n}/${stages.length}`);
      if (st.type === 'maze' || st.type === 'avalanche') {
        const calls = await page.evaluate(() => window.__TEST__!.renderInfo()?.calls ?? 0);
        expect(calls, `draw calls on ${st.type}`).toBeLessThanOrEqual(60);
      }
      if (wi === 1 && (st.type === 'giant' || st.type === 'plates' || st.type === 'throat' || st.type === 'catapult' || st.type === 'maze' || st.type === 'chute'))
        await page.screenshot({ path: `docs/evidence/lv/stage-${st.n}-${st.type}.png` });
    }
  });
}
