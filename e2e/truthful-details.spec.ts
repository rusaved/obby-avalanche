import { test, expect, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { scaleText } from './mu-checks.ts';
import { STAGES, threshold } from './lv-stage-data.ts';

// MU round 3, item 7 (staff 19.10, the small ones), on the truthful profile (915 × 412 and 815 × 290): one look of the
// cards of a set of steps in «Footsteps» and «Shop → Steps» (D50); the marks of the buttons on the middle of their words
// (D5); «Rate» a live button ≥ 4.5:1 and «Boost ×2 · 3 min» without the minutes twice (D19, D26); the tiles of «More» keep
// 8 px around their words at 130 % (D38); no stub of the ridge post under its plaque (A58).

async function tap(page: Page, hud: string): Promise<void> {
  const b = page.locator(`[data-hud="${hud}"]`).first();
  await b.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
  await b.dispatchEvent('click', { detail: 1 });
}
async function close(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
}
async function start(page: Page, openGame: (q?: string) => Promise<void>, level = 30): Promise<void> {
  await openGame('pace=stages&mock_fullscreen=deny');
  const { width, height } = page.viewportSize()!;
  await page.evaluate((s) => {
    const t = window.__TEST__!;
    t.setPlaySec(400);
    t.setCoins(5300);
    t.setTrophies(3);
    t.holdWave(900);
    t.setStat(s);
  }, threshold(level));
  await page.touchscreen.tap(width / 2, height / 2);
}

/** Per set of steps: what the bottom of its card shows — «chosen», «lock», «button» — and the size of the lock line. */
const stepCards = (page: Page, sel: string): Promise<Record<string, { parts: string; lockPx: string }>> =>
  page.evaluate((s) => {
    const out: Record<string, { parts: string; lockPx: string }> = {};
    for (const c of Array.from(document.querySelectorAll(s))) {
      const id = (c as HTMLElement).dataset['footsteps'] ?? (c as HTMLElement).dataset['item'] ?? '';
      const end = c.querySelector('.foot-end');
      const parts = end ? Array.from(end.children).map((e) => (e.classList.contains('foot-chosen') ? (e.querySelector('svg') ? 'chosen✓' : 'chosen') : e.classList.contains('foot-lock') ? 'lock' : e.tagName === 'BUTTON' ? 'button' : e.className)).join('+') : 'none';
      const lock = end?.querySelector('.foot-lock span:last-child') as HTMLElement | null;
      out[id] = { parts, lockPx: lock ? `${getComputedStyle(lock).fontSize}/${getComputedStyle(lock).fontWeight}` : '' };
    }
    return out;
  }, sel);

test('D50: a set of steps looks the same in «Footsteps» and in «Shop → Steps»', async ({ page, openGame }) => {
  await start(page, openGame);
  await tap(page, 'menu-more');
  await page.locator('[data-hud="more-footsteps"]').click();
  const foot = await stepCards(page, '[data-role="window"].open [data-role="footsteps-grid"] .foot-card');
  await close(page);
  await tap(page, 'menu-shop');
  await page.locator('[data-hud="shop-tab-steps"]').click();
  const shop = await stepCards(page, '[data-role="window"].open [data-role="shop-grid"] .foot-card');
  expect(Object.keys(shop).sort()).toEqual(Object.keys(foot).sort());
  for (const id of Object.keys(foot)) {
    // The same parts but the button itself: «To the shop» there is «Buy» here.
    expect(shop[id]!.parts, id).toBe(foot[id]!.parts);
    expect(shop[id]!.lockPx, id).toBe(foot[id]!.lockPx);
  }
  expect(Object.values(shop).some((c) => c.parts === 'chosen✓')).toBe(true);
  const { width, height } = page.viewportSize()!;
  await page.screenshot({ path: `docs/evidence/MU/r4/${width}x${height}/w-shop-steps.png` });
});

test('D5, D19, D26: marks on the middle of their words; «Rate» live ≥ 4.5:1; «Boost ×2 · 3 min» once', async ({ page, openGame }) => {
  await start(page, openGame);
  for (const id of ['gift', 'pause']) {
    await tap(page, id);
    await expect(page.locator('[data-role="window"].open')).toHaveCount(1);
    await page.waitForTimeout(300);
    const off = await page.evaluate(() => {
      const out: string[] = [];
      for (const b of Array.from(document.querySelectorAll('[data-role="window"].open button'))) {
        // MU round 5: a mark hidden on the low frame (the group buttons of «Gifts» keep only their words) is no mark.
        const svg = Array.from(b.querySelectorAll('svg')).find((x) => x.getBoundingClientRect().width > 0);
        const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
        let txt: Node | null = null;
        for (let n = w.nextNode(); n; n = w.nextNode()) if ((n.textContent ?? '').trim()) {
          txt = n;
          break;
        }
        if (!svg || !txt || (b as HTMLElement).offsetWidth === 0) continue;
        const r = document.createRange();
        r.selectNodeContents(txt);
        const tr = r.getBoundingClientRect();
        const sr = svg.getBoundingClientRect();
        const d = (sr.top + sr.bottom) / 2 - (tr.top + tr.bottom) / 2;
        if (Math.abs(d) > 1.5) out.push(`${(txt.textContent ?? '').trim()}: ${d.toFixed(1)} px`);
      }
      return out;
    });
    expect(off, `${id}: marks off the middle of their words`).toEqual([]);
    if (id === 'gift') {
      const rate = page.locator('[data-hud="gift-review"]');
      await expect(rate).toBeEnabled();
      const contrast = await rate.evaluate((b) => {
        const rgb = (c: string): number[] => (c.match(/[\d.]+/g) ?? []).map(Number);
        const lum = (c: number[]): number => {
          const f = (v: number): number => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
          return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
        };
        const panel = rgb(getComputedStyle(b.closest('.win-panel')!).backgroundColor);
        const bg = rgb(getComputedStyle(b).backgroundColor);
        const a = bg[3] ?? 1;
        const under = [0, 1, 2].map((i) => bg[i]! * a + panel[i]! * (1 - a));
        const fg = rgb(getComputedStyle(b).color);
        const [l1, l2] = [lum(fg), lum(under)].sort((x, y) => y - x);
        return (l1! + 0.05) / (l2! + 0.05);
      });
      expect(contrast, '«Rate» contrast').toBeGreaterThanOrEqual(4.5);
      const boost = await page.evaluate(() => {
        const tile = Array.from(document.querySelectorAll('[data-role="gift-tiles"] .gf-tile')).find((x) => /Буст/.test(x.textContent ?? ''))!;
        return { name: tile.querySelector('.card-name')!.textContent ?? '', sub: tile.querySelector('.card-sub')!.textContent ?? '' };
      });
      expect(boost.name).toMatch(/^Буст ×2\s·\s\d+\sмин$/);
      expect(boost.sub, 'the minutes once').not.toMatch(/мин/);
      // Round 3 (usability review): the gift of the HUD lights «Take» only with a tile to take (no wheel on the phone).
      const ready = await page.locator('[data-role="gift-tiles"] [data-hud="gift-claim"]').count();
      await close(page);
      const plaque = (await page.locator('[data-hud="gift"]').textContent()) ?? '';
      if (ready === 0) expect(plaque, 'a timer, nothing to take').toMatch(/\d+:\d\d/);
      continue;
    }
    await close(page);
  }
});

test('D38: the tiles of «More» keep 8 px around their words at 130 %', async ({ page, openGame }) => {
  await start(page, openGame);
  await tap(page, 'menu-more');
  await expect(page.locator('[data-role="window"].open')).toHaveCount(1);
  for (const k of [1, 1.3]) {
    await scaleText(page, k);
    await page.waitForTimeout(250);
    const tight = await page.evaluate(() => {
      const out: string[] = [];
      for (const b of Array.from(document.querySelectorAll('[data-role="window"].open .more-btn'))) {
        const r = b.getBoundingClientRect();
        const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          if (!(n.textContent ?? '').trim()) continue;
          const g = document.createRange();
          g.selectNodeContents(n);
          const t = g.getBoundingClientRect();
          if (t.left - r.left < 7.5 || r.right - t.right < 7.5) out.push(`${(n.textContent ?? '').trim()} ${Math.round(t.left - r.left)}/${Math.round(r.right - t.right)}`);
        }
      }
      return out;
    });
    expect(tight, `at ${k}`).toEqual([]);
  }
  const { width, height } = page.viewportSize()!;
  await page.screenshot({ path: `docs/evidence/MU/r4/${width}x${height}/w-more-130.png` });
  await scaleText(page, 1);
});

test('A58: no stub of the ridge post under its plaque', async ({ page, openGame }) => {
  await start(page, openGame, 5);
  const st4 = STAGES[0]!.stages[5]!; // ST-02: the ridge of stage 6 — past the flat avalanche stage (stage 3 is the giant's)
  await page.evaluate(([s, z]) => {
    window.__TEST__!.setStat(s);
    window.__TEST__!.teleport(z);
  }, [threshold(st4.level - 3), st4.z0 - 5] as const);
  await waitTicks(page, 30);
  await expect(page.locator('[data-role="toast"].shown')).toHaveCount(0, { timeout: 10_000 });
  const sign = page.locator('[data-role="gate-sign"].shown');
  await expect(sign).toBeVisible({ timeout: 10_000 });
  // Round 3 (reviews: at 815 × 290 the board hid under the slot while the strip was out): seen as the ridge comes too.
  await page.evaluate((z) => window.__TEST__!.teleport(z), st4.z0 - 40);
  await waitTicks(page, 10);
  await page.evaluate((z) => window.__TEST__!.botPath([[0, z]]), st4.z0 - 5);
  await expect(page.locator('[data-role="need"]')).toBeVisible({ timeout: 10_000 });
  await expect(sign, 'the board while the strip is out').toBeVisible({ timeout: 1_500 });
  await page.waitForFunction(() => window.__TEST__!.botLeft() === 0, undefined, { timeout: 10_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await expect(page.locator('[data-role="toast"].shown')).toHaveCount(0, { timeout: 10_000 });
  await expect(sign).toBeVisible();
  const r = (await sign.boundingBox())!;
  // Under the plaque, a strip as wide as it and 12 px down: no pixel of the post colour (#7A5A3A, lit or shaded).
  const brown = await page.evaluate(([x0, x1, y0]) => {
    let n = 0;
    for (let x = Math.round(x0); x <= x1; x += 2)
      for (let y = Math.round(y0); y < y0 + 12; y += 2) {
        const [r0, g0, b0] = window.__TEST__!.pixelAt(x, y);
        if (r0! > g0! + 15 && g0! > b0! + 10 && r0! < 200) n++;
      }
    return n;
  }, [r.x, r.x + r.width, r.y + r.height + 1] as const);
  expect(brown, 'brown pixels of a post under the plaque').toBe(0);
  const { width, height } = page.viewportSize()!;
  await page.screenshot({ path: `docs/evidence/MU/r4/${width}x${height}/l2-gate.png` });
});
