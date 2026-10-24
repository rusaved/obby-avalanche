import { test, expect } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { STAGES } from './lv-stage-data.ts';

// FX (producer 22.10): the frames of the milestone on the phone — every window and the toasts of every kind, the bubble
// of a reason, a reward in flight (docs/evidence/FX/<size>/).

async function tap(page: Page, hud: string): Promise<void> {
  const b = page.locator(`[data-hud="${hud}"]`).first();
  await b.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
  await b.dispatchEvent('click', { detail: 1 });
}
const more = (id: string) => async (page: Page): Promise<void> => {
  await tap(page, 'menu-more');
  await page.locator(`[data-hud="more-${id}"]`).click();
};
const WINDOWS: Array<[string, (page: Page) => Promise<void>]> = [
  ['gifts', (p) => tap(p, 'gift')],
  ['teleport', (p) => tap(p, 'menu-teleport')],
  ['pause', (p) => tap(p, 'pause')],
  ['more', (p) => tap(p, 'menu-more')],
  ['shop', (p) => tap(p, 'menu-shop')],
  ['pets', (p) => tap(p, 'menu-pets')],
  ['footsteps', more('footsteps')],
  ['wardrobe', more('wardrobe')],
  ['rebirth', more('rebirth')],
  ['records', more('records')],
  ['quests', more('quests')],
  ['daily', more('daily')],
];

for (const [w, h] of [[880, 405], [815, 290]] as const)
  test.describe(`${w} × ${h}`, () => {
    test.use({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
    const dir = `docs/evidence/FX/${w}x${h}`;
    const shot = (page: Page, name: string): Promise<Buffer> => page.screenshot({ path: `${dir}/${name}.png` });

    test('every window and toast, the bubble of a reason, a reward in flight', async ({ page, openGame }) => {
      test.setTimeout(240_000);
      mkdirSync(dir, { recursive: true });
      await openGame('pace=stages&mock_device=mobile');
      await page.evaluate((z) => {
        const t = window.__TEST__!;
        t.setPlaySec(400);
        t.setCoins(5300);
        t.setTrophies(3);
        t.holdWave(900);
        t.teleport(z);
      }, STAGES[0]!.stages[2]!.start + 4);
      await page.touchscreen.tap(400, 200);
      await page.waitForTimeout(400);
      // Toasts: an event, a reward, the golden one.
      await page.evaluate(() => window.__TEST__!.showToast('Снег скрыл путь', 3));
      await page.waitForTimeout(300);
      await shot(page, 'toast-event');
      await page.waitForTimeout(3200);
      await page.evaluate(() => window.__TEST__!.showToast('Подарок +150', 3));
      await page.waitForTimeout(300);
      await shot(page, 'toast-reward');
      await page.waitForTimeout(3200);
      await page.evaluate(() => window.__TEST__!.showToast('Золотой подарок! +500', 3, true));
      await page.waitForTimeout(300);
      await shot(page, 'toast-gold');
      await page.waitForTimeout(3200);
      for (const [id, open] of WINDOWS) {
        await open(page);
        await expect(page.locator('[data-role="window"].open'), id).toHaveCount(1);
        await page.waitForTimeout(250);
        await shot(page, `win-${id}`);
        if (id === 'rebirth') {
          await tap(page, 'rebirth-do');
          await expect(page.locator('[data-role="why"].shown')).toHaveCount(1);
          await page.waitForTimeout(250);
          await shot(page, 'why-rebirth');
        }
        if (id === 'daily' && (await page.locator('[data-hud="daily-claim"]').count()) > 0) {
          await page.locator('[data-hud="daily-claim"]').click();
          await page.waitForTimeout(350);
          await shot(page, 'reward-fly');
          await page.waitForTimeout(900);
          await shot(page, 'reward-got');
        }
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
        await page.waitForTimeout(200);
      }
    });
  });
