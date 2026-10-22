import type { Page } from '@playwright/test';
import { test, expect, testState, waitTicks } from './fixtures.ts';
import { STAGES, flagOf, ready, threshold } from './lv-stage-data.ts';
import { mazeDistances } from '../src/level/stage-slope.ts';
import type { WorldStage } from '../src/content/types.ts';

// LV-04 (docs/01-gdd.md 22.5): the physical bot in the browser passes a stage of every type at the level its ridge asks
// for — the line of the trial (the legs of a ledge, the maze route), a jump at the edge of a pit, the lit grotto on the
// avalanche warning; mountains 1 and 2 (dips and the blizzard live on 2).
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

async function pass(page: Page, world: number, st: WorldStage): Promise<void> {
  const f = flagOf(world, st);
  await page.evaluate(([s, z, y]) => {
    window.__TEST__!.setStat(s);
    window.__TEST__!.teleport(z, 0, y + 0.5);
  }, [threshold(st.level) * 1.01, f.z, f.y] as const);
  await waitTicks(page, 10);
  const roll0 = (await testState(page)).rollFrom;
  // SD-05 (docs/01-gdd.md 23.5): the giant keeps to the run line — round him by the edge of the field.
  const giantPath: Array<[number, number]> = [[40, st.start + 20], [40, st.end - 10], [0, st.end + 6]];
  const path = st.type === 'maze' ? mazeRoute(st) : st.type === 'throat' || st.type === 'blizzard' || st.type === 'plates' || st.type === 'chute' ? legs(world, st) : st.type === 'giant' ? giantPath : [[0, st.end + 6] as [number, number]];
  await page.evaluate((on) => window.__TEST__!.botJump(on), st.type !== 'catapult');
  await page.evaluate((p) => window.__TEST__!.botPath(p), path);
  if (st.type === 'avalanche') {
    // On the warning — into the grotto the game lights, out once the wave is gone.
    await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'warn', undefined, { timeout: 30_000 });
    // The plaque says where to (LV-12 re-check: «Run up!» stood under the wave).
    await expect(page.locator('[data-role=tutor]')).toContainText(/Спрячься за камень|Duck behind a rock/);
    const sh = await page.evaluate(() => {
      const i = window.__TEST__!.state().wave!.shelter;
      return window.__TEST__!.shelters()[i]!;
    });
    await page.evaluate((p) => window.__TEST__!.botPath(p), [[sh.mouth[0], sh.mouth[1]], [sh.inside[0], sh.inside[1]]] as Array<[number, number]>);
    await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'gone' || window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 90_000 });
    // Out by the mouth, to the axis, up to the finish (the back of the rock is a wall).
    const [ox, oz] = [sh.mouth[0] - sh.inside[0], sh.mouth[1] - sh.inside[1]];
    const ol = Math.hypot(ox, oz) || 1;
    const out: [number, number] = [sh.mouth[0] + (ox / ol) * 4, sh.mouth[1] + (oz / ol) * 4];
    await page.evaluate(([o, z]) => window.__TEST__!.botPath([o, [0, o[1]], [0, z]]), [out, st.end + 6] as const);
  }
  await page.waitForFunction(([z, r]) => window.__TEST__!.state().hero!.z > z || window.__TEST__!.state().rollFrom !== r, [st.end + 1, roll0] as const, { timeout: 90_000 });
  const s = await testState(page);
  expect(s.rollFrom, `${st.type}: no roll-back on the way`).toBe(roll0);
  await page.evaluate(() => window.__TEST__!.botPath(null));
}

for (const [world, types] of [
  // ST-02/ST-03: mountain 1 — the wave of its own trials, mountain 2 — the stairs, the catapult and the blizzard.
  [1, ['dips', 'giant', 'cracks', 'avalanche', 'plates', 'ice', 'maze', 'throat', 'chute']],
  [2, ['stairs', 'catapult', 'blizzard']],
] as const) {
  test(`mountain ${world}: the bot passes ${types.join(', ')} at the level of the ridge`, async ({ page, openGame }) => {
    test.setTimeout(420_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await openGame('pace=stages');
    await waitTicks(page, 10);
    // The first minute done (its scripted wave): the avalanche of a stage comes only after it.
    await ready(page);
    if (world > 1) {
      await page.evaluate((i) => window.__TEST__!.gotoWorld(i), world);
      await waitTicks(page, 20);
    }
    for (const type of types) {
      const st = STAGES[world - 1]!.stages.find((s) => s.type === type)!;
      await pass(page, world, st);
    }
  });
}
