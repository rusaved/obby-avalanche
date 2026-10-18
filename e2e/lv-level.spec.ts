import { test, expect, testState, waitTicks } from './fixtures.ts';

// LV-01 (docs/01-gdd.md 22.2): the level bar of the stages pace — bottom centre, the Speed plaque over it; a threshold
// crossed shows «Level up!». The other paces have no bar.
for (const [w, h] of [
  [1280, 720],
  [812, 375],
] as const) {
  test(`level bar at the bottom with Speed over it, «Level up!» past a threshold (${w}×${h})`, async ({ page, openGame }) => {
    await page.setViewportSize({ width: w, height: h });
    await openGame('pace=stages');
    await waitTicks(page, 10);
    const bar = page.locator('[data-role=level]');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText(/(Уровень|Level) 1/);
    const box = (await bar.boundingBox())!;
    // MU-02 (l1-run-hud-a): the bar ends 68 px over the bottom (the shoes button is under it).
    expect(Math.abs(box.y + box.height - (h - 68)), 'bar at the bottom').toBeLessThanOrEqual(2);
    expect(Math.abs(box.x + box.width / 2 - w / 2), 'bar centred').toBeLessThan(4);
    const stat = (await page.locator('[data-role=stat]').boundingBox())!;
    expect(stat.y + stat.height, 'Speed over the bar').toBeLessThanOrEqual(box.y + box.height - (await page.locator('.hud-level-bar').boundingBox())!.height + 1);
    await page.evaluate(() => window.__TEST__!.setStat(60));
    await expect(bar).toContainText(/(Уровень|Level) 3/);
    await page.waitForFunction(() => window.__TEST__!.state().levelUps >= 1);
    await page.screenshot({ path: `docs/evidence/lv/level-bar-${w}.png` });
    expect((await testState(page)).levelUps).toBeGreaterThanOrEqual(1);
  });
}

test('the open pace has no level bar', async ({ page, openGame }) => {
  await openGame('pace=open');
  await waitTicks(page, 10);
  await expect(page.locator('[data-role=level]')).toBeHidden();
});
