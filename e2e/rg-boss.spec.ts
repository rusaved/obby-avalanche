import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };

// RG-10: the giant goes at bots too (docs/01-gdd.md 18.5). On mountain 1 the hero waits by the start of the giant's zone:
// within 90 s of play bots come up, wait by the zone and run it — the giant goes at one and slaps one; then the hero with
// the Speed of the advice runs it and passes.
type Boss = { zone: [number, number]; requires: number };
const w1 = (openWorlds as unknown as { worlds: Array<{ bosses: Boss[] }> }).worlds[0]!;
const zone = w1.bosses[0]!.zone;
const EVIDENCE = 'docs/evidence/rg';

async function pastScriptedWave(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
}

test('mountain 1: the giant chases and slaps a bot within 90 s; then the hero with the advice passes; screenshot', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&seed=4&quality=high');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  // Every run of the zone by a slow bot (passShare 0.8 is a draw: SP-06 changed the draws, and with seed 4 six fast runs
  // in a row came within the 90 s).
  await page.evaluate(() => window.__TEST__!.botsPassShare(0));
  await pastScriptedWave(page);
  // The Speed of the advice opens every ridge for the bots; the hero stands below the zone line.
  await page.evaluate(([st, z]) => {
    window.__TEST__!.setStat(st);
    window.__TEST__!.teleport(z, 0);
  }, [w1.bosses[0]!.requires, zone[0] - 8] as const);
  await page.evaluate(() => window.__TEST__!.setTimeScale(3));
  const t0 = (await testState(page)).ticks;
  let chasedBot = false;
  let shot = false;
  for (let k = 0; k < 2000; k++) {
    await page.evaluate(() => window.__TEST__!.holdWave(60));
    const s = await testState(page);
    const running = s.bots.filter((b) => b.mode === 'zone' && b.z > zone[0] && b.z < zone[1]);
    const g = s.boss!.zones[0]!;
    if (running.length && g.hero !== 'in' && g.giants.some((x) => x.mode === 'chase')) chasedBot = true;
    if (chasedBot && !shot && running.length) {
      await page.evaluate(() => window.__TEST__!.setTimeScale(1));
      await page.evaluate(() => window.__TEST__!.setCamera({ yaw: 0, pitch: 0.35, dist: 22 }));
      await shot1080(page, `${EVIDENCE}/boss_bot_1920x1080_ru.png`, 4);
      await page.evaluate(() => window.__TEST__!.setCamera('auto'));
      await page.evaluate(() => window.__TEST__!.setTimeScale(3));
      shot = true;
    }
    const slaps = (await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'bossBotCaught').length)) as number;
    if (chasedBot && slaps > 0 && shot) break;
    if (s.ticks - t0 > 90 * 60) break;
    await waitTicks(page, 15);
  }
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  const slaps = (await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'bossBotCaught').length)) as number;
  expect(chasedBot, 'a chase of a bot').toBe(true);
  expect(slaps, 'a bot slapped').toBeGreaterThan(0);
  expect((await page.evaluate(() => window.__TEST__!.analytics().filter((e) => e.name === 'boss_bot_caught').length)) as number).toBeGreaterThan(0);
  // The hero with the advice: straight up through the zone.
  await page.evaluate(([z]) => window.__TEST__!.botPath([[0, z]]), [zone[1] + 6] as const);
  await page.waitForFunction(() => window.__TEST__!.botLeft() === 0, undefined, { timeout: 60_000 });
  const s = await testState(page);
  expect(s.boss!.zones[0]!.hero).toBe('passed');
});
