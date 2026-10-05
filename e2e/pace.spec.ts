import type { Page } from '@playwright/test';
import { test, expect, testState, waitReady, waitTicks } from './fixtures.ts';
import classicWorlds from '../content/avalanche/worlds.json' with { type: 'json' };
import fastWorlds from '../content/avalanche/pace/fast/worlds.json' with { type: 'json' };

// PR-01: the pace flag (docs/01-gdd.md 16.1). Without ?pace — game.json `pace` (fast: 15 gates on mountain 1),
// ?pace=classic — the M3 game (12 walls); each pace keeps its own progress: classic at the root of the save as before,
// fast in its own slot; F5 brings each pace back to its own flag.
type Seg = { type: string; z: number; requires?: number };
const gateSegs = (w: unknown): Seg[] => (w as { worlds: Array<{ segments: Seg[] }> }).worlds[0]!.segments.filter((s) => s.type === 'gate');
const gatesOf = (w: unknown): number[] => gateSegs(w).map((s) => s.z);
const classicGates = gatesOf(classicWorlds);
const fastGates = gatesOf(fastWorlds);
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

test('without ?pace the pace of game.json (fast, 15 gates); ?pace=classic — 12 walls; unknown pace — game.json', async ({ page, openGame }) => {
  await open(page, '');
  let s = await testState(page);
  expect(s.pace).toBe('fast');
  expect(s.world).toBe('slope');
  expect(s.gatesOpen).toHaveLength(15);
  await expect(page.locator('.hud-mountain-label')).toHaveText('Гора 1 · 0/15');

  await openGame();
  s = await testState(page);
  expect(s.pace).toBe('classic');
  expect(s.gatesOpen).toHaveLength(12);
  await expect(page.locator('.hud-mountain-label')).toHaveText('Гора 1 · 0/12');

  await open(page, 'pace=nope');
  s = await testState(page);
  expect(s.pace).toBe('fast');
  expect(s.gatesOpen).toHaveLength(15);
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
    return { classic: read(':save'), fast: read(':save.fast') };
  });
  expect(mirror.classic?.frontierWall).toBe(3);
  expect(mirror.fast?.frontierWall).toBe(2);
});
