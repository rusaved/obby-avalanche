import type { Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect, testState, waitTicks } from './fixtures.ts';
import type { TestState } from '../src/test-api/index.ts';
import fastWorlds from '../content/avalanche/pace/fast/worlds.json' with { type: 'json' };

// PR-02: mountains of the fast pace (docs/01-gdd.md 16.2–16.3): the physical bot (controller and collisions in the
// browser) plays mountain 1 on game time — up the middle through the gifts on the path, at a closed gate one step aside
// onto the belt of the cave right beside it, the cave of its stretch on every warning, the free egg, shoes as soon as the
// button can; through the chest to the portal. Then every one of the 10 mountains loads by teleport.
type Seg = { type: string; z: number; x?: number; side?: string; length?: number; stretch?: number; next?: number | null };
type FastWorld = { id: string; length: number; wallCount: number; segments: Seg[] };
const worlds = (fastWorlds as unknown as { worlds: FastWorld[] }).worlds;
const world = worlds[0]!;
const gates = world.segments.filter((s) => s.type === 'gate').map((s) => s.z);
const caves = world.segments
  .filter((s) => s.type === 'niche')
  .sort((a, b) => a.z - b.z)
  .map((s) => ({ z: s.z, side: s.side === 'right' ? 1 : -1, top: s.z + (s.length ?? 0) / 2 }));
const portal = world.segments.find((s) => s.type === 'portal')!;
const TIME_SCALE = 4;
/** The camp (a safe zone): the hero starts there standing. */
const CAMP = 40;
/** «At the gate»: the stretch part from the lower edge of its cave (≤ 16 units below, docs/01-gdd.md 16.3) up to the gate. */
const NEAR_GATE = 16;
const EVIDENCE = 'docs/evidence/proto';

/** Cave i (beside gate i + 1): its mouth from below, then the lower half of the belt at the back wall. */
const intoCave = (i: number): Array<[number, number]> => {
  const c = caves[i]!;
  return [
    [c.side * 12, c.z - 3],
    [c.side * 19, c.z - 2],
  ];
};

interface Run {
  sec: number;
  walls: number;
  passSec: number[];
  maxDown: number;
  standOffBelt: number;
  gateStandMax: number;
  shoes: number;
  waves: number;
  caught: number;
  portal: boolean;
  /** Where the hero stood off the belt below a closed gate (for the log). */
  standAt: string[];
}

async function playMountain1(page: Page, realMs: number): Promise<Run> {
  let plan = '';
  let target: [number, number] = [0, 0];
  const setPlan = async (key: string, s: TestState, points: Array<[number, number]>): Promise<void> => {
    const h = s.hero!;
    // Same plan: keep walking it, and once there stay (on the belt the hero runs in place by himself).
    if (key === plan && ((await page.evaluate(() => window.__TEST__!.botLeft())) > 0 || Math.hypot(target[0] - h.x, target[1] - h.z) < 2)) return;
    plan = key;
    target = points[points.length - 1] ?? [h.x, h.z];
    // Out of a cave first: to its mouth at the same z, then on.
    const out = Math.abs(h.x) > 12.5 && key !== `cave:${s.shelter}` && key !== 'egg';
    await page.evaluate((p) => window.__TEST__!.botPath(p), out ? [[Math.sign(h.x) * 11, h.z] as [number, number], ...points] : points);
  };
  const passSec: number[] = [];
  await page.evaluate(() => {
    const list = window.__TEST__!.simEvents;
    const w = window as unknown as { __fast: { pass: number[]; counts: Record<string, number> } };
    w.__fast = { pass: [], counts: {} };
    const push = list.push.bind(list);
    list.push = (...items) => {
      for (const it of items) {
        if (it['world'] !== 1) continue;
        w.__fast.counts[it.name] = (w.__fast.counts[it.name] ?? 0) + 1;
        if (it.name === 'gatePass') w.__fast.pass.push(it.tick);
      }
      return push(...items);
    };
  });
  await page.evaluate((k) => window.__TEST__!.setTimeScale(k), TIME_SCALE);
  const deadline = Date.now() + realMs;
  let s = await testState(page);
  let walls = 0;
  let zMax = s.hero!.z;
  let maxDown = 0;
  let standOffBelt = 0;
  let lastTick = s.ticks;
  const standAt: string[] = [];
  while (Date.now() < deadline) {
    s = await testState(page);
    if (s.world !== 'slope' || s.window === 'summit') break;
    const dt = (s.ticks - lastTick) / 60;
    lastTick = s.ticks;
    const h = s.hero!;
    // Down the slope only inside the snowball (docs/01-gdd.md 4.5): measured from the highest point since.
    if (s.caught) zMax = h.z;
    else {
      zMax = Math.max(zMax, h.z);
      maxDown = Math.max(maxDown, zMax - h.z);
    }
    const k = s.gatesPassed.indexOf(false);
    const wave = s.wave;
    const waveOn = !!wave && (wave.phase === 'warn' || wave.phase === 'run');
    // At a closed gate the hero stands only on the belt of its cave (docs/01-gdd.md 16.3).
    if (k >= 0 && h.z > CAMP && gates[k]! - h.z < NEAR_GATE && !s.gatesOpen[k] && !s.caught && !waveOn && h.speed < 1 && !s.onBelt && s.egg?.phase !== 'hatching') {
      standOffBelt += dt;
      if (standAt.length < 12) standAt.push(`t=${(s.ticks / 60).toFixed(2)} (${h.x.toFixed(1)},${h.z.toFixed(1)}) ${plan} dt=${dt.toFixed(2)}`);
    }
    if (s.shoesButton.can) await page.locator('[data-hud="shoes"]').click();
    walls = Math.max(walls, s.gatesPassed.filter(Boolean).length);
    if (s.caught) continue;
    // The free egg beside the belt of the cave of the scripted wave (docs/01-gdd.md 6.2, 16.6): touch it from inside.
    if (s.egg && s.egg.phase === 'idle' && s.inShelter && s.shelter === caves.findIndex((c) => Math.abs(c.z - s.egg!.z) < 6)) {
      await setPlan('egg', s, [[s.egg.x, s.egg.z]]);
      continue;
    }
    if (k < 0) {
      await setPlan('portal', s, [[portal.x ?? 0, portal.z + 4]]);
      continue;
    }
    // A warning: the cave of this stretch, beside the closed gate; past its exit with the gate open — on to the next one.
    if (waveOn && !(s.gatesOpen[k] && h.z > caves[k]!.top - 1)) {
      await setPlan(`cave:${k}`, s, intoCave(k));
      continue;
    }
    // Gifts of the path of stretch i straight ahead (they stand on the axis), then the belt beside its gate.
    const stretchPath = (i: number): Array<[number, number]> => {
      const from = i === 0 ? CAMP : gates[i - 1]!;
      const ahead = s.gifts
        .map((g, gi) => ({ g, gi }))
        .filter(({ g, gi }) => !s.giftsTaken[gi] && g.z > Math.max(from, h.z - 1) && g.z < gates[i]! && Math.abs(g.x) < 1)
        .sort((a, b) => a.g.z - b.g.z)
        .map(({ g }) => [g.x, g.z] as [number, number]);
      return [...ahead, ...intoCave(i)];
    };
    // Open gate: through it and straight on along the next stretch (no stop while the next plan comes).
    if (s.gatesOpen[k]) {
      await setPlan(`gate:${k}`, s, [[0, gates[k]! + 5], ...(k + 1 < gates.length ? stretchPath(k + 1) : [[portal.x ?? 0, portal.z + 4] as [number, number]])]);
      continue;
    }
    await setPlan(`cave:${k}`, s, stretchPath(k));
  }
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  s = await testState(page);
  const portalTick = await page.evaluate(() => window.__TEST__!.simEvents.find((e) => e.name === 'portal' && e['world'] === 1)?.tick);
  const fast = await page.evaluate(() => (window as unknown as { __fast: { pass: number[]; counts: Record<string, number> } }).__fast);
  passSec.push(...fast.pass.map((t) => Math.round((t / 60) * 10) / 10));
  return {
    sec: (portalTick ?? s.ticks) / 60,
    walls,
    passSec,
    maxDown,
    standOffBelt,
    gateStandMax: await page.evaluate(() => window.__TEST__!.gateStandMax()),
    shoes: s.shoeLevel,
    waves: fast.counts['waveWarn'] ?? 0,
    caught: fast.counts['waveCaught'] ?? 0,
    portal: portalTick !== undefined,
    standAt,
  };
}

test('fast pace: the bot plays mountain 1 to the portal within 120 s of game time, never down the slope, at a closed gate only on its belt', async ({ page, openGame }) => {
  test.setTimeout(300_000);
  await openGame('pace=fast&seed=7');
  expect((await testState(page)).pace).toBe('fast');
  const r = await playMountain1(page, 240_000);
  console.log(`fast-mountain: ${JSON.stringify(r)} — game seconds ${r.sec.toFixed(1)}`);
  expect(r.walls).toBe(15);
  expect(r.portal).toBe(true);
  expect(r.sec).toBeLessThanOrEqual(120);
  expect(r.maxDown).toBeLessThanOrEqual(3);
  expect(r.standOffBelt).toBeLessThanOrEqual(1);
  expect(r.gateStandMax).toBeLessThanOrEqual(0.5);
});

test('fast pace: every one of the 10 mountains loads by teleport (camp, middle, summit), draw calls within 60; screenshots', async ({ page, openGame }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame('pace=fast&quality=high');
  mkdirSync(EVIDENCE, { recursive: true });
  // Camp of mountain 1, then stretch 1 from below: gate 1 with a small number, its cave beside it, gifts on the path.
  await waitTicks(page, 20);
  await page.screenshot({ path: `${EVIDENCE}/fast_camp_1920x1080_ru.png` });
  await page.evaluate(() => window.__TEST__!.teleport(48));
  await waitTicks(page, 30);
  await page.screenshot({ path: `${EVIDENCE}/fast_mountain1_1920x1080_ru.png` });
  // The cave of gate 7 right beside it: the hero on its belt, the gate a step away.
  const c = caves[6]!;
  await page.evaluate(([x, z]) => window.__TEST__!.teleport(z, x), [c.side * 19.5, c.z] as const);
  await waitTicks(page, 30);
  await page.screenshot({ path: `${EVIDENCE}/fast_cave_gate7_1920x1080_ru.png` });
  // The mountains by teleport on the usual test field (draw calls do not depend on the canvas size).
  await page.setViewportSize({ width: 960, height: 540 });

  const rows: string[] = [];
  let maxCalls = 0;
  for (let n = 1; n <= worlds.length; n++) {
    const w = worlds[n - 1]!;
    await page.evaluate((i) => window.__TEST__!.gotoWorld(i), n);
    await waitTicks(page, 30);
    let s = await testState(page);
    expect(s.world).toBe(w.id);
    expect(s.gatesOpen).toHaveLength(14 + n);
    expect(s.hero!.z).toBeLessThan(40);
    expect(s.hero!.onGround).toBe(true);
    const wGates = w.segments.filter((x) => x.type === 'gate').map((x) => x.z);
    for (const z of [20, wGates[Math.floor(wGates.length / 2)]! + 3, w.length - 30]) {
      await page.evaluate((zz) => window.__TEST__!.teleport(zz), z);
      await waitTicks(page, 30);
      s = await testState(page);
      expect(s.respawning, `mountain ${n} at z ${z}`).toBe(false);
      expect(Math.abs(s.hero!.z - z), `mountain ${n} at z ${z}`).toBeLessThan(3);
      const info = await page.evaluate(() => window.__TEST__!.renderInfo()!);
      maxCalls = Math.max(maxCalls, info.calls);
      rows.push(`mountain ${n} (${w.id}) z=${z}: draw calls ${info.calls}, triangles ${info.triangles}`);
      expect(info.calls, `draw calls on mountain ${n} at z=${z}`).toBeLessThanOrEqual(60);
    }
    const p = w.segments.find((x) => x.type === 'portal')!;
    expect(p.next ?? null).toBe(n < worlds.length ? n + 1 : null);
  }
  writeFileSync(`${EVIDENCE}/budgets-fast.txt`, [`fast pace, quality high, 960x540, ${new Date().toISOString()}; max draw calls ${maxCalls}`, ...rows, ''].join('\n'));
});

test('fast pace: «Гора a/10» on the rebirth button and in its window; the rebirth opens only after the summit of mountain 10', async ({ page, openGame }) => {
  await openGame('pace=fast');
  await page.evaluate(() => {
    window.__TEST__!.setTrophies(3);
    window.__TEST__!.setSummits(9);
  });
  await waitTicks(page, 3);
  await expect(page.locator('[data-hud="menu-rebirth"]')).toContainText('Гора 9/10');
  expect((await testState(page)).rebirthReady).toBe(false);
  await page.locator('[data-hud="menu-rebirth"]').dispatchEvent('pointerdown');
  await expect(page.locator('[data-role="rebirth-locked"]')).toHaveText('Дойди до вершины горы 10 · Гора 9/10');
  await page.locator('[data-hud="rebirth-later"]').click();
  await page.evaluate(() => window.__TEST__!.setSummits(10));
  await waitTicks(page, 3);
  expect((await testState(page)).rebirthReady).toBe(true);
});
