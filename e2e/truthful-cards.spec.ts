import { test, expect } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { scaleText } from './mu-checks.ts';
import { threshold } from './lv-stage-data.ts';

// MU round 4, item 3 (producer 20.10 at 880 × 405: no «Release» in «Pets», no «Buy» in «Shop → Eggs»; at 815 and 915
// «Gifts», «Sneakers», «Rebirth», «Quests», «Steps» cut, at 130 % «Calendar»). The rule of every window and tab: a card
// is seen whole with its button or not at all — the button of every card seen in the middle is inside its visible part.
// The windows and tabs are not listed by hand: every HUD button that opens a window, every entry of «More» and every tab
// of an open window are walked; a window longer than the screen stands at least as tall as the screen − 32 (round 5). On the truthful profile (880 × 405, 915 × 412, 815 × 290), at 100 % and 130 % text.

const LISTS = '.win-grid, .foot-grid, .qs-list, .gf-cards, .gf-tiles, .dl-cards, .tr-grid, .rb-cols, .pause-grid, .more-grid, .tp-list';

async function tap(page: Page, hud: string): Promise<void> {
  const b = page.locator(`[data-hud="${hud}"]`).first();
  await b.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
  await b.dispatchEvent('click', { detail: 1 });
}

/** Cards of the open window seen in the middle with a control out of its visible part, and controls out of the panel. */
async function cardProblems(page: Page): Promise<string[]> {
  return page.evaluate((lists) => {
    const out: string[] = [];
    const dim = document.querySelector('[data-role="window"].open')!;
    const panel = dim.querySelector('.win-panel')!.getBoundingClientRect();
    const body = dim.querySelector<HTMLElement>('.win-body')!;
    const b = body.getBoundingClientRect();
    const tabs = body.querySelector<HTMLElement>(':scope > .win-tabs');
    const top = b.top + (tabs && body.scrollTop > 0 ? tabs.offsetHeight : 0);
    const controls = (e: Element): HTMLElement[] => Array.from(e.querySelectorAll<HTMLElement>('button, input, select')).filter((c) => c.getBoundingClientRect().height > 0);
    for (const u of Array.from(body.querySelectorAll<HTMLElement>(`:scope > *, :scope :is(${lists}) > *`))) {
      if (u.matches(`:is(${lists})`) || u.querySelector(`:is(${lists})`) || u.matches('.win-tabs')) continue;
      const r = u.getBoundingClientRect();
      if (r.height === 0 || r.bottom <= top + 0.5 || r.top >= b.bottom - 0.5) continue;
      for (const c of controls(u)) {
        const k = c.getBoundingClientRect();
        if (k.top < top - 0.5 || k.bottom > b.bottom + 0.5) out.push(`button of a seen card out of sight: ${(u.textContent ?? '').trim().slice(0, 28)} / ${(c.textContent || c.dataset['hud'] || '').trim().slice(0, 16)}`);
      }
    }
    // MU round 5 (producer 21.10: a window in the middle with 40–90 px empty around it): a window longer than the screen
    // is at least the visible height minus 32 px.
    const seen = dim.getBoundingClientRect();
    if (body.scrollHeight - body.clientHeight > 1 && panel.height < seen.height - 32 - 0.5) out.push(`a scrolling window lower than the screen − 32: ${Math.round(panel.height)} of ${Math.round(seen.height)}`);
    for (const c of controls(dim)) {
      if (body.contains(c)) continue;
      const k = c.getBoundingClientRect();
      if (k.top < panel.top - 0.5 || k.bottom > panel.bottom + 0.5) out.push(`control out of the panel: ${(c.textContent || c.dataset['hud'] || '').trim().slice(0, 20)}`);
    }
    return out;
  }, LISTS);
}

/** Every way into a window: the HUD buttons of the right column and the column of tiles, then the entries of «More». */
async function openers(page: Page): Promise<Array<{ name: string; open: () => Promise<void> }>> {
  const hud = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.hud [data-hud]'))
      .filter((e) => e.offsetParent !== null && /^(gift|pause|menu-.+)$/.test(e.dataset['hud']!))
      .map((e) => e.dataset['hud']!),
  );
  const out: Array<{ name: string; open: () => Promise<void> }> = hud.map((id) => ({ name: id, open: () => tap(page, id) }));
  await tap(page, 'menu-more');
  await expect(page.locator('[data-role="window"].open')).toHaveCount(1);
  const more = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-role="window"].open [data-hud^="more-"]')).map((e) => e.dataset['hud']!));
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
  for (const id of more) {
    out.push({
      name: id,
      open: async () => {
        await tap(page, 'menu-more');
        await page.locator(`[data-hud="${id}"]`).click();
      },
    });
  }
  return out;
}

for (const k of [1, 1.3]) {
  test(`07: every window and every tab at ${Math.round(k * 100)} % — the button of every card seen is in sight`, async ({ page, openGame }) => {
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
    const seen: string[] = [];
    for (const { name, open } of await openers(page)) {
      await open();
      await expect(page.locator('[data-role="window"].open'), name).toHaveCount(1);
      // MU round 5, item 7 (producer 21.10): a simple mark by the title of every window; «Gift calendar»; a note to listen.
      await expect(page.locator('[data-role="window"].open .win-title .win-icon svg'), `${name}: the mark by the title`).toHaveCount(1);
      if (name === 'more-daily') await expect(page.locator('[data-role="window"].open .win-title')).toHaveText(/Календарь подарков|Gift calendar/);
      if (name === 'more-footsteps') expect(await page.locator('[data-role="window"].open .foot-play svg ellipse').count(), 'a note on «listen»').toBeGreaterThan(0);
      const tabs = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-role="window"].open .win-tabs [data-hud]')).map((e) => e.dataset['hud']!));
      for (const tab of tabs.length ? tabs : [null]) {
        if (tab) await page.locator(`[data-role="window"].open [data-hud="${tab}"]`).click();
        if (k > 1) await scaleText(page, k);
        await page.waitForTimeout(250);
        const label = `${name}${tab ? ` · ${tab}` : ''} at ${width}×${height}`;
        seen.push(label);
        expect(await cardProblems(page), label).toEqual([]);
      }
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
      if (k > 1) await scaleText(page, 1);
    }
    // The walk found the windows of the round (and their tabs).
    for (const must of ['gift', 'menu-shop · shop-tab-eggs', 'menu-pets', 'more-daily', 'more-quests', 'more-rebirth', 'more-footsteps']) {
      expect(seen.some((s) => s.startsWith(must)), `${must} walked`).toBe(true);
    }
  });
}
