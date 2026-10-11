import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };
import ru from '../content/avalanche/i18n/ru.json' with { type: 'json' };
import en from '../content/avalanche/i18n/en.json' with { type: 'json' };

// RG-11: two giants of mountain 9 (docs/01-gdd.md 18.5; docs/01a-content.md 17.4, 17.6): two silhouettes on the horizon
// from the start of the mountain, two giants in the zone, the sign «Two giants: Speed ~{n}» in ru and en; screenshot.
type Boss = { zone: [number, number]; requires: number };
const w9 = (openWorlds as unknown as { worlds: Array<{ bosses: Boss[] }> }).worlds[8]!;
const zone = w9.bosses[0]!.zone;
const EVIDENCE = 'docs/evidence/rg';
const prefix = (s: string): string => s.slice(0, s.indexOf('{n}'));

async function toMountain9(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  await page.evaluate(() => window.__TEST__!.gotoWorld(9));
  await waitTicks(page, 20);
  // Every ridge open: the next goal is the giants' check.
  await page.evaluate(() => {
    window.__TEST__!.holdWave(120);
    window.__TEST__!.setStat(1e18);
  });
}

const goal = (page: Page): Promise<string> => page.evaluate(() => document.querySelector('.hud-goal-text')?.textContent ?? '');

test('mountain 9: two silhouettes from the start, two giants in the zone, the sign of the pair; screenshot', async ({ page, openGame }) => {
  test.setTimeout(150_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high');
  await toMountain9(page);
  await page.evaluate(() => window.__TEST__!.teleport(20, -18));
  await page.evaluate(() => window.__TEST__!.setCamera({ yaw: 0.2, pitch: 0.05 }));
  await waitTicks(page, 20);
  expect((await testState(page)).boss!.silhouettes, 'two silhouettes on the horizon').toBe(2);
  await page.evaluate(() => window.__TEST__!.setCamera('auto'));

  await page.evaluate((z) => window.__TEST__!.teleport(z, 0), zone[0] - 14);
  await waitTicks(page, 20);
  const s = await testState(page);
  const giants = s.boss!.zones[0]!.giants;
  expect(giants.length).toBe(2);
  expect(Math.abs(giants[0]!.z - giants[1]!.z)).toBeGreaterThan(1);
  for (const g of giants) {
    expect(g.z).toBeGreaterThanOrEqual(zone[0]);
    expect(g.z).toBeLessThanOrEqual(zone[1]);
  }
  // «Ridge open!» goes first for a couple of seconds.
  await expect.poll(() => goal(page), { timeout: 15_000 }).toContain(prefix(ru['boss.signPair']));
  // The shot: the hero stands in the middle of the zone, both giants turn to him and close in from the two sides.
  await page.evaluate((z) => window.__TEST__!.teleport(z, 0), (zone[0] + zone[1]) / 2);
  await page.evaluate(() => window.__TEST__!.setCamera({ yaw: 1.2, pitch: 0.3, dist: 34 }));
  await page.waitForFunction((m) => {
    const g = window.__TEST__!.state().boss!.zones[0]!.giants;
    return g.every((x) => x.mode === 'chase' && Math.abs(x.z - m) < 40);
  }, (zone[0] + zone[1]) / 2, { timeout: 60_000 });
  await shot1080(page, `${EVIDENCE}/two_giants_1920x1080_ru.png`, 4);
  await page.evaluate(() => window.__TEST__!.setCamera('auto'));
});

test('mountain 9 in English: «Two giants: Speed ~N»', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await openGame('pace=open&mock_lang=en');
  await toMountain9(page);
  await page.evaluate((z) => window.__TEST__!.teleport(z, 0), zone[0] - 14);
  await waitTicks(page, 20);
  await expect.poll(() => goal(page), { timeout: 15_000 }).toContain(prefix(en['boss.signPair']));
});
