import { test, expect, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { STAGES, threshold } from './lv-stage-data.ts';

// M4-R4 (rest of MU, the reviewer's small things, producer 22.10): day 2 of the gift calendar names the skin and the steps
// «Velvet snow»; day 1 — «Coins +N»; «Boost ×2 · 10 min» never leaves its dot hanging at a line end; «Rebirth» at 815 × 290
// shows «Spend the coins…» without a scroll; «Gifts» at 815 — Telegram and VK with their words; squeezed by the banner
// (−160 px) «Mountain N · stage» stays on top. On the truthful profile (880 × 405, 915 × 412, 815 × 290).

const dirOf = (page: Page): string => {
  const { width, height } = page.viewportSize()!;
  const d = `docs/evidence/M4/${width}x${height}`;
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
  await page.evaluate((s) => {
    const t = window.__TEST__!;
    t.setPlaySec(400);
    t.setCoins(5300);
    t.holdWave(900);
    t.setStat(s);
  }, threshold(30));
  await page.touchscreen.tap(width / 2, height / 2);
  await page.waitForTimeout(300);
}
const more = async (page: Page, id: string): Promise<void> => {
  await tap(page, 'menu-more');
  await page.locator(`[data-hud="more-${id}"]`).click();
  await expect(page.locator('[data-role="window"].open')).toHaveCount(1);
  await page.waitForTimeout(300);
};

test('the gift calendar: «Coins +N» on day 1, the skin and «Velvet snow» on day 2, the dot of the boost on its line', async ({ page, openGame }) => {
  await start(page, openGame);
  await more(page, 'daily');
  const cards = page.locator('[data-role="daily-card"]');
  await expect(cards.nth(0)).toContainText(/Монеты \+\d|Coins \+\d/);
  await expect(cards.nth(1)).toContainText(/Скин «Пингвин»|Penguin Suit/);
  await expect(cards.nth(1)).toContainText(/Бархатный снег|Velvet snow/);
  // No line of «Boost ×2 · 10 min» starts or ends with its dot.
  const lines = await cards.nth(2).locator('.card-name').evaluate((e) => {
    const node = e.firstChild!;
    const text = node.textContent ?? '';
    const range = document.createRange();
    const out: Array<{ ch: string; top: number }> = [];
    for (let i = 0; i < text.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = range.getClientRects()[0];
      if (r && text[i]!.trim()) out.push({ ch: text[i]!, top: Math.round(r.top) });
    }
    const rows = new Map<number, string>();
    for (const c of out) rows.set(c.top, (rows.get(c.top) ?? '') + c.ch);
    return Array.from(rows.values());
  });
  for (const l of lines) expect(l, `a line of the boost card: ${lines.join(' / ')}`).not.toMatch(/^·|·$/);
  await page.screenshot({ path: `${dirOf(page)}/r4-daily.png` });
});

test('«Rebirth»: «Spend the coins…» seen without a scroll', async ({ page, openGame }) => {
  await start(page, openGame);
  await more(page, 'rebirth');
  // On the phone the advice is the subtitle of the window: in sight as it opens, whatever the middle scrolls.
  const hint = page.locator('[data-role="window"].open [data-role="win-sub"]');
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText(/Потрать монеты|Spend/);
  const box = (await hint.boundingBox())!;
  expect(box.y + box.height, 'inside the screen').toBeLessThanOrEqual(page.viewportSize()!.height);
  // The columns below it start in sight: their heads are seen whole.
  const heads = await page.locator('[data-role="window"].open .rb-head').evaluateAll((els) => {
    const b = els[0]!.closest('.win-body')!.getBoundingClientRect();
    return els.map((e) => e.getBoundingClientRect()).every((r) => r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5);
  });
  expect(heads, 'the heads of the columns seen').toBe(true);
  await page.screenshot({ path: `${dirOf(page)}/r4-rebirth.png` });
});

test('«Gifts»: Telegram and VK with their words, not cut', async ({ page, openGame }) => {
  await start(page, openGame);
  await tap(page, 'gift');
  await expect(page.locator('[data-role="window"].open')).toHaveCount(1);
  await page.waitForTimeout(300);
  const btns = page.locator('[data-role="window"].open [data-hud^="gift-visit-"]');
  expect(await btns.count()).toBe(2);
  for (const b of await btns.all()) {
    const r = await b.evaluate((e) => ({ text: (e.textContent ?? '').trim(), fits: e.scrollWidth <= e.clientWidth + 1, h: e.getBoundingClientRect().height }));
    expect(r.text, 'the word on the button').toMatch(/Telegram|ВКонтакте|VK/);
    expect(r.fits, `${r.text} fits`).toBe(true);
    expect(r.h).toBeGreaterThan(0);
  }
  await page.screenshot({ path: `${dirOf(page)}/r4-gifts.png` });
});

test('squeezed by the banner (−160 px): «Mountain N · stage» stays on top between the moments of the strip', async ({ page, openGame }) => {
  await start(page, openGame);
  const { width, height } = page.viewportSize()!;
  const dir = dirOf(page);
  await page.evaluate((z) => window.__TEST__!.teleport(z), STAGES[0]!.stages[2]!.start + 20);
  await page.setViewportSize({ width: width - 160, height });
  await waitTicks(page, 10);
  await page.waitForFunction(() => document.querySelector('.hud')?.classList.contains('strip-off') ?? false, undefined, { timeout: 10_000 });
  await page.waitForTimeout(500);
  const label = page.locator('.hud-mountain-label');
  await expect(label).toHaveText(/Гора \d+ · этап|Mountain \d+ · stage/);
  const box = await label.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, opacity: Number(getComputedStyle(e.parentElement!).opacity) };
  });
  expect(box.opacity, 'the label seen').toBe(1);
  expect(box.top, 'on top of the frame').toBeGreaterThanOrEqual(0);
  // The slot of the messages under it, not over it.
  const slot = await page.evaluate(() => {
    const e = Array.from(document.querySelectorAll<HTMLElement>('.hud-hint, .hud-need, .hud-tutor, .hud-wave, .hud-toast')).find((x) => x.getBoundingClientRect().height > 0 && getComputedStyle(x).visibility !== 'hidden' && getComputedStyle(x).opacity !== '0');
    return e ? e.getBoundingClientRect().top : null;
  });
  if (slot !== null) expect(slot, 'the slot under the label').toBeGreaterThanOrEqual(box.bottom);
  await page.screenshot({ path: `${dir}/r4-squeezed-${width - 160}.png` });
  // The full frame: the label hides between the moments as before (MU round 3).
  await page.setViewportSize({ width, height });
  await waitTicks(page, 10);
  if (width >= 760) await expect.poll(() => page.locator('.hud-mountain').evaluate((e) => Number(getComputedStyle(e).opacity))).toBe(0);
});
