import type { Page } from '@playwright/test';
import { test, expect, testState } from './fixtures.ts';

// FM-15 (Q-054; docs/01-gdd.md 19.10; 03 CNT-05, 4.1): «Game community» in the pause window — the address of game.json
// (here a stand-in by ?community=), a new tab by the player's press, nothing given; no address — no button and no
// window.open at all; the button fits on 640 × 360 in ru and en.
const URL_STUB = 'https://vk.com/stand_in_game_community';

/** window.open caught: the calls land in window.__opened. */
async function catchOpen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __opened: unknown[][] }).__opened = [];
    window.open = ((...args: unknown[]) => {
      (window as unknown as { __opened: unknown[][] }).__opened.push(args);
      return null;
    }) as typeof window.open;
  });
}
const opened = (page: Page): Promise<unknown[][]> => page.evaluate(() => (window as unknown as { __opened: unknown[][] }).__opened);

test('with an address: the button in the pause window opens it in a new tab once; nothing given; community_open', async ({ page, openGame }) => {
  await catchOpen(page);
  await openGame(`pace=open&community=${encodeURIComponent(URL_STUB)}`);
  const before = await testState(page);
  await page.locator('[data-hud="pause"]').click();
  await expect(page.locator('[data-hud="community"]')).toHaveText('Сообщество игры');
  await page.locator('[data-hud="community"]').click();
  expect(await opened(page)).toEqual([[URL_STUB, '_blank', 'noopener,noreferrer']]);
  const s = await testState(page);
  expect([s.coins, s.trophies, s.stat]).toEqual([before.coins, before.trophies, before.stat]);
  expect((await page.evaluate(() => window.__TEST__!.analytics())).filter((e) => e.name === 'community_open')).toHaveLength(1);
});

test('without an address: no button, no window.open', async ({ page, openGame }) => {
  await catchOpen(page);
  await openGame('pace=open');
  await page.locator('[data-hud="pause"]').click();
  await expect(page.locator('[data-role="pause"]')).toBeVisible();
  await expect(page.locator('[data-hud="community"]')).toHaveCount(0);
  expect(await opened(page)).toEqual([]);
});

for (const lang of ['ru', 'en'])
  test(`640 × 360, ${lang}: the button fits`, async ({ page, openGame }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await openGame(`pace=open&mock_lang=${lang}&community=${encodeURIComponent(URL_STUB)}`);
    await page.locator('[data-hud="pause"]').click();
    const b = page.locator('[data-hud="community"]');
    await b.scrollIntoViewIfNeeded();
    await expect(b).toBeVisible();
    const fit = await b.evaluate((e) => e.scrollWidth <= e.clientWidth + 1);
    expect(fit).toBe(true);
    await page.screenshot({ path: `docs/evidence/fm/community_640x360_${lang}.png` });
  });
