import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };
import openSpec from '../content/avalanche/pace/open/worlds-spec.json' with { type: 'json' };

// RG-03: the throat of mountain 3 and the field past it (docs/01-gdd.md 18.3; docs/01a-content.md 17.2). The physical bot
// runs the throat on its ice; the siren at its entry — the bot is in the field grotto before the front; the camera never
// in the cliffs nor in the hero; draw calls in the throat ≤ 40.
type Seg = { type: string; z: number; y?: number; length?: number; section?: number; kind?: string };
const w3 = (openWorlds as unknown as { worlds: Array<{ segments: Seg[]; threat: { warnSec: number } }> }).worlds[2]!;
const throat = w3.segments.find((s) => s.type === 'throat' && s.section === 2)!;
const t0 = throat.z;
const t1 = throat.z + throat.length!;
const STAT = (openSpec as unknown as { mountains: Array<{ ridges: Array<{ requires: number }> }> }).mountains[2]!.ridges[0]!.requires;
const EVIDENCE = 'docs/evidence/rg';

async function toMountain3(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  await page.evaluate(() => window.__TEST__!.gotoWorld(3));
  await waitTicks(page, 20);
  await page.evaluate((st) => {
    window.__TEST__!.holdWave(120);
    window.__TEST__!.setStat(st);
  }, STAT);
}

test('mountain 3: the bot runs the throat on its ice; the camera keeps off the cliffs and the hero; ≤ 40 draw calls; screenshot', async ({ page, openGame }) => {
  test.setTimeout(150_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high');
  await toMountain3(page);
  await page.evaluate((z) => window.__TEST__!.teleport(z, 0), t0 - 14);
  await waitTicks(page, 10);
  await page.evaluate(() => window.__TEST__!.resetCameraStats());
  await page.evaluate(([a, b]) => window.__TEST__!.botPath([[0, a], [4, b]]), [t0 + 4, t1 + 10] as const);
  let onIce = false;
  let fastest = 0;
  let calls = 0;
  let shot = false;
  for (let k = 0; k < 300; k++) {
    const s = await testState(page);
    if (s.hero!.z > t0 + 10 && s.hero!.z < t1 - 6) {
      onIce ||= s.fun.slideLeft > 0;
      fastest = Math.max(fastest, s.hero!.vz / s.fun.runSpeed);
      calls = Math.max(calls, (await page.evaluate(() => window.__TEST__!.renderInfo()))!.calls);
      shot ||= s.hero!.z > t0 + 40;
    }
    if ((await page.evaluate(() => window.__TEST__!.botLeft())) === 0) break;
    await waitTicks(page, 2);
  }
  const s = await testState(page);
  expect(s.hero!.z).toBeGreaterThan(t1);
  expect(onIce).toBe(true);
  // × slideMult of the run speed of the moment (the stat grows on the way).
  expect(fastest).toBeGreaterThan(1.4);
  expect(calls).toBeGreaterThan(0);
  expect(calls).toBeLessThanOrEqual(40);
  const st = await page.evaluate(() => window.__TEST__!.cameraStats());
  expect(st.inside, JSON.stringify(st.bad)).toBe(0);
  expect(st.heroNear, JSON.stringify(st.bad)).toBe(0);
  expect(shot).toBe(true);
  // The evidence: standing at the start of the throat, the camera settled behind the hero.
  await page.evaluate((z) => window.__TEST__!.teleport(z, 0), t0 + 6);
  await waitTicks(page, 90);
  await shot1080(page, `${EVIDENCE}/throat_1920x1080_ru.png`, 5);
});

test('mountain 3: the siren at the throat entry — the bot runs it and is in the field grotto before the front', async ({ page, openGame }) => {
  test.setTimeout(150_000);
  await openGame('pace=open');
  await toMountain3(page);
  // At the entry, a running start like a player coming up the slope.
  await page.evaluate((z) => window.__TEST__!.teleport(z, 0), t0 - 6);
  await waitTicks(page, 10);
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await waitTicks(page, 2);
  let s = await testState(page);
  expect(s.wave!.phase).toBe('warn');
  const shelters = await page.evaluate(() => window.__TEST__!.shelters());
  const field = shelters.filter((n) => n.z > t1).sort((a, b) => a.z - b.z)[0]!;
  expect(field.z - t1).toBeLessThanOrEqual(20);
  const start = s.ticks / 60;
  await page.evaluate(([e, mx, mz, ix, iz]) => window.__TEST__!.botPath([[0, e], [mx, mz], [ix, iz]]), [t1 - 2, field.mouth[0], field.mouth[1], field.inside[0], field.inside[1]] as const);
  let inAt = -1;
  for (let k = 0; k < 400 && inAt < 0; k++) {
    s = await testState(page);
    if (s.inShelter) inAt = s.ticks / 60;
    else await waitTicks(page, 2);
  }
  expect(inAt).toBeGreaterThan(0);
  expect(inAt - start).toBeLessThanOrEqual(w3.threat.warnSec * 0.8);
  await page.waitForFunction(() => ['survived', 'caught'].includes(window.__TEST__!.state().wave?.outcome ?? ''), undefined, { timeout: 60_000 });
  expect((await testState(page)).wave!.outcome).toBe('survived');
});
