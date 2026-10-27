import { test, expect, testState } from './fixtures.ts';
import { forbiddenSymbols, hudBoxes, MU_VIEW, tooClose, VISIBLE_H } from './mu-checks.ts';
import { STAGES } from './lv-stage-data.ts';

// MU-01 and MU-02 (docs/07-mobile-ui.md, l1-run-hud-a): tokens and marks, the phone HUD at 812×375 with touch.
test.use({ viewport: MU_VIEW });

async function onRun(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate((z) => {
    const t = window.__TEST__!;
    t.setPlaySec(400);
    t.setCoins(5300);
    t.setTrophies(3);
    t.setStat(900);
    t.holdWave(600);
    // K-01 (red in D20): off the axis — the gifts of stage 3 (D-01 stageGifts) lie on it and would add to the 5 300.
    t.teleport(z, 20);
  }, STAGES[0]!.stages[2]!.start + 4);
  // A tap makes the HUD a touch HUD (the stick rests at its place).
  await page.touchscreen.tap(400, 200);
  await page.waitForTimeout(600);
}

test.describe('MU phone HUD', () => {
  test('MU-01 marks: a coin and a cup by the balances, no font symbols or emoji on the HUD and in the windows', async ({ page, openGame }) => {
    await openGame('pace=stages');
    await onRun(page);
    expect(await page.locator('.hud-coins svg').count()).toBe(1);
    expect(await page.locator('.hud-trophies svg').count()).toBe(1);
    await expect(page.locator('.hud-coin-value')).toHaveText('5 300');
    expect(await forbiddenSymbols(page)).toEqual([]);
    for (const id of ['shop', 'pets', 'more', 'teleport']) {
      await page.locator(`[data-hud="menu-${id}"]`).dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
      await expect(page.locator('[data-role="window"].open')).toBeVisible();
      expect(await forbiddenSymbols(page), id).toEqual([]);
      // Every price of the window has its coin or cup mark next to it.
      const bare = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-role="window"] .card-price')).filter((p) => !p.querySelector('svg')).length,
      );
      expect(bare, id).toBe(0);
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
    }
  });

  test('MU-02 layout of l1-run-hud-a: places ±5 %, gaps ≥ 8 px, the column ends ≥ 24 px over the stick ring', async ({ page, openGame }) => {
    await openGame('pace=stages');
    await onRun(page);
    const s = await testState(page);
    expect(s.touchMode).toBe(true);
    const boxes = await hudBoxes(page);
    const byId = (id: string) => boxes.find((b) => b.id === id)!;
    const W = MU_VIEW.width;
    const near = (v: number, want: number, of: number, what: string) => expect(Math.abs(v - want), `${what}: ${Math.round(v)} vs ${want}`).toBeLessThanOrEqual(of * 0.05);
    // Counters at (16, 8), the column 2×2 from (16, 48) down to 176.
    near(byId('counters').x, 16, W, 'counters x');
    near(byId('counters').y, 8, VISIBLE_H, 'counters y');
    const tiles = boxes.filter((b) => b.id.startsWith('tile'));
    expect(tiles.length).toBe(4);
    near(Math.min(...tiles.map((b) => b.x)), 16, W, 'column x');
    near(Math.min(...tiles.map((b) => b.y)), 48, VISIBLE_H, 'column top');
    const columnBottom = Math.max(...tiles.map((b) => b.y + b.h));
    expect(columnBottom).toBeLessThanOrEqual(176 + 1);
    const tileButtons = await page.$$eval('.hud-menu-icon', (n) => n.map((e) => e.getBoundingClientRect()).map((r) => [r.width, r.height]));
    for (const [w, h] of tileButtons) expect(Math.min(w!, h!)).toBeGreaterThanOrEqual(44);
    // The stick ring ≥ 24 px under the column; round of fixes 2 (staff): level with the jump, not 216 of the mockup.
    const ring = await page.locator('[data-role="stick"]').boundingBox();
    expect(ring).not.toBeNull();
    const jump = (await page.locator('[data-hud="jump"]').boundingBox())!;
    // MU round 4 (A66): the ring 16 px over the bottom edge — its centre 12 px over the jump's.
    expect(Math.abs(ring!.y + ring!.height / 2 - (jump.y + jump.height / 2)), 'stick near the level of the jump').toBeLessThanOrEqual(14);
    expect(MU_VIEW.height - (ring!.y + ring!.height), 'the ring 16 px over the bottom').toBeGreaterThanOrEqual(15.5);
    expect(ring!.y - columnBottom).toBeGreaterThanOrEqual(24);
    // The strip at the top centre; sound, pause and the gift at the right.
    near(byId('strip').x + byId('strip').w / 2, W / 2, W, 'strip centre');
    near(byId('pause').x + byId('pause').w, W - 16, W, 'pause right');
    near(byId('gift').y, 60, VISIBLE_H, 'gift top');
    for (const id of ['pause', 'sound', 'gift', 'jump']) expect(Math.min(byId(id).w, byId(id).h), id).toBeGreaterThanOrEqual(44);
    // Round 3 (producer: the HUD compact): the bar 320×26 and the shoes button on one line 16 px over the bottom, «N Speed»
    // 8 px over the bar.
    near(byId('bar').y + byId('bar').h, VISIBLE_H - 25, VISIBLE_H, 'bar bottom');
    near(byId('speed').y + byId('speed').h, byId('bar').y - 8, VISIBLE_H, 'speed over the bar');
    // Round 3: the bar gives way (down to 160) so that the shoes keep 100 px off the jump (rule 2).
    expect(byId('bar').w).toBeGreaterThanOrEqual(160 - 0.5);
    expect(byId('bar').w).toBeLessThanOrEqual(320 + 0.5);
    // ST-07 (producer 22.10: the level bar the main plaque): 32 high.
    expect(Math.abs(byId('bar').h - 32)).toBeLessThanOrEqual(2);
    near(byId('jump').x + byId('jump').w, W - 16, W, 'jump right');
    near(byId('jump').y + byId('jump').h, VISIBLE_H - 16, VISIBLE_H, 'jump bottom');
    expect(Math.abs(byId('jump').w - 64)).toBeLessThanOrEqual(2);
    if (boxes.some((b) => b.id === 'shoes')) {
      near(byId('shoes').y + byId('shoes').h, VISIBLE_H - 16, VISIBLE_H, 'shoes bottom');
      near(byId('shoes').y + byId('shoes').h / 2, byId('bar').y + byId('bar').h / 2, VISIBLE_H, 'shoes on the line of the bar');
    }
    // Nothing past the bottom of the visible frame (round 3: no bottom band, the field is the visible window).
    for (const b of boxes) expect(b.y + b.h, b.id).toBeLessThanOrEqual(VISIBLE_H + 0.5);
    expect(tooClose(boxes, 8)).toEqual([]);
    // No Speed plaque with the bolt, no «+1 a step», no «×1 a section».
    expect(await page.locator('.hud-stat-icon:visible, .hud-stat-per:visible').count()).toBe(0);
    await expect(page.locator('.hud-stat-section')).toBeHidden();
    await page.screenshot({ path: 'docs/evidence/MU/l1-run-hud.png' });
  });
});
