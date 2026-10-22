import { test, expect } from './fixtures.ts';
import type { Page } from '@playwright/test';

// M4-01 (docs/03 2.3, SND-02…04): the sound is suspended no later than 2 s after blur, a hidden tab, game_api_pause and
// an open ad; with every reason gone the game and the sound go on; GameplayAPI.start/stop only on transitions.
// M4-02 (docs/06 step 2): the platform's startup ad — the game stands while it plays, starts after it, the events
// startup_ad_start and startup_ad_end once each.

const audio = (page: Page): Promise<boolean> => page.evaluate(() => window.__TEST__!.state().audioRunning);
const reasons = (page: Page): Promise<string[]> => page.evaluate(() => window.__TEST__!.state().pauseReasons as string[]);
async function start(page: Page, openGame: (q?: string) => Promise<void>, q = ''): Promise<void> {
  await openGame(`pace=stages${q}`);
  await page.evaluate(() => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.holdWave(9000);
  });
  await page.mouse.click(480, 300);
  await expect.poll(() => audio(page)).toBe(true);
}
/** Suspended within 2 s, then back once the reason is gone. */
async function suspends(page: Page, label: string, on: () => Promise<unknown>, off: () => Promise<unknown>): Promise<void> {
  const t0 = Date.now();
  await on();
  await expect.poll(() => audio(page), { timeout: 2_000, message: `${label}: suspended within 2 s`, intervals: [50] }).toBe(false);
  expect(Date.now() - t0).toBeLessThanOrEqual(2_000);
  const tick = await page.evaluate(() => window.__TEST__!.state().simTick);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__TEST__!.state().simTick), `${label}: the game stands`).toBe(tick);
  await off();
  await expect.poll(() => reasons(page), { message: `${label}: every reason gone` }).toEqual([]);
  await expect.poll(() => audio(page), { message: `${label}: the sound goes on` }).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__TEST__!.state().simTick), { message: `${label}: the game goes on` }).toBeGreaterThan(tick);
}

test('SND-02 SND-03 SND-04: blur, a hidden tab, game_api_pause and an open ad suspend the sound and the game; GameplayAPI only on transitions', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await start(page, openGame);
  await suspends(
    page,
    'SND-02 blur',
    () => page.evaluate(() => window.dispatchEvent(new Event('blur'))),
    () => page.evaluate(() => window.dispatchEvent(new Event('focus'))),
  );
  const hide = (on: boolean) =>
    page.evaluate((h) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
      document.dispatchEvent(new Event('visibilitychange'));
    }, on);
  await suspends(page, 'SND-03 hidden', () => hide(true), () => hide(false));
  await suspends(
    page,
    'SND-04 game_api_pause',
    () => page.evaluate(() => window.__YA_MOCK__!.sdk.dispatchEvent('game_api_pause')),
    () => page.evaluate(() => window.__YA_MOCK__!.sdk.dispatchEvent('game_api_resume')),
  );
  let done: Promise<unknown> = Promise.resolve();
  await suspends(
    page,
    'SND-04 an open ad',
    async () => {
      done = page.evaluate(() => window.__TEST__!.showAd('interstitial'));
    },
    () => done,
  );
  // GameplayAPI: never two starts or two stops in a row.
  const seq = await page.evaluate(() => window.__YA_MOCK__!.calls.map((c) => c.name).filter((n) => n.startsWith('GameplayAPI.')));
  expect(seq.length).toBeGreaterThan(2);
  for (let i = 1; i < seq.length; i++) expect(seq[i], `GameplayAPI #${i}: ${seq.join(', ')}`).not.toBe(seq[i - 1]);
});

test('M4-02 the startup ad: the game stands while it plays and starts after it; startup_ad_start and startup_ad_end once', async ({ page, openGame }) => {
  await openGame('pace=stages&mock_startup_ad=1&mock_startup_ad_ms=8000');
  // The mock's startup ad lasts 2 s from init: the game is held on «sdk» meanwhile.
  const during = await page.evaluate(() => ({ reasons: window.__TEST__!.state().pauseReasons as string[], tick: window.__TEST__!.state().simTick }));
  expect(during.reasons, 'held while the startup ad plays').toContain('sdk');
  const wave0 = await page.evaluate(() => window.__TEST__!.state().wave?.timer ?? 0);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyW');
  const mid = await page.evaluate(() => ({ tick: window.__TEST__!.state().simTick, wave: window.__TEST__!.state().wave?.timer ?? 0, audio: window.__TEST__!.state().audioRunning }));
  expect(mid.tick, 'no step while the ad plays').toBe(during.tick);
  expect(mid.wave, 'the avalanche stands').toBe(wave0);
  expect(mid.audio, 'no sound').toBe(false);
  await expect.poll(() => reasons(page), { timeout: 10_000 }).not.toContain('sdk');
  await expect.poll(() => page.evaluate(() => window.__TEST__!.state().simTick)).toBeGreaterThan(during.tick);
  const names = await page.evaluate(() => window.__TEST__!.analytics().map((e) => e.name));
  expect(names.filter((n) => n === 'startup_ad_start')).toHaveLength(1);
  expect(names.filter((n) => n === 'startup_ad_end')).toHaveLength(1);
  expect(names.indexOf('startup_ad_start')).toBeLessThan(names.indexOf('startup_ad_end'));
  const seq = await page.evaluate(() => window.__YA_MOCK__!.calls.map((c) => c.name).filter((n) => n.startsWith('GameplayAPI.')));
  expect(seq[0], 'the first start after the ad').toBe('GameplayAPI.start');
});
