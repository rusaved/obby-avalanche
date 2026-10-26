import { test, expect, shot1080, testState, waitReady, waitTicks } from './fixtures.ts';
import { toFirstBase } from './base-route.ts';
import base from '../content/avalanche/pace/open/base.json' with { type: 'json' };

// FM-11 (docs/01-gdd.md 19.3; docs/01a-content.md 18.1, 18.8), G-07 (producer 26.10, docs/01-gdd.md 27.4): the stand of the
// gift calendar by the spawn of the base — «Gift calendar · !» over it while the reward waits (the box lit), walking up
// opens the calendar window, «Claim» there gives it once; then the timer of the «Calendar» button over it; back in the
// game with the gift waiting — «Your daily gift is waiting!».
const H = 3_600_000;
const gift = base.stands.daily;

test('the gift calendar stand: its name and «!», walking up opens the calendar, «Claim» once, then the timer as on «Calendar»; next day F5 — welcomeGift; screenshot', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  await toFirstBase(page, openGame);
  await page.evaluate(() => window.__TEST__!.setPlaySec(190));
  await waitTicks(page, 20);
  let s = await testState(page);
  expect(s.daily.canClaim).toBe(true);
  expect(s.standLabel).toBe('Календарь подарков · !');
  expect(s.giftReady).toBe(true);
  await page.waitForFunction(() => !document.querySelector('.toasting'), undefined, { timeout: 10_000 });
  await shot1080(page, 'docs/evidence/G/base_gift_stand_1920x1080_ru.png', 5);
  // Up to the stand: the calendar opens by itself.
  // The window stands the game as it opens: the bot stops short of its last point.
  await page.evaluate((p) => window.__TEST__!.botPath(p), [[gift.x - 0.5, gift.z + 2]] as Array<[number, number]>);
  await expect(page.locator('[data-hud="daily-claim"]')).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await page.locator('[data-hud="daily-claim"]').click();
  // The window stands the game: real time, not ticks.
  await page.waitForTimeout(300);
  s = await testState(page);
  expect(s.daily.n).toBe(1);
  expect(s.daily.canClaim).toBe(false);
  const claims = (await page.evaluate(() => window.__TEST__!.analytics())).filter((e) => e.name === 'daily_claim');
  expect(claims.map((e) => e.params)).toEqual([{ day: 1, from: 'window' }]);
  await expect(page.locator('[data-role="daily-card"]').nth(0)).toHaveAttribute('data-state', 'past');
  await page.locator('[data-hud="win-close"]').click();
  // Once: the timer over the box as on the «Calendar» button.
  await waitTicks(page, 30);
  s = await testState(page);
  expect(s.giftReady).toBe(false);
  const badge = await page.locator('[data-hud="menu-daily"] .hud-menu-badge').textContent();
  expect(s.standLabel).toMatch(/^Календарь подарков · через \d+:\d\d:\d\d$/);
  // The same clock: read a moment apart, the two may straddle a second (and with it 20:00:00 → 19:59:59).
  const secs = (x: string): number => x.match(/(\d+):(\d\d):(\d\d)$/)!.slice(1).reduce((a, d) => a * 60 + Number(d), 0);
  expect(Math.abs(secs(s.standLabel!) - secs(badge!))).toBeLessThanOrEqual(2);

  // A new game day: back in the game on the base with the gift waiting.
  await page.goto(`/?pace=open&quality=high&mock_time_offset=${20 * H + 5000}`);
  await waitReady(page);
  await waitTicks(page, 5);
  s = await testState(page);
  expect(s.onBase).toBe(true);
  expect(s.daily.canClaim).toBe(true);
  expect(s.waveHud.toast).toContain('Подарок дня ждёт!');
});
