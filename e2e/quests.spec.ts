import { test, expect, testState, waitReady, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';

// M3-08b: 3 quests of the day, 8 time rewards, the lucky wheel (docs/01-gdd.md 7.7, 7.8, 7.13; GDD-10). They live in
// the save, survive F5 and the day change of the mock (?mock_time_offset) and refresh with the calendar by the
// 20-hour rule; the free spin is one a game day.

const H = 3_600_000;

async function reloadAt(page: Page, offsetMs: number): Promise<void> {
  await page.goto(`/?mock_time_offset=${offsetMs}`);
  await waitReady(page);
  await waitTicks(page, 2);
}

test('quests and time rewards survive F5, refresh with the calendar after 20 h; one free spin a day', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame();
  let s = await testState(page);
  expect(s.menu).not.toContain('quests');
  expect(s.menu).not.toContain('timeRewards');
  expect(s.quests.list).toHaveLength(3);
  expect(new Set(s.quests.list.map((q) => q.id)).size).toBe(3);
  const day1 = s.quests.day;
  expect(day1).toBe(s.daily.dayStart);

  // The first summit brings «Quests»; 5:00 of play brings «Rewards».
  await page.evaluate(() => {
    window.__TEST__!.setTrophies(3);
    window.__TEST__!.setPlaySec(301);
  });
  await waitTicks(page, 3);
  s = await testState(page);
  expect(s.menu).toContain('quests');
  expect(s.menu).toContain('timeRewards');
  const first = s.quests.list[0]!;
  await page.evaluate(([id, n]) => window.__TEST__!.questProgress(id, n), [first.id, first.n] as const);
  await expect(page.locator('[data-hud="menu-quests"] .hud-menu-badge')).toHaveText('!');
  await page.locator('[data-hud="menu-quests"]').dispatchEvent('pointerdown');
  await expect(page.locator('[data-role="window"][data-window="quests"] .win-title')).toHaveText('Задания');
  await expect(page.locator('[data-role="quest"]')).toHaveCount(3);
  await expect(page.locator('[data-role="quest"]').nth(0)).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('[data-role="quest-bonus"]')).toContainText('За все три: 5 кубков и Снежное яйцо');
  await expect(page.locator('[data-role="quests-next"]')).toHaveText(/^Новые задания через 19:59:\d\d$/);
  await page.screenshot({ path: 'docs/evidence/M3/quests_1920x1080_ru.png' });
  const coins0 = s.coins;
  await page.locator('[data-hud="quest-claim-0"]').click();
  s = await testState(page);
  expect(s.quests.list[0]!.got).toBe(true);
  expect(s.trophies.now).toBe(5);
  expect(s.coins).toBeGreaterThan(coins0);
  await expect(page.locator('[data-role="quest"]').nth(0)).toHaveAttribute('data-state', 'got');
  await page.locator('[data-hud="win-close"]').click();

  // Time rewards: 3:10 of play today → the 1 and 3 minute tiles; claim the first, spin the free wheel.
  await page.evaluate(() => window.__TEST__!.addPlayToday(190));
  await expect(page.locator('[data-hud="menu-timeRewards"] .hud-menu-badge')).toHaveText('!');
  await page.locator('[data-hud="menu-timeRewards"]').dispatchEvent('pointerdown');
  const tiles = page.locator('[data-role="time-tile"]');
  await expect(tiles).toHaveCount(8);
  await expect(tiles.nth(0)).toHaveAttribute('data-state', 'ready');
  await expect(tiles.nth(1)).toHaveAttribute('data-state', 'ready');
  await expect(tiles.nth(2)).toHaveAttribute('data-state', 'run');
  await expect(tiles.nth(2)).toContainText(/1:[45]\d/);
  await page.locator('[data-hud="time-claim-0"]').click();
  await expect(tiles.nth(0)).toHaveAttribute('data-state', 'got');
  await expect(page.locator('[data-role="wheel-sector"]')).toHaveCount(8);
  await page.locator('[data-hud="wheel-spin"]').click();
  await expect(page.locator('[data-role="wheel-sector"].hit')).toHaveCount(1);
  await expect(page.locator('[data-hud="wheel-spin"]')).toHaveCount(0);
  await expect(page.locator('[data-role="wheel-next"]')).toHaveText(/^Следующий спин через 19:59:\d\d$/);
  expect(await page.locator('.win-body').evaluate((b) => b.scrollHeight <= b.clientHeight + 1)).toBe(true);
  await page.screenshot({ path: 'docs/evidence/M3/time_rewards_1920x1080_ru.png' });
  s = await testState(page);
  expect(s.wheelFree).toBe(false);
  expect(s.timeRw.got).toEqual([0]);
  const before = s;

  // F5: the same quests with their progress, the time today, the claimed tile, the used spin.
  await reloadAt(page, 0);
  s = await testState(page);
  expect(s.quests).toEqual(before.quests);
  expect(s.timeRw.got).toEqual([0]);
  expect(s.timeRw.sec).toBeGreaterThanOrEqual(before.timeRw.sec);
  expect(s.wheelFree).toBe(false);
  // 19 h later: the same game day.
  await reloadAt(page, 19 * H);
  s = await testState(page);
  expect(s.quests.day).toBe(day1);
  expect(s.quests.list[0]!.got).toBe(true);
  expect(s.timeRw.got).toEqual([0]);
  expect(s.wheelFree).toBe(false);
  // 20 h later: a new day for the calendar, the quests, the time rewards and the wheel together.
  await reloadAt(page, 20 * H + 5000);
  s = await testState(page);
  expect(s.daily.canClaim).toBe(true);
  expect(s.quests.day).not.toBe(day1);
  expect(s.quests.day).toBe(s.daily.dayStart);
  expect(s.quests.list).toHaveLength(3);
  expect(s.quests.list.every((q) => q.k === 0 && !q.got)).toBe(true);
  expect(s.quests.bonus).toBe(false);
  expect(s.timeRw.got).toEqual([]);
  expect(s.timeRw.sec).toBeLessThan(30);
  expect(s.wheelFree).toBe(true);
  expect(s.trophies.now).toBeGreaterThanOrEqual(5);
});
