import type { Page } from '@playwright/test';
import { test, expect, testState, waitReady, waitTicks } from './fixtures.ts';
import classicWorlds from '../content/avalanche/worlds.json' with { type: 'json' };
import fastWorlds from '../content/avalanche/pace/fast/worlds.json' with { type: 'json' };
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };
import stagesWorlds from '../content/avalanche/pace/stages/worlds.json' with { type: 'json' };
/** LV (15.10, docs/01-gdd.md 22.1): mountain 1 of the default pace. */
const STAGES_W = (stagesWorlds as unknown as { worlds: Array<{ width: number; wallCount: number }> }).worlds[0]!;

// PR-01, PS-02: the pace flag (docs/01-gdd.md 16.1, 17.1). Without ?pace — game.json `pace` (open: ridge 50 first on
// mountain 1, the slope as wide as its data), ?pace=fast — 15 gates, ?pace=classic — the M3 game (12 walls); each pace keeps its own
// progress: classic at the root of the save as before, fast and open in their own slots; F5 brings each to its own flag.
type Seg = { type: string; z: number; requires?: number };
const gateSegs = (w: unknown): Seg[] => (w as { worlds: Array<{ segments: Seg[] }> }).worlds[0]!.segments.filter((s) => s.type === 'gate');
const gatesOf = (w: unknown): number[] => gateSegs(w).map((s) => s.z);
const classicGates = gatesOf(classicWorlds);
const fastGates = gatesOf(fastWorlds);
const openGates = gatesOf(openWorlds);
/** Gate 2 of fast after sim:balance --fit (PR-10): the stat that opens it comes from the data. */
const fastGate2 = gateSegs(fastWorlds)[1]!.requires!;

async function open(page: Page, query: string): Promise<void> {
  await page.goto(query ? `/?${query}` : '/');
  await waitReady(page);
  await waitTicks(page, 2);
}

/** Opens the gates up to `wall` with the stat and walks the hero through gate `wall` (frontier = wall). */
async function passGate(page: Page, gates: number[], wall: number, stat: number): Promise<void> {
  await page.evaluate(
    ([z, s]) => {
      window.__TEST__!.setStat(s);
      window.__TEST__!.teleport(z);
      window.__TEST__!.setAutoRun(true);
    },
    [gates[wall - 1]! - 4, stat] as const,
  );
  await page.waitForFunction((i) => window.__TEST__!.state().gatesPassed[i] === true, wall - 1, { timeout: 30_000 });
  await page.evaluate(() => window.__TEST__!.setAutoRun(false));
  await waitTicks(page, 30);
}

test('without ?pace the pace of game.json (stages since LV: ridge 1 asks for level 2); ?pace=fast — 15 gates; ?pace=classic — 12 walls; unknown pace — game.json', async ({ page, openGame }) => {
  await open(page, '');
  let s = await testState(page);
  expect(s.pace).toBe('stages');
  expect(s.world).toBe('slope');
  expect(s.width).toBe(STAGES_W.width);
  expect(s.gatesOpen).toHaveLength(STAGES_W.wallCount);
  expect((await page.evaluate(() => window.__TEST__!.gateSign(0))).text).toBe('2');
  void openWorlds;

  await open(page, 'pace=fast');
  s = await testState(page);
  expect(s.pace).toBe('fast');
  expect(s.width).toBe(28);
  expect(s.gatesOpen).toHaveLength(15);
  await expect(page.locator('.hud-mountain-label')).toHaveText('Гора 1 · 0/15');

  await openGame();
  s = await testState(page);
  expect(s.pace).toBe('classic');
  expect(s.gatesOpen).toHaveLength(12);
  await expect(page.locator('.hud-mountain-label')).toHaveText('Гора 1 · 0/12');

  await open(page, 'pace=nope');
  s = await testState(page);
  expect(s.pace).toBe('stages');
  expect(s.gatesOpen).toHaveLength(STAGES_W.wallCount);
});

test('separate saves: classic progress (wall 3) is not seen in fast and not erased by it; F5 brings each pace to its flag', async ({ page }) => {
  test.setTimeout(120_000);
  // Classic: past wall 3, F5 — at its flag.
  await open(page, 'pace=classic');
  await passGate(page, classicGates, 3, 100);
  await page.reload();
  await waitReady(page);
  await waitTicks(page, 2);
  let s = await testState(page);
  expect(s.pace).toBe('classic');
  expect(s.gatesPassed[2]).toBe(true);
  expect(s.hero!.z).toBeGreaterThan(classicGates[2]!);
  expect(s.hero!.z).toBeLessThan(classicGates[2]! + 10);
  const classicStat = s.stat;

  // Fast: a fresh climb, nothing of the classic one.
  await open(page, 'pace=fast');
  s = await testState(page);
  expect(s.pace).toBe('fast');
  expect(s.gatesPassed.some(Boolean)).toBe(false);
  expect(s.hero!.z).toBeLessThan(40);
  expect(s.stat).toBe(0);
  await passGate(page, fastGates, 2, fastGate2);
  await page.reload();
  await waitReady(page);
  await waitTicks(page, 2);
  s = await testState(page);
  expect(s.pace).toBe('fast');
  expect(s.gatesPassed[1]).toBe(true);
  expect(s.gatesPassed[2]).toBe(false);
  expect(s.hero!.z).toBeGreaterThan(fastGates[1]!);
  expect(s.hero!.z).toBeLessThan(fastGates[1]! + 6);

  // Open: a fresh climb as well; through ridge 1 (its number 50), F5 — at the flag past it.
  await open(page, 'pace=open');
  s = await testState(page);
  expect(s.pace).toBe('open');
  expect(s.gatesPassed.some(Boolean)).toBe(false);
  expect(s.stat).toBe(0);
  await passGate(page, openGates, 1, 50);
  await page.reload();
  await waitReady(page);
  await waitTicks(page, 2);
  s = await testState(page);
  expect(s.pace).toBe('open');
  expect(s.gatesPassed[0]).toBe(true);
  expect(s.gatesPassed[1]).toBe(false);
  expect(s.hero!.z).toBeGreaterThan(openGates[0]!);
  expect(s.hero!.z).toBeLessThan(openGates[0]! + 16);

  // Back to classic: wall 3 and its stat are still there.
  await open(page, 'pace=classic');
  s = await testState(page);
  expect(s.pace).toBe('classic');
  expect(s.gatesPassed[2]).toBe(true);
  expect(s.stat).toBe(classicStat);
  expect(s.hero!.z).toBeGreaterThan(classicGates[2]!);
  expect(s.hero!.z).toBeLessThan(classicGates[2]! + 10);

  // The mirror keeps both: classic in the old key, fast in its slot.
  const mirror = await page.evaluate(() => {
    const read = (suffix: string): { frontierWall?: number } | null => {
      const key = Object.keys(localStorage).find((k) => k.endsWith(suffix));
      return key ? (JSON.parse(localStorage.getItem(key)!) as { frontierWall?: number }) : null;
    };
    return { classic: read(':save'), fast: read(':save.fast'), open: read(':save.open') };
  });
  expect(mirror.classic?.frontierWall).toBe(3);
  expect(mirror.fast?.frontierWall).toBe(2);
  expect(mirror.open?.frontierWall).toBe(1);
});
