import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import { passX } from './base-route.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };
import tuning from '../content/avalanche/tuning.json' with { type: 'json' };
import openTuning from '../content/avalanche/pace/open/tuning.json' with { type: 'json' };

// SP-01 (docs/01-gdd.md 20.2): the camera of «Размах». Out of 10 side grottos of mountains 1–3 (5 after an avalanche
// frame, 5 without) within shotReturnSec the view is behind the hero where he runs (≤ 15°), the distance ≥ 0.8 of
// camera.distance, no rise, never inside the level; straight up the summit of mountain 1 −14, 0, +14 off the middle the
// hero goes into the portal ≤ 3 s from the line of the funnel, the camera never inside the arch or the pillar of light;
// on the belt of the grotto of ridge 1 of mountain 2 the record flag is never between the camera and the hero.
type Seg = { type: string; z: number; kind?: string; length?: number };
type OpenWorld = { length: number; segments: Seg[]; bosses: Array<{ zone: [number, number] }> };
const worlds = (openWorlds as unknown as { worlds: OpenWorld[] }).worlds;
const EVIDENCE = 'docs/evidence/sp';
const DISTANCE = openTuning.camera.distance;
const RETURN_TICKS = Math.round(tuning.avalanche.shotReturnSec * 60);
type Shelter = { kind: string; side: string; z: number; inside: [number, number]; mouth: [number, number]; belt: [number, number] | null };

async function start(page: Page, openGame: (q?: string) => Promise<void>): Promise<void> {
  await openGame('pace=open');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
}

async function toMountain(page: Page, i: number, stat = 1e12): Promise<void> {
  if ((await testState(page)).world !== (openWorlds as { worlds: Array<{ id: string }> }).worlds[i - 1]!.id) {
    await page.evaluate((n) => window.__TEST__!.gotoWorld(n), i);
    await waitTicks(page, 20);
  }
  await page.evaluate((s) => {
    window.__TEST__!.holdWave(900);
    window.__TEST__!.setStat(s);
  }, stat);
}

/** Side grottos of this mountain with no ridge within 40 units up the slope (the way out runs up and across), no rock
 * of the field on that way (SP-07 moved the grottos: one exit ran past a rock, and the view went round it) and no pit
 * (RL-03: a fall there rolls the hero back to the flag). */
function grottos(list: Shelter[], w: OpenWorld): Shelter[] {
  const ridges = w.segments.filter((s) => s.type === 'gate' && s.kind === 'ridge').map((s) => s.z);
  const rocks = list.filter((n) => n.kind === 'island');
  const pits = w.segments.filter((s) => s.type === 'pit');
  return list.filter(
    (n) =>
      n.kind === 'grotto' &&
      !ridges.some((z) => z > n.z - 4 && z < n.z + 40) &&
      !rocks.some((r) => Math.sign(r.mouth[0]) === (n.side === 'left' ? -1 : 1) && r.z > n.z - 20 && r.z < n.z + 40) &&
      !pits.some((q) => q.z + q.length! > n.z - 4 && q.z < n.z + 40),
  );
}

/** Into the grotto, (an avalanche frame there,) out of it up and across the slope: the view shotReturnSec later. */
async function outOfGrotto(page: Page, n: Shelter, wave: boolean): Promise<{ deg: number; dist: number; raise: number; at: string }> {
  const sign = n.side === 'left' ? -1 : 1;
  // By the mouth (not the middle: a fork cliff may stand there), then into the grotto.
  await page.evaluate(([z, x]) => window.__TEST__!.teleport(z, x), [n.z, n.mouth[0]] as const);
  await waitTicks(page, 20);
  await page.evaluate((p) => window.__TEST__!.botPath(p), [[n.inside[0], n.z]] as Array<[number, number]>);
  await page.waitForFunction(() => window.__TEST__!.state().inShelter && window.__TEST__!.botLeft() === 0, undefined, { timeout: 60_000 });
  await waitTicks(page, 30);
  if (wave) {
    await page.evaluate(() => window.__TEST__!.setTimeScale(4));
    await page.evaluate(() => window.__TEST__!.triggerWave());
    await page.waitForFunction(() => window.__TEST__!.state().waveHud.shot, undefined, { timeout: 60_000 });
    await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 90_000 });
    await page.evaluate(() => {
      window.__TEST__!.setTimeScale(1);
      window.__TEST__!.holdWave(900);
    });
    expect((await testState(page)).inShelter).toBe(true);
    await waitTicks(page, 30);
  }
  // Up and across, on his own half of the slope (clear of the cliff of a fork down the middle).
  await page.evaluate((p) => window.__TEST__!.botPath(p), [[sign * 12, n.z + 40]] as Array<[number, number]>);
  await page.waitForFunction(() => !window.__TEST__!.state().inShelter, undefined, { timeout: 30_000 });
  await waitTicks(page, RETURN_TICKS);
  const s = await testState(page);
  const cam = s.cameraPos;
  const h = s.hero!;
  await page.evaluate(() => window.__TEST__!.botPath(null));
  // Behind him: the way camera → hero along his run.
  const view = Math.atan2(h.x - cam[0], h.z - cam[2]);
  const run = Math.atan2(h.vx, h.vz);
  let d = Math.abs(view - run) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return { deg: (d * 180) / Math.PI, dist: s.cameraDistance, raise: s.cameraRaise, at: `${s.world} z ${n.z.toFixed(0)} ${n.side}${wave ? ' wave' : ''}` };
}

test('10 side grottos of mountains 1–3: out of each the view is behind the hero within shotReturnSec; screenshot', async ({ page, openGame }) => {
  test.setTimeout(600_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await start(page, openGame);
  const plan: Array<[number, number]> = [
    [1, 4],
    [2, 3],
    [3, 3],
  ];
  let k = 0;
  await page.evaluate(() => window.__TEST__!.resetCameraStats());
  for (const [m, count] of plan) {
    // Speed 0 (16 units/s): shotReturnSec after the exit he is still running out of the grotto.
    await toMountain(page, m, 0);
    const list = grottos((await page.evaluate(() => window.__TEST__!.shelters())) as Shelter[], worlds[m - 1]!);
    expect(list.length, `mountain ${m}: side grottos`).toBeGreaterThanOrEqual(count);
    const step = Math.max(1, Math.floor(list.length / count));
    for (let j = 0; j < count; j++) {
      const r = await outOfGrotto(page, list[j * step]!, k % 2 === 0);
      expect(r.deg, `${r.at}: course of the view`).toBeLessThanOrEqual(15);
      expect(r.dist, `${r.at}: distance`).toBeGreaterThanOrEqual(0.8 * DISTANCE);
      expect(r.raise, `${r.at}: rise`).toBeLessThan(1e-3);
      if (k === 9) await shot1080(page, `${EVIDENCE}/grotto_return_1920x1080_ru.png`, 2);
      k++;
    }
  }
  expect(k).toBe(10);
  const st = await page.evaluate(() => window.__TEST__!.cameraStats());
  expect(st.inside, JSON.stringify(st.bad)).toBe(0);
});

for (const x of [-14, 0, 14]) {
  test(`mountain 1 summit: straight up ${x} off the middle — into the portal ≤ 3 s from the funnel, the camera never in the arch or the light`, async ({ page, openGame }) => {
    test.setTimeout(150_000);
    mkdirSync(EVIDENCE, { recursive: true });
    await start(page, openGame);
    // Speed 0: the slowest run (16 units/s) still makes the 40 units of the funnel within 3 s.
    await toMountain(page, 1, 0);
    const w = worlds[0]!;
    const portal = w.segments.find((s) => s.type === 'portal')!;
    const funnel = w.segments.find((s) => s.type === 'funnel')!;
    const line = w.bosses[0]!.zone[1];
    await page.evaluate(([zz, xx]) => window.__TEST__!.teleport(zz, xx), [line + 2, x] as const);
    await waitTicks(page, 20);
    // After the zone toast of the finish straight is gone.
    if (x === 0) {
      await waitTicks(page, 240);
      await shot1080(page, `${EVIDENCE}/summit_funnel_1920x1080_ru.png`, 3);
    }
    await page.evaluate(() => window.__TEST__!.resetCameraStats());
    await page.evaluate((p) => window.__TEST__!.botPath(p), [[x, portal.z + 10]] as Array<[number, number]>);
    await page.waitForFunction((z) => window.__TEST__!.state().hero!.z >= z, funnel.z, { timeout: 30_000 });
    const t0 = (await testState(page)).simTick;
    await page.waitForFunction(() => window.__TEST__!.simEvents.some((e) => e.name === 'portal'), undefined, { timeout: 30_000 });
    const tick = await page.evaluate(() => window.__TEST__!.simEvents.find((e) => e.name === 'portal')!.tick);
    expect((tick - t0) / 60, 'seconds from the funnel line to the portal').toBeLessThanOrEqual(3);
    const st = await page.evaluate(() => window.__TEST__!.cameraStats());
    expect(st.frames).toBeGreaterThan(10);
    expect(st.portal, JSON.stringify(st.bad)).toBe(0);
    expect(st.inside, JSON.stringify(st.bad)).toBe(0);
  });
}

test('mountain 2: on the belt of the grotto of ridge 1 the record flag is never between the camera and the hero (300 frames)', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await start(page, openGame);
  await toMountain(page, 2);
  const list = (await page.evaluate(() => window.__TEST__!.shelters())) as Shelter[];
  const n = list.find((s) => s.kind === 'ridgeGrotto' && s.belt)!;
  expect(n).toBeDefined();
  await page.evaluate(([z, x]) => window.__TEST__!.teleport(z, x), [n.belt![1], n.belt![0]] as const);
  await waitTicks(page, 30);
  expect((await testState(page)).onBelt).toBe(true);
  // The record up the slope off the mouth; the camera turned round and round by hand on the belt.
  const h0 = (await testState(page)).hero!;
  await page.evaluate(([x, y, z]) => window.__TEST__!.setRecord(x, y, z), [n.mouth[0], h0.y, n.z + 22] as [number, number, number]);
  await waitTicks(page, 5);
  await page.evaluate(() => window.__TEST__!.resetCameraStats());
  const px = 360 / (48 * tuning.camera.mouseDegPerPx);
  while ((await page.evaluate(() => window.__TEST__!.cameraStats().frames)) < 300) {
    await page.mouse.move(400, 300);
    await page.mouse.down();
    await page.mouse.move(400 + px, 300, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(40);
  }
  let st = await page.evaluate(() => window.__TEST__!.cameraStats());
  expect((await testState(page)).record).not.toBeNull();
  expect(st.flagBlocked, JSON.stringify(st.bad)).toBe(0);

  // On the slope below the grotto, looking down at the hero from far up: the flag set on the line of sight near the
  // camera stands (more than RECORD_RETURN above him) and is not drawn in the way.
  const w2 = worlds[1]!;
  const ridge = w2.segments.find((g) => g.type === 'gate' && g.kind === 'ridge') as Seg & { passLength: number };
  await page.evaluate(([z]) => window.__TEST__!.teleport(z, 0), [ridge.z + ridge.passLength + 4] as const);
  await waitTicks(page, 30);
  await page.evaluate(() => window.__TEST__!.setCamera({ yaw: Math.PI, pitch: 0.02, dist: 30 }));
  // The camera backs off to 30 at retreatSpeed (4 units/s).
  await waitTicks(page, 300);
  const s = await testState(page);
  const cam = s.cameraPos;
  const h = s.hero!;
  // A quarter of the way from the camera to the hero's chest, on the snow: the pole and the cloth across the line.
  const k = 0.25;
  const at: [number, number, number] = [cam[0] + (h.x - cam[0]) * k, h.y, cam[2] + (h.z - cam[2]) * k];
  expect(at[2] - h.z, 'the flag stands (more than RECORD_RETURN above the hero)').toBeGreaterThan(20);
  await page.evaluate(([x, y, z]) => window.__TEST__!.setRecord(x, y, z), at);
  await waitTicks(page, 5);
  await page.evaluate(() => window.__TEST__!.resetCameraStats());
  await page.waitForFunction(() => window.__TEST__!.cameraStats().frames >= 300, undefined, { timeout: 90_000, polling: 200 });
  st = await page.evaluate(() => window.__TEST__!.cameraStats());
  expect(st.flagBlocked, JSON.stringify(st.bad)).toBe(0);
  await page.evaluate(() => window.__TEST__!.setCamera('auto'));
});

// SP-10 (playtest of «Размах»: on the belt under the roof of a rock grotto the hero was not seen for 21 s — the wide frame
// took the axes of a side grotto and the roof of the rock stayed drawn; in a ridge passage the camera sat in his head):
// every rock grotto with a belt of mountains 1–2 — on its belt (the belt frame) and in an avalanche frame there the line
// to the hero is clear, the hero drawn, the camera never at his body; through the passages of the ridges of mountain 1
// the camera never at his body either. Screenshot of the belt frame.
test('rock grottos with a belt, mountains 1–2: on the belt and in an avalanche frame the hero is seen, the camera never at him; ridge passages', async ({ page, openGame }) => {
  test.setTimeout(360_000);
  await start(page, openGame);
  const rows: string[] = [];
  let bad = 0;
  for (const m of [1, 2]) {
    await toMountain(page, m);
    const list = (await page.evaluate(() => window.__TEST__!.shelters())) as Shelter[];
    const rocks = list.filter((s) => s.kind === 'island' && s.belt);
    expect(rocks.length, `mountain ${m}`).toBeGreaterThan(0);
    for (const n of rocks) {
      await page.evaluate(([z, x]) => window.__TEST__!.teleport(z, x), [n.belt![1], n.belt![0]] as const);
      await waitTicks(page, 30);
      expect((await testState(page)).onBelt, `mountain ${m} z ${n.z.toFixed(0)}`).toBe(true);
      await page.evaluate(() => window.__TEST__!.resetCameraStats());
      await waitTicks(page, 120);
      const belt = await page.evaluate(() => window.__TEST__!.cameraStats());
      if (rows.length === 0) await shot1080(page, `${EVIDENCE}/island_belt_1920x1080_ru.png`);
      // An avalanche over the rock: its frame from the start of the warning.
      await page.evaluate(() => {
        window.__TEST__!.setTimeScale(4);
        window.__TEST__!.triggerWave();
      });
      await page.waitForFunction(() => window.__TEST__!.state().waveHud.shot, undefined, { timeout: 60_000 });
      await page.evaluate(() => window.__TEST__!.resetCameraStats());
      await waitTicks(page, 60);
      const wave = await page.evaluate(() => window.__TEST__!.cameraStats());
      await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 90_000 });
      await page.evaluate(() => {
        window.__TEST__!.setTimeScale(1);
        window.__TEST__!.holdWave(900);
      });
      for (const [what, st] of [
        ['belt', belt],
        ['avalanche', wave],
      ] as const) {
        const miss = st.heroHidden + st.heroBlocked + st.heroNear + st.inside;
        bad += miss;
        rows.push(`mountain ${m} z ${n.z.toFixed(0)} ${what}: ${st.frames} frames, hidden ${st.heroHidden}, blocked ${st.heroBlocked}, at him ${st.heroNear}, inside ${st.inside}${st.bad.length ? ` — ${st.bad.slice(0, 3).join('; ')}` : ''}`);
      }
    }
  }
  // The passages of the ridges of mountain 1, open: from below the carniz through its pass nearest the middle and on.
  await toMountain(page, 1);
  const m1 = worlds[0]!.segments.filter((g) => g.type === 'gate' && g.kind === 'ridge') as Array<Seg & { passes?: number[] }>;
  for (const r of m1) {
    const x = passX(r);
    await page.evaluate(([z, xx]) => window.__TEST__!.teleport(z, xx), [r.z - 30, x] as const);
    await waitTicks(page, 20);
    await page.evaluate(() => window.__TEST__!.resetCameraStats());
    await page.evaluate((p) => window.__TEST__!.botPath(p), [[x, r.z - 4], [x, r.z + 30]] as Array<[number, number]>);
    await page.waitForFunction(() => window.__TEST__!.botLeft() === 0, undefined, { timeout: 30_000 });
    const st = await page.evaluate(() => window.__TEST__!.cameraStats());
    bad += st.heroNear + st.inside + st.heroHidden;
    rows.push(`ridge z ${r.z.toFixed(0)} pass x ${x}: ${st.frames} frames, hidden ${st.heroHidden}, at him ${st.heroNear}, inside ${st.inside}${st.bad.length ? ` — ${st.bad.slice(0, 3).join('; ')}` : ''}`);
  }
  await page.evaluate(() => window.__TEST__!.botPath(null));
  console.log(rows.join('\n'));
  expect(bad, rows.join('\n')).toBe(0);
});
