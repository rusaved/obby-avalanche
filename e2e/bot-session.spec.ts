import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, testState, waitTicks } from './fixtures.ts';
import { STAGES, flagOf, ready, threshold } from './lv-stage-data.ts';
import { intoPortal } from './base-route.ts';
import { mazeDistances } from '../src/level/stage-slope.ts';
import type { WorldStage } from '../src/content/types.ts';

// M6-03 (docs/03-yandex-compliance.md 7.1.7; docs/05 section 4): a bot session of 10 minutes of game time
// (setTimeScale(20)) with a seed on the release pace: every stage of mountain 1 by the line of its trial (as lv-types),
// the summit with «▶ Ad: ×2 chest» and «Next», the base, its portal, on up mountain 2 until 600 game seconds; a pause
// (the fullscreen ad of the pause) every 150 game seconds. Zero console errors and page errors and no broken SDK limit
// (the fixture), no frozen state: after every window and ad the game runs on and the hero moves.
// Where the bot's Speed is short of a ridge it gets it as from the finish treadmills (setStat) — counted in the report.
const SCALE = 20;
const GAME_SEC = 600;
const PAUSE_EVERY = 150;
const REPORT = 'docs/evidence/M6/bot-session.txt';
type Seg = { type: string; z: number; [k: string]: unknown };

function legs(world: number, st: WorldStage): Array<[number, number]> {
  const segs = STAGES[world - 1]!.segments as Seg[];
  const narrow = segs
    .filter((f) => f.type === 'floor' && f['material'] !== 'pit' && f.z >= st.start - 1e-6 && f.z < st.end && (f['length'] as number) > 12 && (f['x1'] as number) - (f['x0'] as number) <= 12)
    .sort((a, b) => a.z - b.z);
  const pts: Array<[number, number]> = [];
  for (const f of narrow) {
    const mid = ((f['x0'] as number) + (f['x1'] as number)) / 2;
    pts.push([mid, f.z + 3], [mid, f.z + (f['length'] as number) - 3]);
  }
  return [...pts, [0, st.end + 6]];
}
function mazeRoute(st: WorldStage): Array<[number, number]> {
  const m = st.maze!;
  const dist = mazeDistances(m.cols, m.rows, m.open, m.entrance);
  const centre = (i: number): [number, number] => [m.x0 + ((i % m.cols) + 0.5) * m.cell, m.z0 + (Math.floor(i / m.cols) + 0.5) * m.cell];
  const linked = (i: number, j: number): boolean => m.open.some(([c, r, a, b]) => (r * m.cols + c === i && b * m.cols + a === j) || (r * m.cols + c === j && b * m.cols + a === i));
  const real = m.exits.find((e) => e.real)!;
  const path = [real.row * m.cols + real.col];
  while (dist[path[0]!]! > 0) path.unshift(dist.findIndex((d, j) => d === dist[path[0]!]! - 1 && linked(path[0]!, j)));
  const [ex] = centre(path[path.length - 1]!);
  return [[m.x0 + (m.entrance + 0.5) * m.cell, m.z0 - 3], ...path.map(centre), [ex, st.end + 6]];
}
const pathOf = (world: number, st: WorldStage): Array<[number, number]> =>
  st.type === 'maze'
    ? mazeRoute(st)
    : st.type === 'throat' || st.type === 'blizzard' || st.type === 'plates' || st.type === 'chute'
      ? legs(world, st)
      : st.type === 'giant'
        ? [[40, st.start + 20], [40, st.end - 10], [0, st.end + 6]]
        : [[0, st.end + 6]];

const log: string[] = [];
const counts = { stages: 0, boosts: 0, rollBacks: 0, skips: 0, pauses: 0, rewarded: 0, windows: 0 };
const gameSec = async (page: Page): Promise<number> => (await testState(page)).ticks / 60;

/** The game runs on and the hero moves: ticks go, no pause reason, the hero ahead by the bot (no frozen state). */
async function runsOn(page: Page, what: string): Promise<void> {
  await expect.poll(async () => (await testState(page)).pauseReasons, { message: `${what}: pause reasons`, timeout: 30_000 }).toEqual([]);
  const s0 = await testState(page);
  await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z + 6]]), [s0.hero!.x, s0.hero!.z] as const);
  await expect.poll(async () => {
    const s = await testState(page);
    return s.ticks > s0.ticks + 10 && Math.hypot(s.hero!.x - s0.hero!.x, s.hero!.z - s0.hero!.z) > 0.5;
  }, { message: `${what}: the hero moves`, timeout: 30_000 }).toBe(true);
  await page.evaluate(() => window.__TEST__!.botPath(null));
}

/** The pause by its button: the fullscreen ad of the pause (when its time is), then on. */
async function pauseAndBack(page: Page): Promise<void> {
  const before = await page.evaluate(() => window.__YA_MOCK__!.calls.filter((c) => c.name === 'adv.showFullscreenAdv').length);
  await page.evaluate(() => window.__TEST__!.openMenu(true));
  await expect.poll(async () => (await testState(page)).menuOpen, { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__TEST__!.openMenu(false));
  const after = await page.evaluate(() => window.__YA_MOCK__!.calls.filter((c) => c.name === 'adv.showFullscreenAdv').length);
  counts.pauses++;
  log.push(`${(await gameSec(page)).toFixed(0)} s: pause, fullscreen ads ${after - before}`);
  await runsOn(page, 'after the pause');
}

async function pass(page: Page, world: number, st: WorldStage): Promise<void> {
  const f = flagOf(world, st);
  const s0 = await testState(page);
  if (Math.abs(s0.hero!.z - f.z) > 12) await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y + 0.5), [f.z, f.y] as const);
  if (s0.stat < threshold(st.level)) {
    counts.boosts++;
    await page.evaluate((s) => window.__TEST__!.setStat(s), threshold(st.level) * 1.01);
  }
  await waitTicks(page, 10);
  const roll0 = (await testState(page)).rollFrom;
  await page.evaluate((on) => window.__TEST__!.botJump(on), st.type !== 'catapult');
  await page.evaluate((p) => window.__TEST__!.botPath(p), pathOf(world, st));
  if (st.type === 'avalanche') {
    // The wave of the stage comes on entering it; if the bot's run already let it go by, the next one is called.
    const warned = await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'warn', undefined, { timeout: 30_000 }).then(() => true, () => false);
    if (!warned) {
      log.push(`${(await gameSec(page)).toFixed(0)} s: no wave on the avalanche stage in 30 s of real time — called (triggerWave)`);
      await page.evaluate(() => window.__TEST__!.triggerWave());
      await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'warn', undefined, { timeout: 30_000 });
    }
    const sh = await page.evaluate(() => window.__TEST__!.shelters()[window.__TEST__!.state().wave!.shelter]!);
    await page.evaluate((p) => window.__TEST__!.botPath(p), [[sh.mouth[0], sh.mouth[1]], [sh.inside[0], sh.inside[1]]] as Array<[number, number]>);
    await page.waitForFunction(() => ['gone', 'idle'].includes(window.__TEST__!.state().wave?.phase ?? 'idle'), undefined, { timeout: 90_000 });
    const [ox, oz] = [sh.mouth[0] - sh.inside[0], sh.mouth[1] - sh.inside[1]];
    const ol = Math.hypot(ox, oz) || 1;
    const out: [number, number] = [sh.mouth[0] + (ox / ol) * 4, sh.mouth[1] + (oz / ol) * 4];
    await page.evaluate(([o, z]) => window.__TEST__!.botPath([o, [0, o[1]], [0, z]]), [out, st.end + 6] as const);
  }
  await page.waitForFunction(
    ([z, r]) => {
      const s = window.__TEST__!.state();
      return s.hero!.z > z || s.rollFrom !== r || !!s.caught;
    },
    [st.end + 1, roll0] as const,
    { timeout: 120_000 },
  );
  const s = await testState(page);
  const how = s.caught ? 'caught' : s.rollFrom !== roll0 ? 'rolled back' : 'passed';
  if (how !== 'passed') counts.rollBacks++;
  counts.stages++;
  log.push(`${(s.ticks / 60).toFixed(0)} s: mountain ${world} stage ${st.n} (${st.type}) ${how}`);
  await page.evaluate(() => window.__TEST__!.botPath(null));
  if (how !== 'passed') {
    // Caught or rolled back (the giant, a fall): the game takes the hero back and gives the control again; the bot then
    // goes on past the stage (the level of mountain 1 waits for the producer, Q-M5-2) — counted as a skip.
    await expect.poll(async () => !!(await testState(page)).caught, { timeout: 30_000 }).toBe(false);
    await runsOn(page, `after «${how}» on stage ${st.n}`);
    counts.skips++;
    await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y + 0.5), [st.end + 6, st.y] as const);
  }
}

test('@full M6-03 bot session: 10 minutes of game time, seed 7, release pace — no errors, SDK limits kept, nothing frozen, the summit of mountain 1', async ({ page, openGame }) => {
  test.setTimeout(1_200_000);
  mkdirSync('docs/evidence/M6', { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await openGame('pace=stages&seed=7');
  await waitTicks(page, 10);
  await ready(page);
  await page.evaluate((k) => window.__TEST__!.setTimeScale(k), SCALE);
  let nextPause = PAUSE_EVERY;
  const maybePause = async (): Promise<void> => {
    if ((await gameSec(page)) >= nextPause) {
      nextPause += PAUSE_EVERY;
      await pauseAndBack(page);
    }
  };
  // Mountain 1, every stage.
  const W1 = STAGES[0]!;
  for (const st of W1.stages) {
    await pass(page, 1, st);
    await maybePause();
  }
  // Up to the portal of the summit: the window, «▶ Ad: ×2 chest», «Next» — the base.
  const portal = W1.segments.find((x) => x.type === 'portal')!;
  await page.evaluate((z) => window.__TEST__!.botPath([[0, z + 2]]), portal.z);
  await page.waitForFunction(() => window.__TEST__!.state().window === 'summit', undefined, { timeout: 120_000 });
  const summitSec = await gameSec(page);
  log.push(`${summitSec.toFixed(0)} s: the summit of mountain 1`);
  counts.windows++;
  const ad = page.locator('[data-hud="summit-ad"]');
  if (await ad.isVisible()) {
    await ad.click();
    counts.rewarded++;
    await page.waitForTimeout(1500);
  }
  await page.locator('[data-hud="win-next"]').click();
  await page.waitForFunction(() => window.__TEST__!.state().onBase || window.__TEST__!.state().world !== 'base', undefined, { timeout: 60_000 });
  // The first base says «This is your base»; any window on the way — closed.
  for (let i = 0; i < 3 && (await testState(page)).window; i++) {
    counts.windows++;
    await page.locator('[data-hud="win-close"]').click({ timeout: 5000 }).catch(() => undefined);
    await waitTicks(page, 5);
  }
  await runsOn(page, 'after the summit');
  if ((await testState(page)).onBase) {
    log.push(`${(await gameSec(page)).toFixed(0)} s: the base`);
    await intoPortal(page, 2);
  }
  await waitTicks(page, 20);
  // Mountain 2 until 10 minutes of game time.
  const W2 = STAGES[1]!;
  for (const st of W2.stages) {
    if ((await gameSec(page)) >= GAME_SEC) break;
    await pass(page, 2, st);
    await maybePause();
  }
  const s = await testState(page);
  const mock = await page.evaluate(() => ({ violations: window.__YA_MOCK__!.violations.length, fullscreen: window.__YA_MOCK__!.calls.filter((c) => c.name === 'adv.showFullscreenAdv').length, rewarded: window.__YA_MOCK__!.calls.filter((c) => c.name === 'adv.showRewardedVideo').length }));
  writeFileSync(
    REPORT,
    [
      `M6-03 · bot session, seed 7, pace stages, setTimeScale(${SCALE}), build:e2e, ${new Date().toISOString()}`,
      `game time ${(s.ticks / 60).toFixed(0)} s (goal ${GAME_SEC}); the summit of mountain 1 at ${summitSec.toFixed(0)} s`,
      `stages ${counts.stages}, caught or rolled back ${counts.rollBacks} (then put past the stage ${counts.skips}), Speed given as from a treadmill ${counts.boosts} times; pauses ${counts.pauses}, windows ${counts.windows}, rewarded pressed ${counts.rewarded}`,
      `SDK mock: violations ${mock.violations}, fullscreen ads ${mock.fullscreen}, rewarded ${mock.rewarded}; console errors and page errors — the fixture (0, or the test fails)`,
      '',
      ...log,
      '',
    ].join('\n'),
  );
  expect(mock.violations).toBe(0);
  expect(s.ticks / 60).toBeGreaterThanOrEqual(GAME_SEC);
  await runsOn(page, 'at the end');
});
