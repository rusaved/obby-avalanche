import { test, expect } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { STAGES, threshold } from './lv-stage-data.ts';

// M4-06 (docs/01-gdd.md 7.9; docs/02-tech.md 11.7; GDD-16): the leaderboard behind game.json.leaderboard (off in the
// game, ?leaderboard= here): setScore only for a signed-in player — on the summit; «Sign in» in the records window.

const setScores = (page: Page): Promise<number> => page.evaluate(() => window.__YA_MOCK__!.calls.filter((c) => c.name === 'leaderboards.setScore').length);
async function summit(page: Page): Promise<void> {
  await page.evaluate((s) => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.holdWave(9000);
    window.__TEST__!.setStat(s);
  }, threshold(40));
  await page.mouse.click(480, 300);
  const W = STAGES[0]!;
  const last = W.stages[W.stages.length - 1]!;
  const portal = W.segments.find((s) => s.type === 'portal')!;
  await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y), [last.finish[0] + 2, last.y + 0.5] as const);
  await page.evaluate((z) => window.__TEST__!.botPath([[0, z + 2]]), portal.z);
  await expect(page.locator('[data-role="window"].open')).toBeVisible({ timeout: 40_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await page.waitForTimeout(500);
}
async function openRecords(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (await page.locator('[data-role="window"].open').count()) await page.locator('[data-hud="win-next"]').click();
  await page.waitForFunction(() => window.__TEST__!.state().window === null, undefined, { timeout: 30_000 });
  const more = page.locator('[data-hud="menu-more"]').first();
  await more.dispatchEvent('pointerdown');
  await page.locator('[data-hud="more-records"]').click();
}

test('M4-06 not signed in: no setScore on the summit; «Sign in» in the records window signs in', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await openGame('pace=stages&leaderboard=trophies&mock_auth_dialog=ok');
  await summit(page);
  expect(await setScores(page)).toBe(0);
  await openRecords(page);
  const login = page.locator('[data-hud="records-login"]');
  await expect(login).toBeVisible({ timeout: 10_000 });
  await expect(login).toHaveText('Войти');
  await login.click();
  await expect(login).toHaveCount(0, { timeout: 10_000 });
});

test('M4-06 signed in: the trophies go to the table on the summit, once', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await openGame('pace=stages&leaderboard=trophies&mock_auth=1');
  await summit(page);
  await expect.poll(() => setScores(page), { timeout: 10_000 }).toBe(1);
});
