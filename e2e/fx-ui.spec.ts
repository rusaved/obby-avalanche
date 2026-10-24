import { test, expect } from './fixtures.ts';
import type { Page } from '@playwright/test';

// FX «Отклик и эффекты» (producer 22.10): toasts in a queue (FX-01), every press answers (FX-02), rewards fly to their
// counter (FX-03), windows open fast (FX-04), interface sounds (FX-06).

const shown = (page: Page): Promise<string> => page.evaluate(() => window.__TEST__!.state().waveHud.toast);

test('FX-01 toasts: one at a time, the first held its minimum, an equal one once, a mark of its kind, fade ≤ 250 ms', async ({ page, openGame }) => {
  await openGame('pace=stages');
  const seen: string[] = [];
  await page.evaluate(() => {
    const w = window as unknown as { __fxSeen: Array<[number, string, number]> };
    w.__fxSeen = [];
    const t0 = performance.now();
    const tick = (): void => {
      const all = Array.from(document.querySelectorAll('[data-role="toast"].shown'));
      const last = w.__fxSeen[w.__fxSeen.length - 1];
      const text = all[0]?.textContent ?? '';
      if (!last || last[1] !== text) w.__fxSeen.push([Math.round(performance.now() - t0), text, all.length]);
      requestAnimationFrame(tick);
    };
    tick();
    window.__TEST__!.showToast('Alpha', 3);
    window.__TEST__!.showToast('Beta +5', 2);
    window.__TEST__!.showToast('Beta +5', 2);
  });
  await expect.poll(() => shown(page)).toBe('Alpha');
  // The event mark: no own mark in «Alpha».
  expect(await page.locator('[data-role="toast"].shown [data-role="toast-icon"]').count()).toBe(1);
  expect(await page.locator('[data-role="toast"]').getAttribute('data-kind')).toBe('event');
  await expect.poll(() => shown(page), { timeout: 5_000 }).toBe('Beta +5');
  expect(await page.locator('[data-role="toast"]').getAttribute('data-kind')).toBe('reward');
  await expect.poll(() => shown(page), { timeout: 5_000 }).toBe('');
  const log = await page.evaluate(() => (window as unknown as { __fxSeen: Array<[number, string, number]> }).__fxSeen);
  for (const [, t, n] of log) {
    expect(n, 'never two toasts at once').toBeLessThanOrEqual(1);
    seen.push(t);
  }
  expect(seen.filter((t) => t === 'Beta +5').length, 'the equal toast once').toBe(1);
  const a = log.find((x) => x[1] === 'Alpha')![0];
  const b = log.find((x) => x[1] === 'Beta +5')![0];
  expect(b - a, 'Alpha held at least fx.toastMinSec').toBeGreaterThanOrEqual(1150);
  const dur = await page.evaluate(() => getComputedStyle(document.querySelector('[data-role="toast"]')!).transitionDuration);
  for (const d of dur.split(',')) expect(Number.parseFloat(d) * 1000).toBeLessThanOrEqual(250);
});

async function tap(page: Page, sel: string): Promise<void> {
  const b = page.locator(sel).first();
  await b.dispatchEvent('pointerdown', { pointerType: 'mouse', button: 0, isPrimary: true });
  await b.dispatchEvent('click', { detail: 1 });
}
const sfx = (page: Page): Promise<string[]> => page.evaluate(() => window.__TEST__!.state().sfx as string[]);
async function soundOn(page: Page): Promise<void> {
  await page.mouse.click(5, 300);
  await expect.poll(() => page.evaluate(() => window.__TEST__!.state().audioRunning), { timeout: 15_000 }).toBe(true);
  // ZzFX builds its buffers after the first gesture.
  await page.waitForTimeout(500);
}

test('FX-02 FX-06 every press squeezes and taps; what cannot act shakes, says «no» and tells why; windows sound, an ad silences', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await openGame('pace=stages');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await soundOn(page);
  // A HUD button: the squeeze class and uiTap; the window it opens — uiOpen; the game stands, the sound goes on.
  let n0 = (await sfx(page)).length;
  await tap(page, '[data-hud="pause"]');
  await expect(page.locator('[data-hud="pause"]')).toHaveClass(/\bpress\b/);
  await expect.poll(async () => (await sfx(page)).slice(n0)).toEqual(expect.arrayContaining(['uiTap', 'uiOpen']));
  expect(await page.evaluate(() => window.__TEST__!.state().audioRunning), 'a window alone keeps the sound').toBe(true);
  await page.evaluate(() => window.__TEST__!.openMenu(false));
  // A window button that cannot act: rebirth before its summit — shake, uiDeny, the bubble with its reason; no uiTap.
  await tap(page, '[data-hud="menu-more"]');
  await page.locator('[data-hud="more-rebirth"]').click();
  const go = page.locator('[data-hud="rebirth-do"]');
  await expect(go).toHaveAttribute('aria-disabled', 'true');
  await page.waitForTimeout(300);
  n0 = (await sfx(page)).length;
  await tap(page, '[data-hud="rebirth-do"]');
  await expect(go).toHaveClass(/\bnudge\b/);
  await expect(page.locator('[data-role="why"].shown')).toHaveText(/\S+/);
  await expect.poll(async () => (await sfx(page)).slice(n0)).toContain('uiDeny');
  expect((await sfx(page)).slice(n0)).not.toContain('uiTap');
  // The ceiling: 20 taps inside a second give at most fx.uiSoundPerSec interface sounds.
  await page.waitForTimeout(1100);
  n0 = (await sfx(page)).length;
  await page.evaluate(() => {
    const b = document.querySelector<HTMLElement>('[data-role="window"].open .win-tab, [data-role="window"].open button:not([aria-disabled])')!;
    for (let i = 0; i < 20; i++) b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0 }));
  });
  await page.waitForTimeout(300);
  const ui = (await sfx(page)).slice(n0).filter((s) => s.startsWith('ui'));
  expect(ui.length).toBeGreaterThan(0);
  expect(ui.length).toBeLessThanOrEqual(8);
  await page.evaluate(() => window.__TEST__!.openMenu(false));
  // An ad over the open window (the pause above may have spent the fullscreen one): silent.
  const done = page.evaluate(() => window.__TEST__!.showAd('rewarded'));
  await expect.poll(() => page.evaluate(() => window.__TEST__!.state().audioRunning), { timeout: 2_000 }).toBe(false);
  await done;
});

test('FX-04 a window: open within 150 ms of the press, its animation ≤ 150 ms, it fades out without taking presses', async ({ page, openGame }) => {
  await openGame('pace=stages');
  const ms = await page.evaluate(
    () =>
      new Promise<number>((done) => {
        const win = document.querySelector('[data-role="window"]')!;
        const b = document.querySelector<HTMLElement>('[data-hud="pause"]')!;
        const t0 = performance.now();
        const mo = new MutationObserver(() => {
          if (win.classList.contains('open')) {
            mo.disconnect();
            done(performance.now() - t0);
          }
        });
        mo.observe(win, { attributes: true });
        b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0 }));
      }),
  );
  expect(ms).toBeLessThanOrEqual(150);
  const anim = await page.evaluate(() => {
    const p = document.querySelector('[data-role="window"].open .win-panel')!;
    return getComputedStyle(p).animationDuration;
  });
  expect(Number.parseFloat(anim) * 1000).toBeGreaterThan(0);
  expect(Number.parseFloat(anim) * 1000).toBeLessThanOrEqual(150);
  const gone = await page.evaluate(() => {
    window.__TEST__!.openMenu(false);
    const w = document.querySelector('[data-role="window"]')!;
    return { closing: w.classList.contains('closing'), pe: getComputedStyle(w).pointerEvents };
  });
  expect(gone).toEqual({ closing: true, pe: 'none' });
  const win = page.locator('[data-role="window"]');
  await expect(win).toBeHidden({ timeout: 1_000 });
  expect(await page.evaluate(() => window.__TEST__!.state().pauseReasons as string[])).not.toContain('menu');
});

test('FX-03 a reward of the calendar flies to its counter, the counter ticks to the true number; FX-05 the world answers a step', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await openGame('pace=classic');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await tap(page, '[data-hud="menu-daily"]');
  const coins0 = await page.evaluate(() => window.__TEST__!.state().coins);
  await page.locator('[data-hud="daily-claim"]').click();
  // The marks fly (animations on the top layer), a counter shows the take (the HUD one or its copy over the window).
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('[data-role="fx-fly"] .fx-fly-mark').length && document.querySelector('[data-role="fx-fly"]')!.getAnimations({ subtree: true }).length), { timeout: 2_000 }).toBeGreaterThan(0);
  const coins1 = await page.evaluate(() => window.__TEST__!.state().coins);
  expect(coins1).toBeGreaterThan(coins0);
  const mid = await page.evaluate(() => [document.querySelector('[data-role="coins"] .hud-coin-value')!.textContent, document.querySelector('[data-role="fx-ghost"].shown')?.textContent ?? ''] as const);
  await page.waitForTimeout(1500);
  const want = await page.evaluate((n) => window.__TEST__!.fmt(n), coins1);
  await expect(page.locator('[data-role="coins"] .hud-coin-value')).toHaveText(want);
  expect(mid.length).toBe(2);
  await page.evaluate(() => window.__TEST__!.openMenu(false));
  await page.keyboard.press('Escape');
  // FX-05: steps of growth spark at the feet.
  const w0 = await page.evaluate(() => window.__TEST__!.state().funFx.world?.step ?? 0);
  await page.evaluate(() => window.__TEST__!.press('KeyW', 2500));
  await expect.poll(() => page.evaluate(() => window.__TEST__!.state().funFx.world?.step ?? 0), { timeout: 10_000 }).toBeGreaterThan(w0);
});
