import { test, expect, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';

// MU round of fixes, fix 2 (staff check 19.10): on the producer's link the SDK mock calls a phone a desktop, and the
// game sat in 2:1 — canvas 750 × 375 shifted 31 px on 812 × 375, «Turn your phone» with bars, the dim of a window ending
// at 330 of 375. A touch screen gets the whole window at any ratio: the canvas, the interface layer, the dim of a window
// and the rotate screen cover it, no bars of the page background. `mock_device=desktop` is the producer's link.

type Rect = { x: number; y: number; w: number; h: number };
const rect = (page: Page, sel: string): Promise<Rect | null> =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, sel);

async function tap(page: Page, hud: string): Promise<void> {
  const b = page.locator(`[data-hud="${hud}"]`).first();
  await b.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
  await b.dispatchEvent('click', { detail: 1 });
}

for (const [w, h] of [[812, 375], [915, 412], [780, 330]] as const) {
  test(`${w} × ${h}, a touch screen the SDK calls a desktop: canvas, interface and the dim of a window cover the screen`, async ({ page, openGame }) => {
    await page.setViewportSize({ width: w, height: h });
    await openGame('pace=stages&mock_device=desktop');
    await waitTicks(page, 10);
    const full = { x: 0, y: 0, w, h };
    expect(await rect(page, '#game'), 'canvas').toEqual(full);
    expect(await rect(page, '#ui'), 'interface layer').toEqual(full);
    await tap(page, 'pause');
    const dim = page.locator('[data-role="window"].open');
    await expect(dim).toBeVisible();
    expect(await rect(page, '[data-role="window"].open'), 'the dim of a window').toEqual(full);
    // The panel stays inside the screen above the bottom band.
    const panel = await rect(page, '[data-role="window"].open .win-panel');
    expect(panel!.y).toBeGreaterThanOrEqual(0);
    expect(panel!.y + panel!.h).toBeLessThanOrEqual(h);
    await page.screenshot({ path: `docs/evidence/MU/fullscreen-${w}x${h}.png` });
  });
}

test('375 × 812 upright on the producer\'s link: «Turn your phone» covers the whole screen, no bars', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 812, height: 375 });
  await openGame('pace=stages&mock_device=desktop');
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator('[data-role="rotate"].shown')).toBeVisible();
  expect(await rect(page, '[data-role="rotate"].shown'), 'the rotate screen').toEqual({ x: 0, y: 0, w: 375, h: 812 });
  expect(await rect(page, '#game'), 'canvas').toEqual({ x: 0, y: 0, w: 375, h: 812 });
});
