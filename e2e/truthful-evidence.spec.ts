import { mkdirSync } from 'node:fs';
import { test, expect, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { labelsOverHud, scaleText } from './mu-checks.ts';
import { STAGES, threshold } from './lv-stage-data.ts';

// MU round 3, item 8: the frames of the round on the truthful profile (915 × 412 and 815 × 290), at 100 % and 130 % text
// — the run HUD (l1), the ridge (l2-gate), on the pad (l3), the level toast (l4), the stage strip in and out, the windows
// «Gifts», «Quests», «Shop → Sneakers», «Rebirth», «Calendar». Shots only (the rules — truthful-* and touch-mu-*); the
// rises before and after are shot by truthful-rise.

const W = STAGES[0]!;

async function tap(page: Page, hud: string): Promise<void> {
  const b = page.locator(`[data-hud="${hud}"]`).first();
  await b.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
  await b.dispatchEvent('click', { detail: 1 });
}

for (const k of [1, 1.3]) {
  const tag = k > 1 ? '-130' : '';
  test(`the run, the ridge, the pad, the level toast, the strip${tag ? ' at 130 %' : ''}`, async ({ page, openGame }) => {
    test.setTimeout(180_000);
    await openGame('pace=stages&mock_fullscreen=deny');
    const { width, height } = page.viewportSize()!;
    const dir = `docs/evidence/MU/r4/${width}x${height}`;
    mkdirSync(dir, { recursive: true });
    const st3 = W.stages[2]!;
    await page.evaluate((s) => {
      const t = window.__TEST__!;
      t.setPlaySec(400);
      t.setCoins(5300);
      t.setTrophies(3);
      t.holdWave(900);
      t.setStat(s);
    }, threshold(st3.level + 1));
    await page.touchscreen.tap(width / 2, height / 2);
    if (k > 1) await scaleText(page, k);
    // l1: a run on the flat of stage 1 with «+N» by the hero; the strip in (a new stage), then out.
    await page.evaluate((z) => window.__TEST__!.teleport(z), W.stages[0]!.start + 60);
    await waitTicks(page, 5);
    await page.screenshot({ path: `${dir}/strip-in${tag}.png` });
    await page.evaluate(() => window.__TEST__!.stick(0, 1));
    await page.locator('.hud-gain.show').first().waitFor({ state: 'visible', timeout: 10_000 });
    await page.screenshot({ path: `${dir}/l1-run${tag}.png` });
    await page.evaluate(() => window.__TEST__!.stick(0, 0));
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.hud-mountain')!).opacity) < 0.05, undefined, { timeout: 6_000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/strip-out${tag}.png` });
    // l2-gate: three levels short at the ridge of stage 4.
    const st4 = W.stages[3]!; // G-01: the ridge of the avalanche stage — from the end of the dips (the plates moved to 5)
    await page.evaluate(([s, z]) => {
      window.__TEST__!.setStat(s);
      window.__TEST__!.teleport(z);
    }, [threshold(st4.level - 3), st4.z0 - 5] as const);
    await expect(page.locator('[data-role="need"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-role="toast"].shown')).toHaveCount(0, { timeout: 10_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/l2-gate${tag}.png` });
    // l3: on the pad of stage 3 — the reward toast, «Stage reward» by the hero.
    await page.evaluate(([s, z, x, y]) => {
      window.__TEST__!.setStat(s);
      window.__TEST__!.teleport(z, x, y);
    }, [threshold(st3.level + 2), st3.finish[0] + 2, st3.pad.x * 0.8, st3.y + 1] as const);
    await waitTicks(page, 10);
    await page.evaluate((p) => window.__TEST__!.teleport(p.z, p.x, p.y + 1), st3.pad);
    await expect(page.locator('[data-role="toast"].shown .hud-toast-main svg')).toHaveCount(1, { timeout: 10_000 });
    await page.waitForTimeout(300);
    expect(await labelsOverHud(page)).toEqual([]);
    await page.screenshot({ path: `${dir}/l3-pad${tag}.png` });
    // l4: back in the camp, the toast of a 5th level.
    await page.waitForFunction(() => window.__TEST__!.state().stage <= 1, undefined, { timeout: 20_000 });
    await expect(page.locator('[data-role="toast"].shown')).toHaveCount(0, { timeout: 10_000 });
    await page.evaluate((s) => window.__TEST__!.setStat(s), threshold(15) + 1);
    await expect(page.locator('[data-role="toast"].shown .hud-toast-main')).toHaveText('УРОВЕНЬ ВЫШЕ!', { timeout: 10_000 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${dir}/l4-level-up${tag}.png` });
  });

  test(`the windows «Gifts», «Quests», «Shop → Sneakers», «Rebirth», «Calendar»${tag ? ' at 130 %' : ''}`, async ({ page, openGame }) => {
    test.setTimeout(180_000);
    await openGame('pace=stages&mock_fullscreen=deny');
    const { width, height } = page.viewportSize()!;
    const dir = `docs/evidence/MU/r4/${width}x${height}`;
    mkdirSync(dir, { recursive: true });
    await page.evaluate((s) => {
      const t = window.__TEST__!;
      t.setPlaySec(400);
      t.setCoins(5300);
      t.setTrophies(3);
      t.holdWave(900);
      t.setStat(s);
    }, threshold(30));
    await page.touchscreen.tap(width / 2, height / 2);
    await page.waitForTimeout(300);
    const more = (id: string) => async (): Promise<void> => {
      await tap(page, 'menu-more');
      await page.locator(`[data-hud="more-${id}"]`).click();
    };
    const windows: Array<[string, () => Promise<void>]> = [
      ['gifts', () => tap(page, 'gift')],
      ['quests', more('quests')],
      ['shop', async () => {
        await tap(page, 'menu-shop');
        await page.locator('[data-hud="shop-tab-shoes"]').click();
      }],
      ['rebirth', more('rebirth')],
      ['daily', more('daily')],
    ];
    for (const [id, open] of windows) {
      await open();
      await expect(page.locator('[data-role="window"].open')).toBeVisible();
      if (k > 1) await scaleText(page, k);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${dir}/w-${id}${tag}.png` });
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
      if (k > 1) await scaleText(page, 1);
      await page.waitForTimeout(300);
    }
  });
}
