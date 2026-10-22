import { test, expect } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// MU round 5, item 6 (producer 21.10): after a rewarded ad a toast says what it gave — «+N Speed» (and «Back on stage N»
// after «Ad: from stage N», lv-rollback) — not «Reward received».

const dirOf = (page: Page): string => {
  const { width, height } = page.viewportSize()!;
  const d = `docs/evidence/MU/r5/${width}x${height}`;
  mkdirSync(d, { recursive: true });
  return d;
};
async function tap(page: Page, hud: string): Promise<void> {
  const b = page.locator(`[data-hud="${hud}"]`).first();
  await b.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
  await b.dispatchEvent('click', { detail: 1 });
}
async function start(page: Page, openGame: (q?: string) => Promise<void>): Promise<void> {
  await openGame('pace=stages&mock_fullscreen=deny');
  const { width, height } = page.viewportSize()!;
  await page.evaluate(() => {
    const t = window.__TEST__!;
    t.setPlaySec(400);
    // M4 review: the ad of «Gifts» by the common rules — past the first avalanche.
    t.setFlag('firstWaveDone', true);
    t.holdWave(9000);
    t.setStat(5000);
    const seen: string[] = [];
    (window as unknown as { __toasts: string[] }).__toasts = seen;
    const el = document.querySelector('[data-role="toast"]')!;
    new MutationObserver(() => {
      const s = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (s && seen[seen.length - 1] !== s) seen.push(s);
    }).observe(el, { childList: true, subtree: true, characterData: true });
  });
  await page.touchscreen.tap(width / 2, height / 2);
  await page.waitForTimeout(300);
}
const toasts = (page: Page): Promise<string> => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts.join(' | '));

test('the Speed ad of «Gifts»: a toast «+N Speed»', async ({ page, openGame }) => {
  await start(page, openGame);
  await tap(page, 'gift');
  await expect(page.locator('[data-role="window"].open')).toHaveCount(1);
  await page.locator('[data-role="window"].open [data-hud="gift-ad"]').click();
  await expect.poll(() => toasts(page), { timeout: 15_000 }).toMatch(/\+[\d\s ]+[KМMТ]?\S* Скорости|\+\S+ Speed/);
  expect(await toasts(page)).not.toMatch(/Награда получена|Reward received/);
  if ((await page.locator('[data-role="window"].open').count()) > 0) await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dirOf(page)}/ad-toast.png` });
});

