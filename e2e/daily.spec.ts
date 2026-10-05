import { test, expect, testState, waitReady, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';

// M3-08: the 7-day calendar (docs/01-gdd.md 7.6; GDD-10). The button from 3:00 of play, «!» while the reward waits;
// one claim per game day by the 20-hour rule on server time (the mock clock: ?mock_time_offset); the calendar, the ad
// egg progress and the ×2 boost live in the save and survive F5 and the day change.

const H = 3_600_000;

async function reloadAt(page: Page, offsetMs: number): Promise<void> {
  await page.goto(`/?pace=classic&mock_time_offset=${offsetMs}`);
  await waitReady(page);
  await waitTicks(page, 2);
}

test('calendar: claim day 1, F5 keeps it, 19 h later still locked, 20 h later day 2; boost and ad egg survive F5 and the day change', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame();
  const btn = page.locator('[data-hud="menu-daily"]');
  await expect(btn).toHaveCount(0);
  // The button comes at 3:00 of play with «!»; the window never opens by itself.
  await page.evaluate(() => window.__TEST__!.setPlaySec(185));
  await expect(btn).toBeVisible();
  await expect(btn.locator('.hud-menu-badge')).toHaveText('!');
  expect((await testState(page)).window).toBeNull();
  await btn.dispatchEvent('pointerdown');
  const win = page.locator('[data-role="window"][data-window="daily"]');
  await expect(win.locator('.win-title')).toHaveText('Календарь');
  const cards = page.locator('[data-role="daily-card"]');
  await expect(cards).toHaveCount(7);
  await expect(cards.nth(0)).toHaveAttribute('data-state', 'today');
  await expect(cards.nth(1)).toHaveAttribute('data-state', 'future');
  await expect(cards.nth(1)).toContainText('Скин «Пингвин»');
  await expect(cards.nth(6)).toContainText('Олень и крылья');
  expect(await page.locator('.win-body').evaluate((b) => b.scrollHeight <= b.clientHeight + 1)).toBe(true);
  await page.screenshot({ path: 'docs/evidence/M3/daily_1920x1080_ru.png' });
  const coins0 = (await testState(page)).coins;
  await page.locator('[data-hud="daily-claim"]').click();
  let s = await testState(page);
  expect(s.coins).toBeGreaterThan(coins0);
  expect(s.daily.n).toBe(1);
  expect(s.daily.canClaim).toBe(false);
  expect(s.waveHud.toast).toContain('Награда получена');
  expect(s.toastSub).toBe('Завтра: Скин «Пингвин»');
  await expect(cards.nth(0)).toHaveAttribute('data-state', 'past');
  await expect(page.locator('[data-hud="daily-claim"]')).toHaveCount(0);
  await expect(page.locator('[data-role="daily-next"]')).toHaveText(/^Следующая награда через 19:59:5\d$/);
  const claims = (await page.evaluate(() => window.__TEST__!.analytics())).filter((e) => e.name === 'daily_claim');
  expect(claims.map((e) => e.params)).toEqual([{ day: 1 }]);
  await page.screenshot({ path: 'docs/evidence/M3/daily_claimed_1920x1080_ru.png' });
  await page.locator('[data-hud="win-close"]').click();
  await expect(btn.locator('.hud-menu-badge')).toHaveText(/^через 19:5\d:\d\d$/);

  // An ad would give these (M4): the ×2 boost for 3 minutes and one view toward the egg.
  await page.evaluate(() => {
    window.__TEST__!.setBoost(180);
    window.__TEST__!.setAdEgg(2);
  });
  const mult = (await testState(page)).gainMult;
  // F5: the claim, the boost and the egg progress are in place.
  await reloadAt(page, 0);
  s = await testState(page);
  expect(s.daily.n).toBe(1);
  expect(s.daily.canClaim).toBe(false);
  expect(s.boostSec).toBeGreaterThan(170);
  expect(s.adEgg).toBe(2);
  expect(s.gainMult).toBeCloseTo(mult, 9);
  // 19 hours later: still the same game day.
  await reloadAt(page, 19 * H);
  s = await testState(page);
  expect(s.daily.canClaim).toBe(false);
  expect(s.daily.nextSec).toBeGreaterThan(3500);
  expect(s.daily.nextSec).toBeLessThan(3601);
  // 20 hours later: a new day, day 2 waits; the boost and the egg progress are still there.
  await reloadAt(page, 20 * H + 5000);
  s = await testState(page);
  expect(s.daily.canClaim).toBe(true);
  expect(s.daily.n).toBe(1);
  expect(s.boostSec).toBeGreaterThan(170);
  expect(s.adEgg).toBe(2);
  await expect(btn.locator('.hud-menu-badge')).toHaveText('!');
  await btn.dispatchEvent('pointerdown');
  await expect(cards.nth(0)).toHaveAttribute('data-state', 'past');
  await expect(cards.nth(1)).toHaveAttribute('data-state', 'today');
  await page.locator('[data-hud="daily-claim"]').click();
  s = await testState(page);
  expect(s.daily.n).toBe(2);
  expect(s.toastSub).toBe('Завтра: Буст ×2 за шаг на 10 мин');
  await page.locator('[data-hud="win-close"]').click();
  // Day 2 gave the Penguin Suit: the wardrobe has it.
  expect(await page.evaluate(() => window.__TEST__!.state().daily.n)).toBe(2);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('avalanche:save') ?? '{}').skins)).toContain('penguin_suit');
  // Once a day: the same moment again gives nothing.
  await reloadAt(page, 20 * H + 6000);
  expect((await testState(page)).daily.canClaim).toBe(false);
});

test('calendar on a phone 844×390: cards 4 + 3, «Claim» inside the screen', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openGame('mock_device=mobile');
  await page.evaluate(() => window.__TEST__!.setPlaySec(185));
  await page.locator('[data-hud="menu-daily"]').dispatchEvent('pointerdown');
  const cards = page.locator('[data-role="daily-card"]');
  await expect(cards).toHaveCount(7);
  const tops = await cards.evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetTop));
  expect(new Set(tops.slice(0, 4)).size).toBe(1);
  expect(tops[4]).toBeGreaterThan(tops[0]!);
  const claim = page.locator('[data-hud="daily-claim"]');
  await claim.scrollIntoViewIfNeeded();
  const box = (await claim.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'docs/evidence/M3/daily_844x390_ru.png' });
});
