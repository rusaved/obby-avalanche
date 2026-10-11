import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };
import ru from '../content/avalanche/i18n/ru.json' with { type: 'json' };

// RG-04: the giant's helper on mountain 4 (docs/01-gdd.md 18.5; docs/01a-content.md 17.4). The hero with the Speed of the
// advice runs the zone: the helper throws within 3 s of it, a hit shows «×0,85» on the Speed plaque and «Snowball!»; he
// passes the zone with the first try.
type Boss = { zone: [number, number]; requires: number };
const w4 = (openWorlds as unknown as { worlds: Array<{ bosses: Boss[] }> }).worlds[3]!;
const zone = w4.bosses[0]!.zone;
const EVIDENCE = 'docs/evidence/rg';

async function pastScriptedWave(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
}

test('mountain 4: a helper throws within 3 s, a hit — «×0,85» and «Snowball!»; the advice passes the zone first try; screenshot', async ({ page, openGame }) => {
  test.setTimeout(150_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await pastScriptedWave(page);
  await page.evaluate(() => window.__TEST__!.gotoWorld(4));
  await waitTicks(page, 20);
  await page.evaluate(([st, z]) => {
    window.__TEST__!.holdWave(120);
    window.__TEST__!.setStat(st);
    window.__TEST__!.teleport(z, 0);
  }, [w4.bosses[0]!.requires, zone[0] - 12] as const);
  await waitTicks(page, 10);
  await page.evaluate(([z]) => window.__TEST__!.botPath([[0, z]]), [zone[1] + 8] as const);
  let badge = '';
  const toasts: string[] = [];
  let shot = false;
  for (let k = 0; k < 600; k++) {
    const s = await testState(page);
    if (s.slowBadge) badge = s.slowBadge;
    if (s.waveHud.toast && !toasts.includes(s.waveHud.toast)) toasts.push(s.waveHud.toast);
    const flying = s.boss!.zones[0]!.hero === 'in' && (await page.evaluate(() => window.__TEST__!.simEvents.some((e) => e.name === 'helperThrow')));
    if (flying && !shot) {
      await shot1080(page, `${EVIDENCE}/helpers_1920x1080_ru.png`, 1);
      shot = true;
    }
    if (s.boss!.zones[0]!.hero === 'passed' && badge && toasts.length) break;
    if ((await page.evaluate(() => window.__TEST__!.botLeft())) === 0) break;
    await waitTicks(page, 2);
  }
  const ev = (await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => ['bossEnter', 'helperThrow', 'helperHit', 'bossCaught', 'bossPassed'].includes(e.name as string)).map((e) => ({ name: e.name, tick: e.tick })))) as Array<{ name: string; tick: number }>;
  const enter = ev.find((e) => e.name === 'bossEnter')!;
  const throw1 = ev.find((e) => e.name === 'helperThrow')!;
  expect(enter).toBeDefined();
  expect(throw1).toBeDefined();
  expect((throw1.tick - enter.tick) / 60).toBeLessThanOrEqual(3);
  expect(ev.some((e) => e.name === 'helperHit')).toBe(true);
  expect(badge).toBe('×0,85');
  expect(toasts).toContain(ru['helper.hit']);
  expect(ev.filter((e) => e.name === 'bossCaught')).toEqual([]);
  expect(ev.some((e) => e.name === 'bossPassed')).toBe(true);
  expect(shot).toBe(true);
});
