import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, testState } from './fixtures.ts';
import game from '../content/avalanche/game.json' with { type: 'json' };

// FM-15, Q-054 (docs/01-gdd.md 19.10; 03 CNT-05, 4.1; decision of the producer 13.10): by the side of the pause and
// settings window «Promo codes and bonuses in the channel» and a button a channel of game.json community (telegram,
// vk) — a new tab by the player's press, nothing given, community_open with the channel; `?community=none` — no block and
// no window.open at all; the block fits on 640 × 360 in ru and en; screenshots.
const channels = game.community as Record<string, string>;
const IDS = Object.keys(channels);

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

test('the channels by the side of the pause window: each opens its address in a new tab once; nothing given; community_open', async ({ page, openGame }) => {
  await catchOpen(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame('pace=open');
  const before = await testState(page);
  await page.locator('[data-hud="pause"]').click();
  await expect(page.locator('[data-role="community"] .pause-side-cap')).toHaveText('Новости игры в группе');
  await expect(page.locator('[data-hud="community-telegram"]')).toHaveText('Telegram');
  await expect(page.locator('[data-hud="community-vk"]')).toHaveText('ВКонтакте');
  // Beside the settings on a wide screen: the block to the right of the column, not under it.
  const main = (await page.locator('.pause-main').boundingBox())!;
  const side = (await page.locator('[data-role="community"]').boundingBox())!;
  expect(side.x).toBeGreaterThanOrEqual(main.x + main.width - 1);
  mkdirSync('docs/evidence/sp', { recursive: true });
  await page.screenshot({ path: 'docs/evidence/sp/pause_community_1920x1080_ru.png' });
  for (const id of IDS) await page.locator(`[data-hud="community-${id}"]`).click();
  expect(await opened(page)).toEqual(IDS.map((id) => [channels[id], '_blank', 'noopener,noreferrer']));
  const s = await testState(page);
  expect([s.coins, s.trophies, s.stat]).toEqual([before.coins, before.trophies, before.stat]);
  const events = (await page.evaluate(() => window.__TEST__!.analytics())).filter((e) => e.name === 'community_open');
  expect(events.map((e) => e.params)).toEqual(IDS.map((id) => ({ to: id })));
});

test('without channels: no block, no window.open', async ({ page, openGame }) => {
  await catchOpen(page);
  await openGame('pace=open&community=none');
  await page.locator('[data-hud="pause"]').click();
  await expect(page.locator('[data-role="pause"]')).toBeVisible();
  await expect(page.locator('[data-role="community"]')).toHaveCount(0);
  expect(await opened(page)).toEqual([]);
});

for (const lang of ['ru', 'en'])
  test(`640 × 360, ${lang}: the caption and both buttons fit`, async ({ page, openGame }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await openGame(`pace=open&mock_lang=${lang}`);
    await page.locator('[data-hud="pause"]').click();
    const block = page.locator('[data-role="community"]');
    await block.scrollIntoViewIfNeeded();
    await expect(block).toBeVisible();
    for (const id of IDS) {
      const b = page.locator(`[data-hud="community-${id}"]`);
      await expect(b).toBeVisible();
      expect(await b.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    }
    await page.screenshot({ path: `docs/evidence/fm/community_640x360_${lang}.png` });
  });
