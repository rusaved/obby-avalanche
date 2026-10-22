import { test, expect } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { threshold } from './lv-stage-data.ts';
import { mkdirSync } from 'node:fs';

// M4-R3 (rest of MU, Q-MU-18 Б, producer 22.10): in a scrolling list with no button in its rows the top of the next row
// peeks under the edge (up to 16 px) — the sign the list scrolls; a card with a button is seen whole or not at all. Every
// window and tab walked; on the truthful profile (880 × 405, 915 × 412, 815 × 290).

const LISTS = '.win-grid, .foot-grid, .qs-list, .gf-cards, .gf-tiles, .dl-cards, .tr-grid, .rb-cols, .pause-grid, .more-grid, .tp-list';

async function tap(page: Page, hud: string): Promise<void> {
  const b = page.locator(`[data-hud="${hud}"]`).first();
  await b.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
  await b.dispatchEvent('click', { detail: 1 });
}

type Cut = { text: string; plain: boolean; seen: number };
/** Items of the lists of the open window cut by the lower edge of the middle: how much of each is seen. */
async function cutRows(page: Page): Promise<{ scrolls: boolean; cut: Cut[]; plainBelow: boolean }> {
  return page.evaluate((lists) => {
    const body = document.querySelector<HTMLElement>('[data-role="window"].open .win-body')!;
    const b = body.getBoundingClientRect();
    const cut: Cut[] = [];
    let plainBelow = false;
    for (const u of Array.from(body.querySelectorAll<HTMLElement>(`:scope :is(${lists}) > *`))) {
      if (u.matches(lists)) continue;
      const r = u.getBoundingClientRect();
      if (r.height === 0) continue;
      const plain = !u.matches('button, input, select') && !u.querySelector('button, input, select');
      if (r.top >= b.bottom - 0.5 && plain) plainBelow = true;
      if (r.top < b.bottom - 0.5 && r.bottom > b.bottom + 0.5) cut.push({ text: (u.textContent ?? '').trim().slice(0, 24), plain, seen: Math.round(b.bottom - r.top) });
    }
    return { scrolls: body.scrollHeight - body.clientHeight > 1, cut, plainBelow };
  }, LISTS);
}

test('Q-MU-18 Б: the next plain row peeks ≤ 16 px, a card with a button is never cut', async ({ page, openGame }) => {
  test.setTimeout(300_000);
  await openGame('pace=stages&mock_fullscreen=deny');
  const { width, height } = page.viewportSize()!;
  await page.evaluate((s) => {
    const t = window.__TEST__!;
    t.setPlaySec(400);
    t.setCoins(5300);
    t.setTrophies(3);
    t.holdWave(900);
    t.setStat(s);
    for (const id of ['penguin', 'bunny', 'seal', 'fox', 'owl', 'bullfinch']) t.givePet(id);
  }, threshold(30));
  await page.touchscreen.tap(width / 2, height / 2);
  await page.waitForTimeout(300);
  const hud = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.hud [data-hud]'))
      .filter((e) => e.offsetParent !== null && /^(gift|pause|menu-.+)$/.test(e.dataset['hud']!))
      .map((e) => e.dataset['hud']!),
  );
  const openers: Array<{ name: string; open: () => Promise<void> }> = hud.map((id) => ({ name: id, open: () => tap(page, id) }));
  await tap(page, 'menu-more');
  const more = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-role="window"].open [data-hud^="more-"]')).map((e) => e.dataset['hud']!));
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
  for (const id of more) openers.push({ name: id, open: async () => { await tap(page, 'menu-more'); await page.locator(`[data-hud="${id}"]`).click(); } });
  const peeks: string[] = [];
  for (const { name, open } of openers) {
    await open();
    await expect(page.locator('[data-role="window"].open'), name).toHaveCount(1);
    const tabs = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-role="window"].open .win-tabs [data-hud]')).map((e) => e.dataset['hud']!));
    for (const tab of tabs.length ? tabs : [null]) {
      if (tab) await page.locator(`[data-role="window"].open [data-hud="${tab}"]`).click();
      await page.waitForTimeout(250);
      const label = `${name}${tab ? ` · ${tab}` : ''} at ${width}×${height}`;
      const { scrolls, cut, plainBelow } = await cutRows(page);
      for (const c of cut) {
        expect(c.plain, `${label}: a card with a button cut (${c.text})`).toBe(true);
        expect(c.seen, `${label}: the peek of «${c.text}»`).toBeLessThanOrEqual(16);
      }
      if (cut.length) peeks.push(label);
      if (cut.length && tab === 'shop-tab-shoes') {
        const dir = `docs/evidence/M4/${width}x${height}`;
        mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: `${dir}/peek-shoes.png` });
      }
      // A scrolling list whose next row is plain: its top peeks (unless the room is all taken by whole rows).
      if (scrolls && plainBelow && !cut.length) console.log(`no peek: ${label}`);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
  }
  console.log(`peeks: ${peeks.join('; ')}`);
  // «Shop → Sneakers» (rows of locked pairs have no button) scrolls on the phone and peeks.
  expect(peeks.some((p) => p.startsWith('menu-shop · shop-tab-shoes')), peeks.join('; ')).toBe(true);
});
