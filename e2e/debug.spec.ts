import { test, expect, testState } from './fixtures.ts';
import { validateTuning } from '../src/level/validate.ts';
import tuning from '../content/avalanche/tuning.json' with { type: 'json' };

// ?debug=1 (docs/02-tech.md, section 15): sliders apply without reload, Export passes the tuning schema,
// the panel collapses on a phone. check-release proves the panel is absent from the release archive.
test.describe('debug panel', () => {
  test('a slider change applies at once: doubled baseSpeed doubles the run speed', async ({ page, openGame }) => {
    await openGame('debug=1');
    await expect(page.locator('.lil-gui').first()).toBeVisible();
    await expect(page.locator('[data-role="debug-overlay"]')).toBeVisible();
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(600);
    const v1 = (await testState(page)).hero!.speed;
    await page.evaluate(() => window.__DEBUG__!.set('controller.baseSpeed', 32));
    await page.waitForTimeout(600);
    const v2 = (await testState(page)).hero!.speed;
    await page.keyboard.up('KeyW');
    expect(v1).toBeCloseTo(16, 0);
    expect(v2).toBeCloseTo(32, 0);
    // Remembered on this device until Reset.
    await page.reload();
    await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 60_000 });
    expect(await page.evaluate(() => window.__DEBUG__!.get('controller.baseSpeed'))).toBe(32);
    await page.evaluate(() => window.__DEBUG__!.set('controller.baseSpeed', 16));
  });

  test('Export gives JSON that passes the tuning.json schema', async ({ page, openGame }) => {
    await openGame('debug=1');
    const json = await page.evaluate(() => window.__DEBUG__!.exportTuning());
    const parsed = JSON.parse(json);
    const res = validateTuning(parsed);
    expect(res.errors).toEqual([]);
    expect(parsed.controller.jumpSpeed).toBe(tuning.controller.jumpSpeed);
    expect(parsed.camera.distance).toBe(tuning.camera.distance);
  });

  test('on a phone the panel starts collapsed and the overlay shows level, DPR and frame time', async ({ page, openGame }) => {
    await openGame('debug=1&mock_device=mobile');
    const closed = await page.locator('.lil-gui.lil-root').first().evaluate((el) => el.classList.contains('lil-closed'));
    expect(closed).toBe(true);
    await page.waitForTimeout(700);
    const text = await page.locator('[data-role="debug-overlay"]').textContent();
    expect(text).toMatch(/(low|medium|high) dpr [\d.]+/);
    expect(text).toMatch(/\d+(\.\d+)? ms/);
    expect(text).toMatch(/calls \d+/);
  });
});
