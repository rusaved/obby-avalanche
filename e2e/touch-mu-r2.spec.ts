import { test, expect } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { scaleText } from './mu-checks.ts';
import { threshold } from './lv-stage-data.ts';
import ru from '../content/avalanche/i18n/ru.json' with { type: 'json' };

// MU round of fixes 2 (staff pre-acceptance 19.10, second pass): windows at 130 % text, the world labels, the two rows of
// «Shop → Steps» and «Wardrobe», the HUD. At 812 × 375 and 915 × 412 with touch.

async function tap(page: Page, hud: string): Promise<void> {
  const b = page.locator(`[data-hud="${hud}"]`).first();
  await b.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
  await b.dispatchEvent('click', { detail: 1 });
}

async function prepare(page: Page, stat: number): Promise<void> {
  await page.evaluate((s) => {
    const t = window.__TEST__!;
    t.setPlaySec(400);
    t.setCoins(5300);
    t.setTrophies(3);
    t.holdWave(900);
    t.setStat(s);
  }, stat);
  await page.touchscreen.tap(400, 200);
  await page.waitForTimeout(300);
}

async function closeWindow(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
  await page.waitForTimeout(300);
}

const more = (page: Page, id: string) => async (): Promise<void> => {
  await tap(page, 'menu-more');
  await page.locator(`[data-hud="more-${id}"]`).click();
};

/** The open window: panel and middle, buttons cut by their card or (when `whole`) by the middle, text closer than 8 px
 *  to the edge of its button or card. */
async function windowCheck(page: Page): Promise<{ h: number; scroll: boolean; more: boolean; cut: string[]; tight: string[] }> {
  return page.evaluate(() => {
    const dim = document.querySelector('[data-role="window"].open')!;
    const body = dim.querySelector('.win-body') as HTMLElement;
    const view = body.getBoundingClientRect();
    const cut: string[] = [];
    const tight: string[] = [];
    for (const b of Array.from(dim.querySelectorAll('button'))) {
      const r = b.getBoundingClientRect();
      if (r.width === 0 || getComputedStyle(b).visibility === 'hidden') continue;
      const card = b.parentElement?.closest('.card');
      const c = card?.getBoundingClientRect();
      if (c && (r.left < c.left - 0.5 || r.right > c.right + 0.5 || r.bottom > c.bottom + 0.5)) cut.push(`card: ${b.textContent}`);
      if (body.contains(b) && body.scrollHeight <= body.clientHeight + 2 && (r.bottom > view.bottom + 0.5 || r.top < view.top - 0.5)) cut.push(`middle: ${b.textContent}`);
    }
    const walker = document.createTreeWalker(dim, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? '').trim();
      const host = n.parentElement?.closest('button, .card');
      if (!text || !host || !(host as HTMLElement).offsetWidth) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const t = range.getBoundingClientRect();
      if (t.width === 0) continue;
      const h = host.getBoundingClientRect();
      const gap = Math.min(t.left - h.left, h.right - t.right);
      if (gap < 7.5) tight.push(`${(host as HTMLElement).className}: ${text} (${gap.toFixed(1)})`);
    }
    return { h: dim.querySelector('.win-panel')!.getBoundingClientRect().height, scroll: body.scrollHeight > body.clientHeight + 2, more: body.hasAttribute('data-more'), cut, tight };
  });
}

for (const view of [{ width: 812, height: 375 }, { width: 915, height: 412 }]) {
  test.describe(`MU round of fixes 2, ${view.width} × ${view.height}`, () => {
    test.use({ viewport: view });

    test('(1) windows at 130 %: the panel grows to the visible height, the middle scrolls visibly, no button cut, text 8 px inside buttons and cards', async ({ page, openGame }) => {
      test.setTimeout(180_000);
      await openGame('pace=stages');
      await prepare(page, threshold(30));
      const visible = await page.evaluate(() => window.innerHeight - (Number.parseFloat(getComputedStyle(document.querySelector('.hud')!).getPropertyValue('--mu-bottom')) || 0));
      const windows: Array<[string, () => Promise<void>]> = [
        ['gifts', () => tap(page, 'gift')],
        ['daily', more(page, 'daily')],
        ['rebirth', more(page, 'rebirth')],
        ['footsteps', more(page, 'footsteps')],
      ];
      for (const k of [1, 1.3]) {
        for (const [id, open] of windows) {
          await open();
          await expect(page.locator('[data-role="window"].open')).toBeVisible();
          if (k > 1) await scaleText(page, k);
          await page.waitForTimeout(250);
          const w = await windowCheck(page);
          const tag = `${id} ×${k}`;
          expect(w.h, tag).toBeLessThanOrEqual(k > 1 ? visible - 16 + 0.5 : 300.5);
          if (w.scroll) expect(w.more, `${tag}: the scroll shows`).toBe(true);
          expect(w.cut, tag).toEqual([]);
          // Scrolled to the end, every button of the middle is whole in it.
          await page.locator('[data-role="window"].open .win-body').evaluate((b) => b.scrollTo(0, b.scrollHeight));
          await page.waitForTimeout(100);
          expect(await page.evaluate(() => {
            const body = document.querySelector('[data-role="window"].open .win-body')!;
            const v = body.getBoundingClientRect();
            return Array.from(body.querySelectorAll('button')).filter((b) => {
              const r = b.getBoundingClientRect();
              return r.width > 0 && r.top >= v.top - 0.5 && r.top < v.bottom && r.bottom > v.bottom + 0.5;
            }).map((b) => b.textContent);
          }), `${tag}: buttons at the end`).toEqual([]);
          expect(w.tight, tag).toEqual([]);
          await closeWindow(page);
        }
      }
      expect((ru as Record<string, string>)['footsteps.toShop'], '«В магазин» never breaks').toBe('В\u00a0магазин');
    });
  });
}
