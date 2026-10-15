import { test, expect, waitTicks } from './fixtures.ts';
import { STAGES, threshold } from './lv-stage-data.ts';

// LV-02 (docs/01-gdd.md 22.3): the ridge of a stage shows the level it asks for; by a closed ridge the pill «yours 6 /
// need 7» is red and small, with the level it turns green and the ice melts.
const st = STAGES[0]!.stages[2]!;
const gate = st.n - 2;
for (const [w, h] of [
  [1280, 720],
  [812, 375],
] as const) {
  test(`ridge of stage ${st.n}: «level ${st.level}» on it, the pill red below the level and green with it (${w}×${h})`, async ({ page, openGame }) => {
    await page.setViewportSize({ width: w, height: h });
    await openGame('pace=stages');
    await waitTicks(page, 10);
    await page.evaluate(([s, z, y]) => {
      window.__TEST__!.setStat(s);
      window.__TEST__!.teleport(z, 0, y + 0.5);
    }, [threshold(st.level - 1), st.z0 - 12, STAGES[0]!.stages[1]!.y] as const);
    await waitTicks(page, 20);
    expect((await page.evaluate((i) => window.__TEST__!.gateSign(i), gate)).text).toBe(String(st.level));
    const pill = page.locator('[data-role=need]');
    await expect(pill).toBeVisible();
    await expect(pill).toContainText(String(st.level - 1));
    await expect(pill).toContainText(String(st.level));
    expect(await pill.evaluate((e) => e.classList.contains('ok'))).toBe(false);
    const box = (await pill.boundingBox())!;
    expect(box.width, 'pill, not a board').toBeLessThanOrEqual(w * 0.25);
    expect(await page.evaluate((i) => window.__TEST__!.state().gatesOpen[i], gate)).toBe(false);
    await page.evaluate((s) => window.__TEST__!.setStat(s), threshold(st.level));
    await expect(pill).toHaveClass(/ok/);
    await page.waitForFunction((i) => window.__TEST__!.state().gatesOpen[i] === true, gate);
    await page.screenshot({ path: `docs/evidence/lv/gate-${w}.png` });
  });
}
