import type { Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect, testState, waitTicks } from './fixtures.ts';
import { toFirstBase } from './base-route.ts';
import stagesWorlds from '../content/avalanche/pace/stages/worlds.json' with { type: 'json' };

// M6 polish (D-03, «Хрупкое» M6 2): a switch of mountains not by the own portal — a run again from the base and, with no
// base, the summit portal straight to the next mountain — ≤ 1 s at CPU ×4 too: their collision trees are built ahead
// (src/sim/collision.ts, slot 1), as the own mountain's on the base. docs/evidence/M6/switch.txt.
const SWITCH_MS = 1000;
const lines: string[] = [];

async function switchAtCpu4(page: Page, world: number): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const ms = await page.evaluate((n) => {
    const t0 = performance.now();
    window.__TEST__!.gotoWorld(n);
    window.__TEST__!.stepFrames(1);
    return performance.now() - t0;
  }, world);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  return ms;
}

test.afterAll(() => {
  mkdirSync('docs/evidence/M6', { recursive: true });
  writeFileSync('docs/evidence/M6/switch.txt', [`M6 polish · switches not by the own portal at CPU x4, build:e2e, SwiftShader, ${new Date().toISOString()}`, ...lines, ''].join('\n'));
});

test('the base: the passed portal nearest to the hero is built ahead — a run again of mountain 1 ≤ 1 s at CPU ×4', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  await toFirstBase(page, openGame);
  const s = await testState(page);
  const p = s.basePortals.find((b) => b.world === 1)!;
  expect(p.state).toBe('passed');
  await page.evaluate(([z, x]) => window.__TEST__!.teleport(z!, x!), [p.z - 8 * Math.cos(p.yaw), p.x - 8 * Math.sin(p.yaw)]);
  await expect.poll(async () => page.evaluate(() => window.__TEST__!.prebuildReady()), { timeout: 90_000, intervals: [250] }).toBe(true);
  const ms = await switchAtCpu4(page, 1);
  expect(await page.evaluate(() => window.__TEST__!.prebuildReady()), 'the switch took the trees').toBe(false);
  await waitTicks(page, 20);
  expect((await testState(page)).onBase).toBe(false);
  lines.push(`base -> run again of mountain 1 (open), prebuilt: ${ms.toFixed(0)} ms / ${SWITCH_MS}`);
  expect(ms).toBeLessThanOrEqual(SWITCH_MS);
});

test('no base: past half of mountain 1 the next one is built ahead — its summit portal straight to mountain 2 ≤ 1 s at CPU ×4', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  await openGame('pace=stages&quality=high');
  const cold = await switchAtCpu4(page, 3);
  await waitTicks(page, 20);
  await page.evaluate(() => window.__TEST__!.gotoWorld(1));
  await page.evaluate(() => window.__TEST__!.setBaseEnabled(false));
  await waitTicks(page, 20);
  expect(await page.evaluate(() => window.__TEST__!.prebuildReady()), 'nothing ahead in the first half').toBe(false);
  const len = (stagesWorlds as unknown as { worlds: Array<{ length: number }> }).worlds[0]!.length;
  await page.evaluate((z) => {
    window.__TEST__!.holdWave(9000);
    window.__TEST__!.teleport(z);
  }, len * 0.6);
  await expect.poll(async () => page.evaluate(() => window.__TEST__!.prebuildReady()), { timeout: 90_000, intervals: [250] }).toBe(true);
  const ms = await switchAtCpu4(page, 2);
  await waitTicks(page, 20);
  expect((await testState(page)).hero!.z).toBeLessThan(60);
  lines.push(`no base: mountain 1 -> 2 (stages), prebuilt: ${ms.toFixed(0)} ms / ${SWITCH_MS}; without the prebuild (-> 3): ${cold.toFixed(0)} ms`);
  expect(ms).toBeLessThanOrEqual(SWITCH_MS);
});
