import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { forkLaneX } from './base-route.ts';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };
import openSpec from '../content/avalanche/pace/open/worlds-spec.json' with { type: 'json' };
import ru from '../content/avalanche/i18n/ru.json' with { type: 'json' };

// RG-06: the tunnel of mountain 6 (docs/01-gdd.md 18.3; docs/01a-content.md 17.2). The avalanche passes over the hero in
// the tunnel; on the open lane he hides in a grotto; the camera inside never in the roof nor in the hero; ≤ 40 draw
// calls; «The tunnel shelters you» once.
type Seg = { type: string; z: number; y?: number; length?: number; section?: number; side?: string; inner?: number; width?: number; height?: number; bold?: string; kind?: string; between?: number; track?: number };
const w6 = (openWorlds as unknown as { worlds: Array<{ segments: Seg[]; threat: { warnSec: number } }> }).worlds[5]!;
const tunnel = w6.segments.find((s) => s.type === 'tunnel' && s.section === 2)!;
const fork = w6.segments.find((s) => s.type === 'fork' && s.section === 2)!;
const sc = tunnel.side === 'left' ? -1 : 1;
const hallX = sc * (tunnel.inner! + tunnel.width! / 2);
const boldX = -sc * forkLaneX(fork);
const roofY = tunnel.y! + tunnel.height!;
const STAT = (openSpec as unknown as { mountains: Array<{ ridges: Array<{ requires: number }> }> }).mountains[5]!.ridges[0]!.requires;
const EVIDENCE = 'docs/evidence/rg';

async function toMountain6(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  await page.evaluate(() => window.__TEST__!.gotoWorld(6));
  await waitTicks(page, 20);
  await page.evaluate((st) => {
    window.__TEST__!.holdWave(120);
    window.__TEST__!.setStat(st);
  }, STAT);
}

async function waitOutcome(page: Page): Promise<string> {
  await page.waitForFunction(() => ['survived', 'caught'].includes(window.__TEST__!.state().wave?.outcome ?? ''), undefined, { timeout: 60_000 });
  return (await testState(page)).wave!.outcome;
}

test('mountain 6: through the tunnel — the camera keeps under its roof and off the hero, ≤ 40 draw calls, the toast once; screenshot', async ({ page, openGame }) => {
  test.setTimeout(150_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high');
  await toMountain6(page);
  await page.evaluate(([x, z]) => window.__TEST__!.teleport(z, x), [hallX, tunnel.z - 12] as const);
  await waitTicks(page, 30);
  await page.evaluate(() => window.__TEST__!.resetCameraStats());
  await page.evaluate(([x, a, b]) => window.__TEST__!.botPath([[x, a], [x, b]]), [hallX, tunnel.z + 2, tunnel.z + tunnel.length! + 6] as const);
  const toasts: string[] = [];
  let calls = 0;
  let above = 0;
  let inside = 0;
  for (let k = 0; k < 300; k++) {
    const s = await testState(page);
    if (s.waveHud.toast && !toasts.includes(s.waveHud.toast)) toasts.push(s.waveHud.toast);
    if (s.inShelter && s.hero!.z > tunnel.z + 4 && s.hero!.z < tunnel.z + tunnel.length! - 4) {
      inside++;
      const cam = await page.evaluate(() => window.__TEST__!.cameraPos());
      // Under the roof while the camera is over the hall (behind him in it).
      if (Math.abs(cam[0] - hallX) < tunnel.width! / 2 && cam[2] > tunnel.z && cam[2] < tunnel.z + tunnel.length! && cam[1] > roofY) above++;
      calls = Math.max(calls, (await page.evaluate(() => window.__TEST__!.renderInfo()))!.calls);
    }
    if ((await page.evaluate(() => window.__TEST__!.botLeft())) === 0) break;
    await waitTicks(page, 2);
  }
  expect(inside).toBeGreaterThan(5);
  expect(above).toBe(0);
  expect(calls).toBeGreaterThan(0);
  expect(calls).toBeLessThanOrEqual(40);
  const st = await page.evaluate(() => window.__TEST__!.cameraStats());
  expect(st.inside, JSON.stringify(st.bad)).toBe(0);
  expect(st.heroNear, JSON.stringify(st.bad)).toBe(0);
  expect(toasts).toContain(ru['toast.tunnel']);
  // In again: no toast (once a save).
  await page.waitForFunction((w) => window.__TEST__!.state().waveHud.toast !== w, ru['toast.tunnel'], { timeout: 30_000 });
  await page.evaluate(([x, z]) => window.__TEST__!.teleport(z, x), [hallX, tunnel.z - 8] as const);
  await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z]]), [hallX, tunnel.z + 20] as const);
  await waitTicks(page, 60);
  expect((await testState(page)).waveHud.toast).not.toBe(ru['toast.tunnel']);
  await page.evaluate(([x, z]) => window.__TEST__!.teleport(z, x), [hallX, tunnel.z + 24] as const);
  await waitTicks(page, 90);
  await shot1080(page, `${EVIDENCE}/tunnel_1920x1080_ru.png`, 5);
});

test('mountain 6: the avalanche passes over the hero in the tunnel; on the open lane he hides in a grotto', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await openGame('pace=open');
  await toMountain6(page);
  // In the tunnel, standing: the front passes over.
  await page.evaluate(([x, z]) => window.__TEST__!.teleport(z, x), [hallX, tunnel.z + tunnel.length! / 2] as const);
  await waitTicks(page, 20);
  expect((await testState(page)).inShelter).toBe(true);
  await page.evaluate(() => window.__TEST__!.triggerWave());
  expect(await waitOutcome(page)).toBe('survived');
  expect((await testState(page)).caught).toBeFalsy();
  await page.waitForFunction(() => ['idle', 'gone'].includes(window.__TEST__!.state().wave?.phase ?? ''), undefined, { timeout: 60_000 });
  // On the open lane across the cliff: to the lit grotto of that lane.
  await page.evaluate(() => window.__TEST__!.holdWave(0));
  await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(([x, z]) => {
    window.__TEST__!.teleport(z, x);
    window.__TEST__!.triggerWave();
  }, [boldX, fork.z + 20] as const);
  await waitTicks(page, 2);
  const s = await testState(page);
  const lit = (await page.evaluate(() => window.__TEST__!.shelters()))[s.wave!.shelter]!;
  // A grotto at the edge of the open lane — the one with the chest too (SP-05: it stands inside the split fork).
  expect(['grotto', 'chestGrotto']).toContain(lit.kind);
  expect(Math.sign(lit.mouth[0])).toBe(Math.sign(boldX));
  await page.evaluate(([mx, mz, ix, iz]) => window.__TEST__!.botPath([[mx, mz], [ix, iz]]), [lit.mouth[0], lit.mouth[1], lit.inside[0], lit.inside[1]] as const);
  expect(await waitOutcome(page)).toBe('survived');
});
