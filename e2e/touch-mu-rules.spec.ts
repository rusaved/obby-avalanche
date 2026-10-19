import { test, expect } from './fixtures.ts';
import { cutText, forbiddenSymbols, hudBoxes, MU_VIEW, ruleProblems, scaleText, tooClose, VISIBLE_H } from './mu-checks.ts';
import { STAGES, threshold } from './lv-stage-data.ts';
import type { Page } from '@playwright/test';

// MU-10 (docs/07-mobile-ui.md, rules 1–23 «Приёмка экрана»): the automatic check of every phone screen at 812×375 —
// tap zones ≥ 44, text ≥ 12 (≥ 14 on the HUD but its captions), button contrast ≥ 4.5:1, no overlaps (gaps ≥ 8), one
// window at a time, nothing under the bottom 45 px, at 130 % text nothing cut and the windows scroll.
test.use({ viewport: MU_VIEW });

async function tap(page: Page, hud: string): Promise<void> {
  const b = page.locator(`[data-hud="${hud}"]`).first();
  await b.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
  await b.dispatchEvent('click', { detail: 1 });
}

const WINDOWS: Array<[string, (page: Page) => Promise<void>]> = [
  ['gifts', (p) => tap(p, 'gift')],
  ['teleport', (p) => tap(p, 'menu-teleport')],
  ['pause', (p) => tap(p, 'pause')],
  ['more', (p) => tap(p, 'menu-more')],
  ['shop', (p) => tap(p, 'menu-shop')],
  ['pets', (p) => tap(p, 'menu-pets')],
  ['footsteps', async (p) => { await tap(p, 'menu-more'); await p.locator('[data-hud="more-footsteps"]').click(); }],
  ['quests', async (p) => { await tap(p, 'menu-more'); await p.locator('[data-hud="more-quests"]').click(); }],
  ['daily', async (p) => { await tap(p, 'menu-more'); await p.locator('[data-hud="more-daily"]').click(); }],
];

test.describe('MU-10 rules of docs/07 on the phone', () => {
  test('the HUD of a run and every window: tap zones, text sizes, contrast, overlaps, the bottom band, one window', async ({ page, openGame }) => {
    await openGame('pace=stages');
    await page.evaluate((z) => {
      const t = window.__TEST__!;
      t.setPlaySec(400);
      t.setCoins(5300);
      t.setTrophies(3);
      t.setStat(900);
      t.holdWave(900);
      t.teleport(z);
    }, STAGES[0]!.stages[2]!.start + 4);
    await page.touchscreen.tap(400, 200);
    await page.waitForTimeout(500);
    expect(await ruleProblems(page, 12)).toEqual([]);
    const boxes = await hudBoxes(page);
    expect(tooClose(boxes, 8)).toEqual([]);
    for (const b of boxes) expect(b.y + b.h, b.id).toBeLessThanOrEqual(VISIBLE_H + 0.5);
    for (const [id, open] of WINDOWS) {
      await open(page);
      await expect(page.locator('[data-role="window"].open'), id).toHaveCount(1);
      expect(await ruleProblems(page, 12), id).toEqual([]);
      expect(await forbiddenSymbols(page), id).toEqual([]);
      const r = (await page.locator('[data-role="window"].open .win-panel').boundingBox())!;
      expect(r.y + r.height, id).toBeLessThanOrEqual(VISIBLE_H + 0.5);
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
    }
  });

  test('130 % text: nothing on the HUD is cut, the windows grow up to the visible height and scroll visibly', async ({ page, openGame }) => {
    await openGame('pace=stages');
    await page.evaluate((n) => {
      const t = window.__TEST__!;
      t.setPlaySec(400);
      t.setCoins(5300);
      t.setStat(n);
      t.holdWave(900);
    }, threshold(20));
    await page.touchscreen.tap(400, 200);
    await page.waitForTimeout(400);
    await scaleText(page, 1.3);
    await page.waitForTimeout(200);
    expect(await cutText(page)).toEqual([]);
    await page.screenshot({ path: 'docs/evidence/MU/text-130-hud.png' });
    for (const [id, open] of WINDOWS) {
      await open(page);
      await expect(page.locator('[data-role="window"].open'), id).toHaveCount(1);
      await scaleText(page, 1.3);
      await page.waitForTimeout(100);
      const panel = (await page.locator('[data-role="window"].open .win-panel').boundingBox())!;
      // MU round of fixes 2 (staff 19.10): at 130 % the panel grows past 300 up to the visible height minus the margins.
      expect(panel.height, id).toBeLessThanOrEqual(VISIBLE_H - 16 + 0.5);
      expect(await cutText(page), id).toEqual([]);
      const body = page.locator('[data-role="window"].open .win-body');
      const s = await body.evaluate((b) => ({ sh: b.scrollHeight, ch: b.clientHeight, oy: getComputedStyle(b).overflowY }));
      if (s.sh > s.ch + 2) {
        expect(s.oy, `${id}: the middle scrolls`).toBe('auto');
        await expect(body, `${id}: the scroll shows`).toHaveAttribute('data-more', '');
      }
      if (id === 'pause') await page.screenshot({ path: 'docs/evidence/MU/text-130-pause.png' });
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
    }
  });
});
