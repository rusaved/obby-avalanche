import { test, expect } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { scaleText } from './mu-checks.ts';
import { STAGES, threshold } from './lv-stage-data.ts';
import { waitTicks } from './fixtures.ts';
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

    test('(2) «Stage reward»: off the field or in the thumb zones — hidden; on the pad — held in sight', async ({ page, openGame }) => {
      test.setTimeout(180_000);
      const W = STAGES[0]!;
      await openGame('pace=stages');
      const st3 = W.stages[2]!;
      await prepare(page, threshold(st3.level + 1));
      const st4 = W.stages[3]!;
      // l2-gate: at the ridge of stage 4, the pad of stage 3 behind.
      await page.evaluate(([s, z]) => {
        window.__TEST__!.setStat(s);
        window.__TEST__!.teleport(z);
      }, [threshold(st4.level - 3), st4.z0 - 5] as const);
      await waitTicks(page, 30);
      const plaque = (): Promise<{ shown: boolean; r: DOMRect; zones: DOMRect[] }> =>
        page.evaluate(() => {
          const p = document.querySelector('[data-role="pad-label"]') as HTMLElement;
          const shown = p.classList.contains('shown') && getComputedStyle(p).visibility !== 'hidden';
          const zones = ['[data-role="stick"]', '[data-hud="jump"]'].map((q) => document.querySelector(q)!.getBoundingClientRect());
          return { shown, r: p.getBoundingClientRect(), zones };
        });
      const inZone = (r: DOMRect, zones: DOMRect[]): boolean =>
        r.bottom > zones[0]!.top - 8 && r.left < zones[0]!.right + 8 || r.bottom > zones[1]!.top - 8 && r.right > zones[1]!.left - 8;
      for (let i = 0; i < 10; i++) {
        const p = await plaque();
        if (p.shown) expect(inZone(p.r, p.zones), `the plaque at ${JSON.stringify(p.r)} in a thumb zone`).toBe(false);
        await page.waitForTimeout(100);
      }
      // On the pad of stage 3: the plaque stays in sight while the hero stands there.
      await page.evaluate(([s, z, x, y]) => {
        window.__TEST__!.setStat(s);
        window.__TEST__!.teleport(z, x, y);
      }, [threshold(st3.level + 2), st3.finish[0] - 6, st3.pad.x, st3.y + 1] as const);
      await waitTicks(page, 10);
      await page.evaluate((p) => window.__TEST__!.teleport(p.z, p.x, p.y + 1), st3.pad);
      await expect(page.locator('[data-role="toast"].shown .hud-toast-main svg')).toHaveCount(1, { timeout: 10_000 });
      await page.waitForTimeout(300);
      const on = await plaque();
      expect(on.shown, 'the plaque on the pad').toBe(true);
      expect(inZone(on.r, on.zones)).toBe(false);
    });

    test('(3) the ridge board: flat to the camera, «LEVEL NEEDED» ≥ 12 px and the number ≥ 32 px, upright, off the HUD', async ({ page, openGame }) => {
      test.setTimeout(120_000);
      const W = STAGES[0]!;
      await openGame('pace=stages');
      await prepare(page, threshold(5));
      const st4 = W.stages[3]!;
      await page.evaluate(([s, z]) => {
        window.__TEST__!.setStat(s);
        window.__TEST__!.teleport(z);
      }, [threshold(st4.level - 3), st4.z0 - 5] as const);
      await expect(page.locator('[data-role="toast"].shown')).toHaveCount(0, { timeout: 10_000 });
      const sign = page.locator('[data-role="gate-sign"].shown');
      await expect(sign).toBeVisible();
      const f = await sign.evaluate((e) => {
        const w = e.querySelector('.hud-gate-word')!;
        const n = e.querySelector('.hud-gate-num')!;
        const cs = (x: Element) => getComputedStyle(x);
        return { word: w.textContent, wordPx: Number.parseFloat(cs(w).fontSize), num: n.textContent, numPx: Number.parseFloat(cs(n).fontSize), italic: [cs(w).fontStyle, cs(n).fontStyle], transform: (e as HTMLElement).style.transform };
      });
      expect(f.word).toBe('НУЖЕН УРОВЕНЬ');
      expect(f.num).toBe(String(st4.level));
      expect(f.wordPx).toBeGreaterThanOrEqual(12);
      expect(f.numPx).toBeGreaterThanOrEqual(32);
      expect(f.italic).toEqual(['normal', 'normal']);
      expect(f.transform).toMatch(/^translate\([-\d.]+px, [-\d.]+px\)$/);
      expect(await page.evaluate(() => {
        const r = document.querySelector('[data-role="gate-sign"]')!.getBoundingClientRect();
        return Array.from(document.querySelectorAll('.hud-level, [data-role="need"], .hud-mountain, [data-role="stick"], [data-hud="jump"]'))
          .map((e) => e.getBoundingClientRect())
          .filter((b) => b.width > 0 && r.left < b.right + 8 && b.left < r.right + 8 && r.top < b.bottom + 8 && b.top < r.bottom + 8).length;
      }), 'the board 8 px off the HUD').toBe(0);
    });
  });
}
