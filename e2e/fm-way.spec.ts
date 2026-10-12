import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };

// FM-02 (docs/01-gdd.md 19.8; docs/01a-content.md 18.6): where to run. The summit portal is filled with light under a
// pillar of light seen from the start of the finish straight; a bot running straight up 10 units off the middle goes
// into it without a stop; 3 arrows on the snow lead into the throat of mountain 3 (after ridge 1) and of mountain 9
// (after ridge 3) — the bot along them passes the throat with no stop longer than 3 s; draw calls there ≤ 40.
type Seg = { type: string; z: number; kind?: string; length?: number; passLength?: number; section?: number };
type OpenWorld = { length: number; segments: Seg[]; bosses: Array<{ zone: [number, number] }> };
const worlds = (openWorlds as unknown as { worlds: OpenWorld[] }).worlds;
const EVIDENCE = 'docs/evidence/fm';
const CALLS = 40;

async function pastScriptedWave(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
}

async function start(page: Page, openGame: (q?: string) => Promise<void>, mountain: number, quality = 'quality=high'): Promise<void> {
  await openGame(`pace=open&${quality}`);
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await pastScriptedWave(page);
  if (mountain > 1) {
    await page.evaluate((i) => window.__TEST__!.gotoWorld(i), mountain);
    await waitTicks(page, 20);
  }
  await page.evaluate(() => {
    window.__TEST__!.holdWave(600);
    window.__TEST__!.setStat(1e12);
  });
}

/** Runs the bot path to its end; returns the longest stand (ticks with the hero slower than 2 units/s in a row). */
async function run(page: Page, path: Array<[number, number]>, until: () => Promise<boolean>, maxTicks = 1800): Promise<number> {
  await page.evaluate((p) => window.__TEST__!.botPath(p), path);
  let stand = 0;
  let longest = 0;
  let last = (await testState(page)).ticks;
  for (let t = 0; t < maxTicks; ) {
    await waitTicks(page, 3);
    const s = await testState(page);
    const dt = s.ticks - last;
    last = s.ticks;
    t += dt;
    expect(s.respawning).toBe(false);
    stand = s.hero!.speed < 2 ? stand + dt : 0;
    longest = Math.max(longest, stand);
    if (await until()) break;
  }
  return longest;
}

for (const x of [-10, 10]) {
  test(`mountain 1: straight up ${x} off the middle from the giant's line — into the portal without a stop`, async ({ page, openGame }) => {
    test.setTimeout(150_000);
    await start(page, openGame, 1);
    const w = worlds[0]!;
    const portal = w.segments.find((s) => s.type === 'portal')!;
    const line = w.bosses[0]!.zone[1];
    await page.evaluate(([zz, xx]) => window.__TEST__!.teleport(zz, xx), [line + 2, x] as const);
    await waitTicks(page, 10);
    const entered = (): Promise<boolean> => page.evaluate(() => window.__TEST__!.simEvents.some((e) => e.name === 'portal'));
    const longest = await run(page, [[x, portal.z + 10]], entered, 600);
    expect(await entered(), 'portal entered').toBe(true);
    expect(longest, 'longest stand, ticks').toBeLessThan(10);
  });
}

test('mountain 1: the pillar of light in the frame from the start of the finish straight; draw calls at the summit; screenshot', async ({ page, openGame }) => {
  test.setTimeout(150_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await start(page, openGame, 1);
  const w = worlds[0]!;
  const ridges = w.segments.filter((s) => s.type === 'gate' && s.kind === 'ridge');
  const last = ridges[ridges.length - 1]!;
  const { marks, pillar } = await page.evaluate(() => window.__TEST__!.wayMarks());
  expect(pillar).not.toBeNull();
  expect(pillar!.y1 - pillar!.y0).toBe(30);
  expect(marks.filter((m) => m.to === 'portal')).toHaveLength(3);
  await page.evaluate((zz) => window.__TEST__!.teleport(zz, 0), last.z + (last.passLength ?? 0) + 2);
  await waitTicks(page, 60);
  const s = await testState(page);
  const field = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const p = await page.evaluate((q) => window.__TEST__!.project(q.x, (q.y0 + q.y1) / 2, q.z), pillar!);
  expect(p.ahead, `hero at z ${s.hero!.z}`).toBe(true);
  expect(p.x).toBeGreaterThan(0);
  expect(p.x).toBeLessThan(field.w);
  expect(p.y).toBeGreaterThan(0);
  expect(p.y).toBeLessThan(field.h);
  await page.evaluate((zz) => window.__TEST__!.teleport(zz, 0), w.bosses[0]!.zone[1] + 4);
  await waitTicks(page, 30);
  const info = (await page.evaluate(() => window.__TEST__!.renderInfo()))!;
  expect(info.calls, JSON.stringify(await page.evaluate(() => window.__TEST__!.drawList()))).toBeLessThanOrEqual(CALLS);
  await shot1080(page, `${EVIDENCE}/portal_glow_1920x1080_ru.png`, 10);
});

for (const [mountain, ridgeNo] of [
  [3, 1],
  [9, 3],
] as const) {
  test(`mountain ${mountain}: after ridge ${ridgeNo} along the arrows through the throat — no stand longer than 3 s; draw calls ≤ ${CALLS}`, async ({ page, openGame }) => {
    test.setTimeout(180_000);
    await start(page, openGame, mountain);
    const w = worlds[mountain - 1]!;
    const ridge = w.segments.filter((s) => s.type === 'gate' && s.kind === 'ridge')[ridgeNo - 1]!;
    const throat = w.segments.find((s) => s.type === 'throat' && s.z > ridge.z)!;
    const { marks } = await page.evaluate(() => window.__TEST__!.wayMarks());
    const arrows = marks.filter((m) => m.to === 'throat' && m.z > ridge.z && m.z < throat.z + 20).sort((a, b) => a.z - b.z);
    expect(arrows).toHaveLength(3);
    // Out of the side passage of the ridge, as a player who came up that lane.
    const z0 = ridge.z + (ridge.passLength ?? 0) + 1;
    await page.evaluate(([zz, xx]) => window.__TEST__!.teleport(zz, xx), [z0, 18] as const);
    await waitTicks(page, 30);
    const info = (await page.evaluate(() => window.__TEST__!.renderInfo()))!;
    expect(info.calls, JSON.stringify(await page.evaluate(() => window.__TEST__!.drawList()))).toBeLessThanOrEqual(CALLS);
    const end = throat.z + throat.length! + 10;
    const past = (): Promise<boolean> => page.evaluate((e) => window.__TEST__!.state().hero!.z > e, end - 1);
    const path: Array<[number, number]> = [...arrows.map((a) => [a.x, a.z] as [number, number]), [arrows[0]!.x, end]];
    const longest = await run(page, path, past);
    expect(await past(), 'through the throat').toBe(true);
    expect(longest, 'longest stand, ticks').toBeLessThanOrEqual(180);
  });
}
