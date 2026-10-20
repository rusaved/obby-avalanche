import { test, expect } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { scaleText } from './mu-checks.ts';
import { threshold } from './lv-stage-data.ts';

// MU round 3, item 2 (staff and producer 19.10: windows by their content). On the truthful profile (915 × 412 and
// 815 × 290), at 100 % and 130 % text: a panel is as tall as its content up to the visible height minus 16 px a side;
// the scrolling middle ends where it cuts no button and no line of text, snaps by rows, and shows its scroll by a bar
// and a chevron 16 in a circle 28 in a column of its own (never over the content); «For all three» of «Quests» is seen
// without scrolling; «Shop → Sneakers» shows its first row whole and the second one at least by its edge.

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
  ['shop', async (p) => { await tap(p, 'menu-shop'); await p.locator('[data-hud="shop-tab-shoes"]').click(); }],
  ['shop-steps', async (p) => { await tap(p, 'menu-shop'); await p.locator('[data-hud="shop-tab-steps"]').click(); }],
  ['pets', (p) => tap(p, 'menu-pets')],
  ['footsteps', more('footsteps')],
  ['wardrobe', more('wardrobe')],
  ['rebirth', more('rebirth')],
  ['records', more('records')],
  ['quests', more('quests')],
  ['daily', more('daily')],
];

/** What is wrong with the open window: the panel out of its margins, a control or a line cut by the edge of the middle,
 * the rail missing or over the content. */
async function windowProblems(page: Page, height: number): Promise<string[]> {
  return page.evaluate((H) => {
    const out: string[] = [];
    const dim = document.querySelector('[data-role="window"].open')!;
    const panel = dim.querySelector('.win-panel')!.getBoundingClientRect();
    if (panel.top < 16 - 0.5 || panel.bottom > H - 16 + 0.5) out.push(`panel ${Math.round(panel.top)}–${Math.round(panel.bottom)} out of 16 px margins`);
    const body = dim.querySelector<HTMLElement>('.win-body')!;
    const b = body.getBoundingClientRect();
    const visible = (r: DOMRect): boolean => r.width > 0 && r.height > 0;
    for (const c of Array.from(dim.querySelectorAll<HTMLElement>('button, input, select'))) {
      const r = c.getBoundingClientRect();
      if (!visible(r)) continue;
      const name = (c.textContent || c.dataset['hud'] || c.className).trim().slice(0, 24);
      if (body.contains(c)) {
        // Scrolled out of the middle — hidden, not cut.
        if (r.bottom <= b.top + 0.5 || r.top >= b.bottom - 0.5) continue;
        if (r.top < b.bottom - 0.5 && r.bottom > b.bottom + 0.5) out.push(`control cut by the edge: ${name}`);
      } else if (r.top < panel.top - 0.5 || r.bottom > panel.bottom + 0.5) out.push(`control out of the panel: ${name}`);
    }
    const range = document.createRange();
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!(n.textContent ?? '').trim()) continue;
      range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) {
        if (r.height > 0 && r.top < b.bottom - 0.5 && r.bottom > b.bottom + 0.5) out.push(`line cut by the edge: ${(n.textContent ?? '').trim().slice(0, 24)}`);
      }
    }
    const scrolls = body.scrollHeight - body.clientHeight > 1;
    const rail = dim.querySelector<HTMLElement>('[data-role="win-rail"]')!;
    if (scrolls) {
      const rr = rail.getBoundingClientRect();
      if (rail.hidden || !visible(rr)) out.push('scrolls without the rail');
      // Sizes by layout (the chevron turns up at the end of the list).
      const cueEl = dim.querySelector<HTMLElement>('[data-role="win-cue"]')!;
      const svg = cueEl.querySelector('svg')!;
      if (Math.abs(cueEl.offsetWidth - 28) > 1 || Math.abs(cueEl.offsetHeight - 28) > 1 || Math.abs(svg.clientWidth - 16) > 1) out.push(`cue ${cueEl.offsetWidth}×${cueEl.offsetHeight}, chevron ${svg.clientWidth}`);
      if (rr.bottom > b.bottom + 0.5 || rr.top < b.top - 0.5) out.push('rail off the middle');
      // Nothing of the content under the rail.
      for (const e of Array.from(body.querySelectorAll('*'))) {
        const r = e.getBoundingClientRect();
        if (!visible(r) || r.bottom <= b.top || r.top >= b.bottom) continue;
        if (r.right > rr.left + 0.5 && r.left < rr.right - 0.5) {
          out.push(`content under the rail: ${e.className}`);
          break;
        }
      }
    } else if (!rail.hidden) out.push('the rail without a scroll');
    return out;
  }, height);
}

for (const k of [1, 1.3]) {
  test(`every window at ${Math.round(k * 100)} %: by its content, no control or line cut, the rail shows the scroll`, async ({ page, openGame }) => {
    test.setTimeout(240_000);
    await openGame('pace=stages&mock_fullscreen=deny');
    const { width, height } = page.viewportSize()!;
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
    for (const [id, open] of WINDOWS) {
      await open(page);
      await expect(page.locator('[data-role="window"].open'), id).toHaveCount(1);
      if (k > 1) await scaleText(page, k);
      await page.waitForTimeout(250);
      expect(await windowProblems(page, height), `${id} at ${width}×${height}`).toEqual([]);
      // Scrolled to its end: still nothing cut.
      await page.evaluate(() => {
        const b = document.querySelector<HTMLElement>('[data-role="window"].open .win-body')!;
        b.scrollTop = b.scrollHeight;
      });
      await page.waitForTimeout(250);
      for (const p of await windowProblems(page, height)) expect(p, `${id} scrolled`).not.toMatch(/control|panel|rail/);
      if (k === 1 && ['gifts', 'quests', 'shop', 'daily', 'rebirth'].includes(id)) await page.evaluate(() => document.querySelector<HTMLElement>('[data-role="window"].open .win-body')!.scrollTo(0, 0));
      if (k === 1 && ['gifts', 'quests', 'shop', 'daily', 'rebirth'].includes(id)) {
        await page.waitForTimeout(250);
        await page.screenshot({ path: `docs/evidence/MU/r3/${width}x${height}/w-${id}.png` });
      }
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
      if (k > 1) await scaleText(page, 1);
    }
  });
}

test('«Quests»: «For all three» without scrolling; «Shop → Sneakers»: the first row whole, the second by its edge', async ({ page, openGame }) => {
  await openGame('pace=stages&mock_fullscreen=deny');
  const { width, height } = page.viewportSize()!;
  await page.evaluate((st) => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.setCoins(5300);
    window.__TEST__!.holdWave(900);
    window.__TEST__!.setStat(st);
  }, threshold(30));
  await page.touchscreen.tap(width / 2, height / 2);
  for (const k of [1, 1.3]) {
    await more('quests')(page);
    if (k > 1) await scaleText(page, k);
    await page.waitForTimeout(250);
    const seen = await page.evaluate(() => {
      const dim = document.querySelector('[data-role="window"].open')!;
      const p = dim.querySelector('.win-panel')!.getBoundingClientRect();
      const r = dim.querySelector('[data-role="quest-bonus"]')!.getBoundingClientRect();
      return r.height > 0 && r.top >= p.top && r.bottom <= p.bottom + 0.5 && !dim.querySelector('.win-body')!.contains(dim.querySelector('[data-role="quest-bonus"]'));
    });
    expect(seen, `«For all three» at ${k}`).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
    if (k > 1) await scaleText(page, 1);
  }
  await tap(page, 'menu-shop');
  await page.locator('[data-hud="shop-tab-shoes"]').click();
  await page.waitForTimeout(250);
  const rows = await page.evaluate(() => {
    const body = document.querySelector('[data-role="window"].open .win-body')!.getBoundingClientRect();
    const tops = Array.from(new Set(Array.from(document.querySelectorAll('[data-role="window"].open [data-role="shop-grid"] .card')).map((c) => Math.round(c.getBoundingClientRect().top)))).sort((a, b) => a - b);
    const first = Array.from(document.querySelectorAll('[data-role="window"].open [data-role="shop-grid"] .card')).filter((c) => Math.round(c.getBoundingClientRect().top) === tops[0]).map((c) => c.getBoundingClientRect().bottom);
    return { bottom: body.bottom, firstBottom: Math.max(...first), second: tops[1] ?? Infinity };
  });
  expect(rows.firstBottom, 'the first row whole').toBeLessThanOrEqual(rows.bottom + 0.5);
  expect(rows.second, 'the second row seen at least by its edge').toBeLessThan(rows.bottom - 1);
});

test('the sets of steps («Shop → Steps», «Footsteps») show their first row whole; «Take» of «Calendar» in sight at 130 %', async ({ page, openGame }) => {
  await openGame('pace=stages&mock_fullscreen=deny');
  const { width, height } = page.viewportSize()!;
  await page.evaluate((st) => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.setCoins(5300);
    window.__TEST__!.setTrophies(3);
    window.__TEST__!.holdWave(900);
    window.__TEST__!.setStat(st);
  }, threshold(30));
  await page.touchscreen.tap(width / 2, height / 2);
  const firstRow = (): Promise<{ bottom: number; rowBottom: number; buttons: number }> =>
    page.evaluate(() => {
      const body = document.querySelector('[data-role="window"].open .win-body')!.getBoundingClientRect();
      const cards = Array.from(document.querySelectorAll('[data-role="window"].open .foot-card'));
      const top = Math.min(...cards.map((c) => Math.round(c.getBoundingClientRect().top)));
      const row = cards.filter((c) => Math.round(c.getBoundingClientRect().top) === top);
      return { bottom: body.bottom, rowBottom: Math.max(...row.map((c) => c.getBoundingClientRect().bottom)), buttons: row.filter((c) => c.querySelector('button.card-btn, .foot-chosen')).length };
    });
  for (const open of [
    async () => {
      await tap(page, 'menu-shop');
      await page.locator('[data-hud="shop-tab-steps"]').click();
    },
    () => more('footsteps')(page),
  ]) {
    await open();
    await page.waitForTimeout(300);
    const r = await firstRow();
    expect(r.rowBottom, 'the first row of sets whole').toBeLessThanOrEqual(r.bottom + 0.5);
    expect(r.buttons).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
  }
  for (const k of [1, 1.3]) {
    await more('daily')(page);
    if (k > 1) await scaleText(page, k);
    await page.waitForTimeout(300);
    const take = await page.evaluate(() => {
      const b = document.querySelector('[data-hud="daily-claim"]');
      const body = document.querySelector('[data-role="window"].open .win-body')!;
      if (!b) return null;
      const r = b.getBoundingClientRect();
      const p = document.querySelector('[data-role="window"].open .win-panel')!.getBoundingClientRect();
      const inBody = body.contains(b);
      const v = body.getBoundingClientRect();
      return { whole: r.top >= p.top && r.bottom <= p.bottom + 0.5 && (!inBody || (r.top >= v.top && r.bottom <= v.bottom + 0.5)) };
    });
    if (take) expect(take.whole, `«Take» of the calendar in sight at ${k}`).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
    if (k > 1) await scaleText(page, 1);
  }
});

test('the middle snaps by rows: after a scroll the top of the list stands on a row', async ({ page, openGame }) => {
  await openGame('pace=stages&mock_fullscreen=deny');
  const { width, height } = page.viewportSize()!;
  await page.evaluate(() => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.holdWave(900);
  });
  await page.touchscreen.tap(width / 2, height / 2);
  await tap(page, 'menu-shop');
  await page.locator('[data-hud="shop-tab-shoes"]').click();
  await page.waitForTimeout(250);
  const body = page.locator('[data-role="window"].open .win-body');
  const box = (await body.boundingBox())!;
  // A wheel 15 px short of the next row: the list comes to rest on that row, not between rows.
  const pitch = await page.evaluate(() => {
    const tops = Array.from(new Set(Array.from(document.querySelectorAll('[data-role="window"].open [data-role="shop-grid"] .card')).map((c) => Math.round(c.getBoundingClientRect().top)))).sort((a, b) => a - b);
    return tops[1]! - tops[0]!;
  });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 20);
  await page.mouse.wheel(0, pitch - 15);
  await page.waitForTimeout(800);
  const offset = await page.evaluate(() => {
    const b = document.querySelector<HTMLElement>('[data-role="window"].open .win-body')!;
    const tabs = b.querySelector<HTMLElement>(':scope > .win-tabs');
    const top = b.getBoundingClientRect().top + (tabs ? tabs.offsetHeight : 0);
    const cards = Array.from(b.querySelectorAll('[data-role="shop-grid"] .card')).map((c) => c.getBoundingClientRect().top - top);
    return { scroll: b.scrollTop, nearest: Math.min(...cards.map((d) => Math.abs(d))) };
  });
  expect(offset.scroll, 'it scrolled').toBeGreaterThan(0);
  expect(offset.nearest, 'a row under the tabs').toBeLessThanOrEqual(2);
});
