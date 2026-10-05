import type { Page } from '@playwright/test';
import { test, expect, testState } from './fixtures.ts';
import type { TestState } from '../src/test-api/index.ts';
import worldsJson from '../content/avalanche/worlds.json' with { type: 'json' };

// M2-11: the physical bot (controller and collisions in the browser) plays mountain 1 on game time (ticks / 60):
// up the middle while the wall is open, ground gifts of its stretch, the belt of the cave below a closed wall, the lit
// cave on every warning, the free egg, shoes as soon as the button can; through the chest to the portal.
type Seg = { type: string; z: number; x?: number; side?: string; height?: number; stretch?: number };
const world = (worldsJson as unknown as { worlds: Array<{ segments: Seg[] }> }).worlds[0]!;
const gates = world.segments.filter((s) => s.type === 'gate').map((s) => s.z);
const caves = world.segments
  .filter((s) => s.type === 'niche')
  .sort((a, b) => a.z - b.z)
  .map((s) => ({ z: s.z, side: s.side === 'right' ? 1 : -1 }));
const groundGifts = world.segments.filter((s) => s.type === 'gift' && (s.height ?? 0) === 0).map((s) => ({ x: s.x ?? 0, z: s.z }));
const portal = world.segments.find((s) => s.type === 'portal')!;
const TIME_SCALE = 20;

/** Points into cave i: the mouth, then the belt at the back wall (docs/01-gdd.md 3.4). */
const intoCave = (i: number): Array<[number, number]> => {
  const c = caves[i]!;
  return [
    [c.side * 12, c.z - 2],
    [c.side * 19, c.z],
  ];
};

interface Run {
  sec: number;
  shoes: number;
  walls: number;
  caught: number;
  waves: number;
  portal: boolean;
}

/** Plays mountain 1 until `untilWalls` walls are passed (12 + portal for the whole mountain) or the real-time deadline. */
async function playMountain1(page: Page, untilWalls: number, realMs: number): Promise<Run> {
  let plan = '';
  const setPlan = async (key: string, s: TestState, points: Array<[number, number]>): Promise<void> => {
    if (key === plan && (await page.evaluate(() => window.__TEST__!.botLeft())) > 0) return;
    plan = key;
    // Out of a cave first: back to the mouth at the same z, then on.
    const h = s.hero!;
    const path: Array<[number, number]> = Math.abs(h.x) > 12.5 && key !== `cave:${s.shelter}` && key !== 'egg' ? [[Math.sign(h.x) * 11, h.z], ...points] : points;
    await page.evaluate((p) => window.__TEST__!.botPath(p), path);
  };
  // Counts sim events of mountain 1 as they come (the record list keeps only the last 2000, steps flood it).
  await page.evaluate(() => {
    const list = window.__TEST__!.simEvents;
    const counts: Record<string, number> = {};
    (window as unknown as { __botCounts: Record<string, number> }).__botCounts = counts;
    const push = list.push.bind(list);
    list.push = (...items) => {
      for (const it of items) if (it['world'] === 1) counts[it.name] = (counts[it.name] ?? 0) + 1;
      return push(...items);
    };
  });
  await page.evaluate((k) => window.__TEST__!.setTimeScale(k), TIME_SCALE);
  const deadline = Date.now() + realMs;
  let s = await testState(page);
  let walls = 0;
  while (Date.now() < deadline) {
    s = await testState(page);
    // The portal opens «Mountain 1 cleared!» (M3-09): the mountain is done.
    if (s.world !== 'slope' || s.window === 'summit') break;
    if (s.shoesButton.can) await page.locator('[data-hud="shoes"]').click();
    const passed = s.gatesPassed.filter(Boolean).length;
    walls = Math.max(walls, passed);
    if (passed >= untilWalls) break;
    if (!s.hero || s.caught) continue;
    const k = s.gatesPassed.indexOf(false);
    const wave = s.wave;
    // The free egg of the first minute stands beside the belt of cave 4 (docs/01-gdd.md 6.2): touch it from inside.
    if (s.egg && s.egg.phase === 'idle' && s.inShelter && s.shelter === 3) {
      await setPlan('egg', s, [[s.egg.x, s.egg.z]]);
      continue;
    }
    if (wave && (wave.phase === 'warn' || wave.phase === 'run') && wave.shelter >= 0) {
      await setPlan(`cave:${wave.shelter}`, s, intoCave(wave.shelter));
      continue;
    }
    if (k < 0) {
      await setPlan('portal', s, [[portal.x ?? 0, portal.z + 4]]);
      continue;
    }
    if (s.gatesOpen[k]) {
      await setPlan(`gate:${k}`, s, [[0, gates[k]! + 5]]);
      continue;
    }
    const from = k === 0 ? 40 : gates[k - 1]!;
    const gift = groundGifts.find((g) => g.z > from && g.z < gates[k]! && !s.giftsTaken[s.gifts.findIndex((x) => Math.abs(x.x - g.x) < 0.1 && Math.abs(x.z - g.z) < 0.1)]);
    if (gift && s.hero.z < gift.z + 30) {
      await setPlan(`gift:${gift.z}`, s, [[gift.x, gift.z]]);
      continue;
    }
    await setPlan(`cave:${k}`, s, intoCave(k));
  }
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  s = await testState(page);
  const portalTick = await page.evaluate(() => window.__TEST__!.simEvents.find((e) => e.name === 'portal' && e['world'] === 1)?.tick);
  const counts = await page.evaluate(() => (window as unknown as { __botCounts: Record<string, number> }).__botCounts);
  return {
    sec: (portalTick ?? s.ticks) / 60,
    shoes: s.shoeLevel,
    walls,
    caught: counts['waveCaught'] ?? 0,
    waves: counts['waveWarn'] ?? 0,
    portal: portalTick !== undefined,
  };
}

// The whole mountain is ~7 game minutes, ~25 s real at ×20 (no @full tag needed: well inside the verify budget).
test('bot on game time plays mountain 1 to the portal with shoe purchases, no console errors', async ({ page, openGame }) => {
  test.setTimeout(300_000);
  await openGame('seed=7');
  const r = await playMountain1(page, 13, 270_000);
  console.log(`bot-world1: ${JSON.stringify(r)} — game minutes ${(r.sec / 60).toFixed(2)}`);
  expect(r.walls).toBe(12);
  expect(r.portal).toBe(true);
  expect(r.shoes).toBeGreaterThanOrEqual(2);
});
