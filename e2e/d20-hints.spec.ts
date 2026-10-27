import type { Page } from '@playwright/test';
import { test, expect, waitTicks } from './fixtures.ts';
import { threshold } from './lv-stage-data.ts';

// D-05 (headquarters 27.10): «LEVEL UP!» stays at least 2 s though another toast waits; a toast of the giant that comes
// while it waits goes first (one queue, the important first).
const watchToasts = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const w = window as unknown as { __toasts: Array<{ text: string; on: boolean; t: number }> };
    w.__toasts = [];
    const el = document.querySelector('[data-role="toast"]')!;
    let last = '';
    const note = (): void => {
      const on = el.classList.contains('shown');
      const key = `${on}|${el.textContent}`;
      if (key === last) return;
      last = key;
      w.__toasts.push({ text: el.textContent ?? '', on, t: performance.now() });
    };
    new MutationObserver(note).observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
  });
const toasts = (page: Page): Promise<Array<{ text: string; on: boolean; t: number }>> =>
  page.evaluate(() => (window as unknown as { __toasts: Array<{ text: string; on: boolean; t: number }> }).__toasts);

test.describe('D-05 · the toast queue', () => {
  test.use({ viewport: { width: 880, height: 405 } });

  test('D-05: «LEVEL UP!» is held ≥ 2 s though a toast waits behind it', async ({ page, openGame }) => {
    await openGame('pace=stages&mock_device=mobile');
    await page.evaluate((s) => {
      window.__TEST__!.setFlag('firstWaveDone', true);
      window.__TEST__!.holdWave(9000);
      window.__TEST__!.setStat(s);
    }, threshold(4));
    await waitTicks(page, 10);
    await watchToasts(page);
    await page.evaluate((s) => window.__TEST__!.setStat(s), threshold(5));
    await page.waitForFunction(() => /уровень выше/i.test(document.querySelector('[data-role="toast"].shown')?.textContent ?? ''), undefined, { timeout: 15_000 });
    await page.evaluate(() => window.__TEST__!.showToast('Next', 2));
    await page.waitForFunction(() => /Next/.test(document.querySelector('[data-role="toast"].shown')?.textContent ?? ''), undefined, { timeout: 15_000 });
    const log = await toasts(page);
    const on = log.find((x) => x.on && /уровень выше/i.test(x.text))!;
    const off = log.find((x) => x.t > on.t && (!x.on || !/уровень выше/i.test(x.text)))!;
    expect((off.t - on.t) / 1000, log.map((x) => `${x.on ? '+' : '-'}${x.text}@${Math.round(x.t)}`).join(' ')).toBeGreaterThanOrEqual(2);
  });

  test('D-05: the giant toast that comes while «LEVEL UP!» waits is shown before it', async ({ page, openGame }) => {
    await openGame('pace=stages&mock_device=mobile');
    await page.evaluate((s) => {
      window.__TEST__!.setFlag('firstWaveDone', true);
      window.__TEST__!.holdWave(9000);
      window.__TEST__!.setStat(s);
    }, threshold(4));
    await waitTicks(page, 10);
    await watchToasts(page);
    // A plain toast up, then «LEVEL UP!» waits; the hero into the giant's zone: «Run round the giant» comes first.
    await page.evaluate(() => window.__TEST__!.showToast('Hello', 3));
    await page.evaluate((s) => window.__TEST__!.setStat(s), threshold(5));
    const zone = await page.evaluate(() => window.__TEST__!.state().boss!.zones[0]!.zone);
    await page.evaluate((z) => window.__TEST__!.teleport(z, 0), zone[0] + 2);
    await page.waitForFunction(() => /уровень выше/i.test(document.querySelector('[data-role="toast"].shown')?.textContent ?? ''), undefined, { timeout: 20_000 });
    const log = await toasts(page);
    const giant = log.findIndex((x) => x.on && /великана/.test(x.text));
    const level = log.findIndex((x) => x.on && /уровень выше/i.test(x.text));
    expect(giant, log.map((x) => `${x.on ? '+' : '-'}${x.text}`).join(' ')).toBeGreaterThanOrEqual(0);
    expect(giant).toBeLessThan(level);
  });
});
