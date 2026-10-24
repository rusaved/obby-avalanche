import { test, expect, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { STAGES, threshold } from './lv-stage-data.ts';
import { scaleText } from './mu-checks.ts';

// MU round 5, item 2 (producer 21.10): the shoes button — blue as «Buy» of the shop while the pair can be bought, the small
// «Sneakers» over it; quiet while short, a tap shakes it and toasts «Short of {coin} N»; squeezed by a banner — the sneaker
// on its short caption. Everything answers a tap: every off button of every window shakes and does nothing else.

const W = STAGES[0]!;
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
  await page.evaluate((s) => {
    const t = window.__TEST__!;
    t.setPlaySec(400);
    t.holdWave(900);
    t.setStat(s);
  }, threshold(3));
  await page.touchscreen.tap(width / 2, height / 2);
  await page.evaluate((z) => window.__TEST__!.teleport(z), W.stages[2]!.start + 20);
  await waitTicks(page, 20);
}

const look = (page: Page): Promise<{ bg: string; cap: string; capBottom: number; top: number; left: number; right: number; capL: number; capR: number; mark: boolean }> =>
  page.evaluate(() => {
    const b = document.querySelector<HTMLElement>('[data-hud="shoes"]')!;
    const cap = b.querySelector<HTMLElement>('.hud-shoes-cap')!;
    const r = b.getBoundingClientRect();
    const c = cap.getBoundingClientRect();
    return {
      bg: getComputedStyle(b).backgroundColor,
      cap: cap.textContent ?? '',
      capBottom: c.bottom,
      top: r.top,
      left: r.left,
      right: r.right,
      capL: c.left,
      capR: c.right,
      mark: !!b.querySelector('.hud-shoes-text .mark-sneaker'),
    };
  });

test('the shoes button: blue with «Sneakers» over it when it buys, quiet and shaking with «Short of N» when not', async ({ page, openGame }) => {
  await start(page, openGame);
  const dir = dirOf(page);
  const { width, height } = page.viewportSize()!;
  await page.evaluate(() => window.__TEST__!.setCoins(30));
  await waitTicks(page, 10);
  const can = await look(page);
  expect(can.bg, 'blue as «Buy»').toBe('rgb(26, 115, 217)');
  expect(can.cap).toBe('Кроссовки');
  expect(can.capBottom, 'the word over the button').toBeLessThanOrEqual(can.top + 0.5);
  expect(can.capL).toBeGreaterThanOrEqual(can.left - 40);
  expect(can.capR).toBeLessThanOrEqual(width - 16);
  await page.screenshot({ path: `${dir}/shoes-can.png` });
  await scaleText(page, 1.3);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/shoes-can-130.png` });
  await scaleText(page, 1);

  await page.evaluate(() => window.__TEST__!.setCoins(10));
  await waitTicks(page, 10);
  const no = await look(page);
  expect(no.bg, 'a quiet plaque').not.toBe('rgb(26, 115, 217)');
  await page.screenshot({ path: `${dir}/shoes-short.png` });
  await tap(page, 'shoes');
  await page.waitForTimeout(120);
  expect(await page.locator('[data-hud="shoes"]').evaluate((e) => e.classList.contains('nudge')), 'shakes').toBe(true);
  await expect(page.locator('[data-role="toast"]')).toHaveText(/Не хватает\s+20/);
  await page.screenshot({ path: `${dir}/shoes-tap.png` });
  expect((await window_(page)).coins, 'nothing bought').toBe(10);

  // Squeezed by a sticky banner: the short caption carries the sneaker, no word over it.
  await page.evaluate(() => window.__TEST__!.setCoins(30));
  await page.setViewportSize({ width: width - 160, height });
  await waitTicks(page, 10);
  const short = await look(page);
  if (await page.locator('[data-hud="shoes"]').evaluate((e) => e.classList.contains('short'))) {
    expect(short.mark, 'the sneaker on the short caption').toBe(true);
    expect(short.cap).toBe('');
  }
  await page.screenshot({ path: `${dir}/shoes-squeezed.png` });
});

const window_ = (page: Page): Promise<{ coins: number }> => page.evaluate(() => ({ coins: window.__TEST__!.state().coins }));

test('every off button of every window answers a tap with a shake and does nothing else', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  await openGame('pace=stages&mock_fullscreen=deny');
  const { width, height } = page.viewportSize()!;
  await page.evaluate(() => {
    const t = window.__TEST__!;
    t.setPlaySec(400);
    t.setCoins(5);
    t.setTrophies(1);
    t.holdWave(900);
  });
  await page.touchscreen.tap(width / 2, height / 2);
  await page.waitForTimeout(300);
  const hud = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.hud [data-hud]'))
      // «Gifts» has no «not yet» button (its ad is busy only while it plays) and its plaque comes and goes with the timer.
      .filter((e) => e.offsetParent !== null && /^(pause|menu-.+)$/.test(e.dataset['hud']!))
      .map((e) => e.dataset['hud']!),
  );
  await tap(page, 'menu-more');
  const more = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-role="window"].open [data-hud^="more-"]')).map((e) => e.dataset['hud']!));
  await page.keyboard.press('Escape');
  // Esc is taken on the next frame: a tap before it would open a window the Esc then closes.
  await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
  const ways: Array<[string, () => Promise<void>]> = [
    ...hud.map((id): [string, () => Promise<void>] => [id, () => tap(page, id)]),
    ...more.map((id): [string, () => Promise<void>] => [id, async () => { await tap(page, 'menu-more'); await page.locator(`[data-hud="${id}"]`).click(); }]),
  ];
  let answered = 0;
  for (const [name, open] of ways) {
    await open();
    // A tap right after the last window closed may land in its fade: once more.
    if ((await page.locator('[data-role="window"].open').count()) === 0) {
      await page.waitForTimeout(400);
      await open();
    }
    await expect(page.locator('[data-role="window"].open'), name).toHaveCount(1);
    const tabs = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-role="window"].open .win-tabs [data-hud]')).map((e) => e.dataset['hud']!));
    for (const tab of tabs.length ? tabs : [null]) {
      if (tab) await page.locator(`[data-role="window"].open [data-hud="${tab}"]`).click();
      await page.waitForTimeout(150);
      const n = await page.locator('[data-role="window"].open .win-body button:is(.off, [aria-disabled="true"]), [data-role="window"].open .win-pin button:is(.off, [aria-disabled="true"])').count();
      for (let i = 0; i < Math.min(n, 3); i++) {
        const b = page.locator('[data-role="window"].open :is(.win-body, .win-pin) button:is(.off, [aria-disabled="true"])').nth(i);
        if (!(await b.isVisible())) continue;
        const before = await window_(page);
        await b.scrollIntoViewIfNeeded();
        await b.click({ force: true });
        await page.waitForTimeout(60);
        expect(await b.evaluate((e) => e.classList.contains('nudge')), `${name} ${tab ?? ''} #${i} shakes`).toBe(true);
        expect(await window_(page), `${name}: nothing spent`).toEqual(before);
        await expect(page.locator('[data-role="window"].open'), `${name}: the window stays`).toHaveCount(1);
        answered++;
      }
    }
    // Closed by its cross from the DOM (Esc toggles the pause; the cross may be mid-fade for a pointer).
    await page.evaluate(() => document.querySelector<HTMLElement>('[data-role="window"].open [data-hud="win-close"]')?.click());
    if ((await page.locator('[data-role="window"].open').count()) > 0) await page.keyboard.press('Escape');
    await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
    await expect(page.locator('[data-role="window"].open'), `${name} closed`).toHaveCount(0);
    await page.waitForTimeout(400);
  }
  console.log(`off buttons answered: ${answered}`);
  expect(answered).toBeGreaterThan(4);
});
