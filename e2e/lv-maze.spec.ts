import { test, expect, testState, waitTicks } from './fixtures.ts';
import { STAGES, flagOf, threshold } from './lv-stage-data.ts';
import { mazeDistances } from '../src/level/stage-slope.ts';
import type { WorldStage } from '../src/content/types.ts';

// LV-06 (docs/01-gdd.md 22.7): the maze of mountain 1 — the physical bot along the real route comes out to the finish;
// through a false exit it falls into the pit and rolls back.
const st = STAGES[0]!.stages.find((s) => s.type === 'maze')!;
const m = st.maze!;
const centre = (i: number): [number, number] => [m.x0 + ((i % m.cols) + 0.5) * m.cell, m.z0 + (Math.floor(i / m.cols) + 0.5) * m.cell];
const linked = (i: number, j: number): boolean => m.open.some(([c, r, a, b]) => (r * m.cols + c === i && b * m.cols + a === j) || (r * m.cols + c === j && b * m.cols + a === i));
function route(to: number): Array<[number, number]> {
  const dist = mazeDistances(m.cols, m.rows, m.open, m.entrance);
  const path = [to];
  while (dist[path[0]!]! > 0) path.unshift(dist.findIndex((d, j) => d === dist[path[0]!]! - 1 && linked(path[0]!, j)));
  return [[m.x0 + (m.entrance + 0.5) * m.cell, m.z0 - 3], ...path.map(centre)];
}
const outOf = (e: WorldStage['maze'] extends infer M ? (M extends { exits: Array<infer E> } ? E : never) : never): [number, number] => {
  const [x, z] = centre(e.row * m.cols + e.col);
  return e.side === 'top' ? [x, z + m.cell] : [x + (e.side === 'left' ? -m.cell : m.cell), z];
};

test(`maze of mountain 1 (stage ${st.n}): the real exit leads to the finish, a false one into the pit`, async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openGame('pace=stages');
  await waitTicks(page, 10);
  const go = async (to: number, last: [number, number]): Promise<void> => {
    const f = flagOf(1, st);
    await page.evaluate(([s, z, y]) => {
      window.__TEST__!.setStat(s);
      window.__TEST__!.teleport(z, 0, y + 0.5);
    }, [threshold(st.level) * 1.01, f.z, f.y] as const);
    await waitTicks(page, 10);
    await page.evaluate((p) => window.__TEST__!.botPath(p), [...route(to), last]);
  };
  const real = m.exits.find((e) => e.real)!;
  await go(real.row * m.cols + real.col, [outOf(real)[0], st.end + 6]);
  await page.waitForFunction((z) => window.__TEST__!.state().hero!.z > z || window.__TEST__!.state().rollFrom > 0, st.end, { timeout: 90_000 });
  expect((await testState(page)).rollFrom, 'no fall on the real route').toBe(0);
  await page.screenshot({ path: 'docs/evidence/lv/maze-out.png' });
  const wrong = m.exits.find((e) => !e.real)!;
  await go(wrong.row * m.cols + wrong.col, outOf(wrong));
  await page.waitForFunction(() => window.__TEST__!.state().rollFrom > 0, undefined, { timeout: 90_000 });
  expect((await testState(page)).rollFrom).toBe(st.n);
});
