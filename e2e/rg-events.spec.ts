import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };
import ru from '../content/avalanche/i18n/ru.json' with { type: 'json' };

// RG-05 and RG-07: the rare events (docs/01-gdd.md 18.4). ?mock_event=snowball starts the snowball on every section entry
// its rules allow. Mountain 5, into section 3: the trail shows with the ball and it meets the standing hero no sooner
// than 3 s later — a hit: «Hit by a snowball!» and «×0,6»; again with a step aside: missed, the ball goes by;
// event_snowball each time.
type OpenWorld = { zones: Array<{ k: number; zStart: number }> };
const w5 = (openWorlds as unknown as { worlds: OpenWorld[] }).worlds[4]!;
const s3 = w5.zones.find((z) => z.k === 3)!.zStart;
const EVIDENCE = 'docs/evidence/rg';

async function toMountain5(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  await page.evaluate(() => window.__TEST__!.gotoWorld(5));
  await waitTicks(page, 20);
  // The ridges stay closed: the ball never starts in section 2 below the ridge of section 3.
  await page.evaluate(() => {
    window.__TEST__!.holdWave(120);
    window.__TEST__!.setStat(1);
  });
}

const events = (page: Page): Promise<Array<{ name: string; tick: number; why: string | undefined }>> =>
  page.evaluate(() => window.__TEST__!.simEvents.filter((e) => ['eventStart', 'eventEnd', 'snowballHit'].includes(e.name as string)).map((e) => ({ name: e.name as string, tick: e.tick as number, why: e['why'] as string | undefined })));

test('mountain 5: the trail at once, the ball meets the standing hero ≥ 3 s later — a hit; a step aside — missed; screenshot', async ({ page, openGame }) => {
  test.setTimeout(150_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high&mock_event=snowball');
  await toMountain5(page);
  // Well above the closed ridge: the camera behind the hero clears its ice.
  await page.evaluate((z) => window.__TEST__!.teleport(z, 0), s3 + 45);
  // delaySec after the entry: the toast of the section's gifts first.
  await page.waitForFunction(() => window.__TEST__!.state().snowball !== null, undefined, { timeout: 15_000 });
  let s = await testState(page);
  expect(s.snowball, 'the ball').not.toBeNull();
  expect(s.snowball!.trail, 'the trail drawn').toBe(true);
  expect(s.snowball!.x).toBeCloseTo(0, 3);
  const toasts: string[] = [];
  let badge = '';
  let shot = false;
  for (let k = 0; k < 600; k++) {
    s = await testState(page);
    if (s.slowBadge) badge = s.slowBadge;
    if (s.waveHud.toast && !toasts.includes(s.waveHud.toast)) toasts.push(s.waveHud.toast);
    if (!shot && s.snowball && s.snowball.z - s.hero!.z < 40) {
      await page.evaluate(() => window.__TEST__!.setCamera({ yaw: 0.45, pitch: 0.3, dist: 30 }));
      await shot1080(page, `${EVIDENCE}/snowball_1920x1080_ru.png`, 1);
      await page.evaluate(() => window.__TEST__!.setCamera('auto'));
      shot = true;
    }
    if (badge && !s.snowball && toasts.includes(ru['event.snowballHit'])) break;
    await waitTicks(page, 2);
  }
  const ev = await events(page);
  const start = ev.find((e) => e.name === 'eventStart')!;
  const hit = ev.find((e) => e.name === 'snowballHit')!;
  expect(hit, 'a hit').toBeDefined();
  expect((hit.tick - start.tick) / 60, 'the trail ahead of the meeting').toBeGreaterThanOrEqual(3);
  expect(toasts).toContain(ru['event.snowball']);
  expect(toasts).toContain(ru['event.snowballHit']);
  expect(badge).toBe('×0,6');
  expect(shot).toBe(true);

  // Again: down into section 2 and back up into section 3, then a step aside off the trail.
  await page.evaluate((z) => window.__TEST__!.teleport(z, 0), s3 - 20);
  await waitTicks(page, 3);
  await page.evaluate((z) => window.__TEST__!.teleport(z, 0), s3 + 5);
  await page.waitForFunction(() => window.__TEST__!.state().snowball !== null, undefined, { timeout: 15_000 });
  await page.evaluate((z) => window.__TEST__!.botPath([[8, z]]), s3 + 5);
  await page.waitForFunction(() => window.__TEST__!.state().snowball === null, undefined, { timeout: 30_000 });
  const ev2 = (await events(page)).slice(ev.length);
  expect(ev2.map((e) => e.name)).toEqual(['eventStart', 'eventEnd']);
  expect(ev2[1]!.why).toBe('past');
  const tracked = (await page.evaluate(() => window.__TEST__!.analytics().filter((e) => e.name === 'event_snowball').length)) as number;
  expect(tracked).toBe(2);
});
