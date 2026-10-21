import { test, expect, waitTicks } from './fixtures.ts';
import { STAGES, threshold } from './lv-stage-data.ts';

// LV-02 (docs/01-gdd.md 22.3): the ridge of a stage shows the level it asks for; MU-03 (docs/07-mobile-ui.md, l2-gate):
// by a closed ridge one plaque in the slot «1 more level to the gate», with the level it goes and the ice melts.
const st = STAGES[0]!.stages[2]!;
const gate = st.n - 2;
for (const [w, h] of [
  [1280, 720],
  [812, 375],
] as const) {
  test(`ridge of stage ${st.n}: «level ${st.level}» on it, the plaque «1 more level» below the level and none with it (${w}×${h})`, async ({ page, openGame }) => {
    await page.setViewportSize({ width: w, height: h });
    await openGame('pace=stages');
    await waitTicks(page, 10);
    // MU round 5: not the first run of mountain 1 (there the plaque points to a treadmill — truthful-pad-hints).
    await page.evaluate(([s, z, y]) => {
      window.__TEST__!.setSummits(1);
      window.__TEST__!.setStat(s);
      window.__TEST__!.teleport(z, 0, y + 0.5);
    }, [threshold(st.level - 1), st.z0 - 12, STAGES[0]!.stages[1]!.y] as const);
    await waitTicks(page, 20);
    expect((await page.evaluate((i) => window.__TEST__!.gateSign(i), gate)).text).toBe(String(st.level));
    const pill = page.locator('[data-role=need]');
    await expect(pill).toBeVisible();
    await expect(pill).toHaveText(/Ещё 1 уровень до рубежа/);
    const box = (await pill.boundingBox())!;
    expect(box.width, 'one line of the slot, not a board').toBeLessThanOrEqual(w * 0.54);
    expect(await page.evaluate((i) => window.__TEST__!.state().gatesOpen[i], gate)).toBe(false);
    await page.evaluate((s) => window.__TEST__!.setStat(s), threshold(st.level));
    await expect(pill).toBeHidden();
    await page.waitForFunction((i) => window.__TEST__!.state().gatesOpen[i] === true, gate);
    await page.screenshot({ path: `docs/evidence/lv/gate-${w}.png` });
  });
}
