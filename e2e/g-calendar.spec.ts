import { test, expect, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';

// G-04 (producer 26.10: «the rewards are at the top, you cannot see them; the VK and other group rewards cover them»):
// on 880×405 and 815×290 the 7 days of the gift calendar and their rewards are whole inside the window and nothing
// covers them; the «Gifts» window — its timer tiles not covered by the cards of the groups.
type Box = { x: number; y: number; width: number; height: number };
const inside = (a: Box, b: Box): boolean => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.width <= b.x + b.width + 1 && a.y + a.height <= b.y + b.height + 1;
const cross = (a: Box, b: Box): boolean => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

async function topAt(page: Page, sel: string): Promise<boolean[]> {
  // Each card: the element at its centre and at its corners is the card itself or inside it (nothing over it).
  return page.locator(sel).evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      const pts = [
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + 4, r.top + 4],
        [r.right - 4, r.top + 4],
        [r.left + 4, r.bottom - 4],
        [r.right - 4, r.bottom - 4],
      ];
      return pts.every(([x, y]) => {
        const h = document.elementFromPoint(x!, y!);
        return !!h && (h === e || e.contains(h));
      });
    }),
  );
}

for (const viewport of [{ width: 880, height: 405 }, { width: 815, height: 290 }]) {
  test.describe(`G-04 · ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });

    test('the calendar: 7 days whole in the window, nothing over them', async ({ page, openGame }) => {
      await openGame('pace=stages&mock_device=mobile');
      await page.evaluate(() => {
        window.__TEST__!.setPlaySec(400);
        window.__TEST__!.setFlag('firstWaveDone', true);
        window.__TEST__!.holdWave(9000);
      });
      await waitTicks(page, 10);
      await page.locator('[data-hud="menu-more"]').dispatchEvent('pointerdown');
      await page.locator('[data-hud="more-daily"]').click();
      const cards = page.locator('[data-role="window"].open [data-role="daily-card"]');
      await expect(cards).toHaveCount(7);
      await page.waitForTimeout(400);
      const win = (await page.locator('[data-role="window"].open .win-body').boundingBox())!;
      for (let i = 0; i < 7; i++) {
        const b = (await cards.nth(i).boundingBox())!;
        expect(inside(b, win), `day ${i + 1} inside the window body`).toBe(true);
        for (const sel of ['.card-name', '.rw-icon']) {
          const p = (await cards.nth(i).locator(sel).boundingBox())!;
          expect(inside(p, b), `day ${i + 1} ${sel} inside its card`).toBe(true);
        }
      }
      expect((await topAt(page, '[data-role="window"].open [data-role="daily-card"]')).every(Boolean), 'nothing over the days').toBe(true);
      await page.screenshot({ path: `docs/evidence/G/${viewport.width}x${viewport.height}/calendar.png` });
    });

    test('«Gifts»: the timer tiles and the group cards apart', async ({ page, openGame }) => {
      await openGame('pace=stages&mock_device=mobile');
      await page.evaluate(() => {
        window.__TEST__!.setPlaySec(400);
        window.__TEST__!.setFlag('firstWaveDone', true);
        window.__TEST__!.holdWave(9000);
      });
      await waitTicks(page, 10);
      await page.locator('[data-hud="gift"]').dispatchEvent('pointerdown');
      const tiles = page.locator('[data-role="window"].open .gf-tile');
      await expect(tiles.first()).toBeVisible();
      await page.waitForTimeout(400);
      const cards = await page.locator('[data-role="window"].open .gf-card').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as Box));
      for (let i = 0; i < (await tiles.count()); i++) {
        const b = (await tiles.nth(i).boundingBox())!;
        for (const c of cards) expect(cross(b, c), `tile ${i} under a card`).toBe(false);
      }
      await page.screenshot({ path: `docs/evidence/G/${viewport.width}x${viewport.height}/gifts.png` });
    });
  });
}
