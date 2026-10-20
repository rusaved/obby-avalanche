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
    // MU round 3 (producer: the HUD compact): the bar and the shoes button on one line 16 px over the bottom (the bar 26
    // high in the middle of the 44 of the button: its bottom 25 px over it); the line between the stick and the jump.
    expect(Math.abs(box.y + box.height - (h - 25)), 'bar at the bottom').toBeLessThanOrEqual(2);
    expect(box.x, 'bar right of the stick').toBeGreaterThanOrEqual(120);
    expect(box.x + box.width, 'bar left of the jump').toBeLessThanOrEqual(w - 16 - 64 - 8 + 0.5);
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
