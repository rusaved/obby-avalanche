import type { Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };

// FM-03 (docs/01-gdd.md 19.8; playtest RG: camera 2 points). Runs of the physical bot: mountain 1 foot → summit,
// mountain 3 through the throat, mountain 9 section 3 — frames where the line camera → hero's head meets something
// drawn and opaque (wall, closed gate, sign, giant) ≤ 2%; in the giant's zone of mountain 1 running up the giant is in
// the frame ≥ 90% of the frames; a turn by hand in the zone is the player's.
type Seg = { type: string; z: number; kind?: string; length?: number; passLength?: number; side?: string; inner?: number; width?: number };
type OpenWorld = { length: number; segments: Seg[]; bosses: Array<{ zone: [number, number]; requires: number }> };
const worlds = (openWorlds as unknown as { worlds: OpenWorld[] }).worlds;
const EVIDENCE = 'docs/evidence/fm';
const SHARE = 0.02;

async function pastScriptedWave(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
}

async function start(page: Page, openGame: (q?: string) => Promise<void>, mountain: number, stat: number): Promise<void> {
  await openGame('pace=open');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await pastScriptedWave(page);
  if (mountain > 1) {
    await page.evaluate((i) => window.__TEST__!.gotoWorld(i), mountain);
    await waitTicks(page, 20);
  }
  await page.evaluate((s) => {
    window.__TEST__!.holdWave(900);
    window.__TEST__!.setStat(s);
  }, stat);
}

/** The bot along `path` from its first point; camera stats of the run. */
async function run(page: Page, path: Array<[number, number]>, maxTicks = 7200): Promise<ReturnType<NonNullable<Window['__TEST__']>['cameraStats']>> {
  await page.evaluate(([z, x]) => window.__TEST__!.teleport(z, x), [path[0]![1], path[0]![0]] as const);
  await waitTicks(page, 30);
  await page.evaluate(() => window.__TEST__!.resetCameraStats());
  await page.evaluate((p) => window.__TEST__!.botPath(p), path.slice(1));
  const t0 = (await testState(page)).ticks;
  await page.waitForFunction((t) => window.__TEST__!.botLeft() === 0 || window.__TEST__!.state().ticks > t, t0 + maxTicks, { timeout: 280_000, polling: 250 });
  return page.evaluate(() => window.__TEST__!.cameraStats());
}

// One worker for all runs: the report below gathers their rows.
test.describe.configure({ mode: 'serial' });
const report: string[] = [];
const row = (name: string, s: { headFrames: number; headBlocked: number; headBy: Record<string, number>; bossFrames: number; bossSeen: number }): string =>
  `| ${name} | ${s.headFrames} | ${s.headBlocked} (${((100 * s.headBlocked) / Math.max(1, s.headFrames)).toFixed(2)}%) | ${JSON.stringify(s.headBy)} | ${s.bossFrames ? `${s.bossSeen}/${s.bossFrames} (${((100 * s.bossSeen) / s.bossFrames).toFixed(1)}%)` : '—'} |`;

test.afterAll(() => {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(`${EVIDENCE}/camera.md`, ['# Камера: помехи и великан (FM-03)', '', '| Прогон | Кадров | Голова заслонена | Чем | Великан в кадре |', '|---|---|---|---|---|', ...report, ''].join('\n'));
});

test('mountain 1 foot → summit: the head is behind something opaque in ≤ 2% of the frames, the giant in the frame ≥ 90%; screenshot', async ({ page, openGame }) => {
  test.setTimeout(300_000);
  const w = worlds[0]!;
  await start(page, openGame, 1, w.bosses[0]!.requires * 1.3);
  const fork = w.segments.find((s) => s.type === 'fork')!;
  const portal = w.segments.find((s) => s.type === 'portal')!;
  const s = await run(page, [[0, 24], [0, fork.z - 8], [-16, fork.z + 4], [-16, fork.z + fork.length! - 2], [0, fork.z + fork.length! + 10], [0, portal.z - 6]]);
  report.push(row('гора 1, подножие → вершина', s));
  expect(s.headFrames).toBeGreaterThan(300);
  expect(s.headBlocked / s.headFrames, JSON.stringify(s)).toBeLessThanOrEqual(SHARE);
  expect(s.bossFrames).toBeGreaterThan(8);
  expect(s.bossSeen / s.bossFrames, JSON.stringify(s)).toBeGreaterThanOrEqual(0.9);
});

test('mountain 1, the giant’s zone: a turn by hand is the player’s; screenshot of the giant in the frame', async ({ page, openGame }) => {
  test.setTimeout(150_000);
  mkdirSync(EVIDENCE, { recursive: true });
  const w = worlds[0]!;
  const zone = w.bosses[0]!.zone;
  await start(page, openGame, 1, w.bosses[0]!.requires * 1.3);
  await page.evaluate(([z]) => window.__TEST__!.teleport(z!, -14), [zone[0] + 6] as const);
  await waitTicks(page, 30);
  await page.evaluate(() => window.__TEST__!.resetCameraStats());
  await page.evaluate((z) => window.__TEST__!.botPath([[-14, z]]), zone[1] - 30);
  await waitTicks(page, 90);
  const s = await page.evaluate(() => window.__TEST__!.cameraStats());
  report.push(row('гора 1, зона великана по полосе x = −14', s));
  expect(s.bossFrames).toBeGreaterThan(8);
  expect(s.bossSeen / s.bossFrames, JSON.stringify(s)).toBeGreaterThanOrEqual(0.9);
  await shot1080(page, `${EVIDENCE}/camera_giant_1920x1080_ru.png`, 3);
  // The player turns the camera by hand (a drag): the view stays where he turned it.
  const yaw0 = (await testState(page)).viewYaw;
  await page.mouse.move(480, 300);
  await page.mouse.down();
  await page.mouse.move(220, 300, { steps: 8 });
  await page.mouse.up();
  await waitTicks(page, 20);
  const yaw1 = (await testState(page)).viewYaw;
  await waitTicks(page, 60);
  const yaw2 = (await testState(page)).viewYaw;
  expect(Math.abs(yaw1 - yaw0)).toBeGreaterThan(0.5);
  expect(Math.abs(yaw2 - yaw1), 'the camera keeps the turn by hand').toBeLessThan(0.05);
});

test('mountain 3 through the throat: the head is behind something opaque in ≤ 2% of the frames', async ({ page, openGame }) => {
  test.setTimeout(300_000);
  const w = worlds[2]!;
  const ridge = w.segments.filter((s) => s.type === 'gate' && s.kind === 'ridge')[0]! as Seg & { requires: number };
  await start(page, openGame, 3, ridge.requires * 1.2);
  const throat = w.segments.find((s) => s.type === 'throat' && s.z > ridge.z)!;
  const s = await run(page, [[18, ridge.z - 30], [18, ridge.z + (ridge.passLength ?? 0) + 1], [0, throat.z + 4], [0, throat.z + throat.length! + 30]]);
  report.push(row('гора 3, теснина', s));
  expect(s.headFrames).toBeGreaterThan(30);
  expect(s.headBlocked / s.headFrames, JSON.stringify(s)).toBeLessThanOrEqual(SHARE);
});

test('mountain 9, section 3: the head is behind something opaque in ≤ 2% of the frames', async ({ page, openGame }) => {
  test.setTimeout(300_000);
  const w = worlds[8]!;
  const ridges = w.segments.filter((s) => s.type === 'gate' && s.kind === 'ridge') as Array<Seg & { requires: number }>;
  await start(page, openGame, 9, ridges[1]!.requires * 1.2);
  const z0 = ridges[1]!.z + (ridges[1]!.passLength ?? 0) + 2;
  const z1 = ridges[2]!.z - 4;
  const tunnel = w.segments.find((s) => s.type === 'tunnel' && s.z > z0 && s.z < z1)!;
  const sign = tunnel.side === 'left' ? -1 : 1;
  const hall = sign * (tunnel.inner! + tunnel.width! / 2);
  const s = await run(page, [[0, z0], [0, tunnel.z - 30], [hall, tunnel.z - 6], [hall, tunnel.z + tunnel.length! + 4], [0, tunnel.z + tunnel.length! + 20], [0, z1]]);
  report.push(row('гора 9, участок 3', s));
  expect(s.headFrames).toBeGreaterThan(100);
  expect(s.headBlocked / s.headFrames, JSON.stringify(s)).toBeLessThanOrEqual(SHARE);
});
