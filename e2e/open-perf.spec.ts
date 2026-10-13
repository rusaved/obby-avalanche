import { mkdirSync, writeFileSync } from 'node:fs';
import { forkLaneX } from './base-route.ts';
import { test, expect, testState, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };

// PS-09: the camera of the open slope and its budgets (docs/01-gdd.md 17.9–17.10; docs/02-tech.md 9.5).
type Seg = { type: string; z: number; kind?: string; section?: number; length?: number; between?: number; track?: number };
type OpenWorld = { id: string; segments: Seg[]; bosses: Array<{ zone: [number, number] }> };
const worlds = (openWorlds as unknown as { worlds: OpenWorld[] }).worlds;
const EVIDENCE = 'docs/evidence/open';
const CALLS = 40;
const CALLS_LIMIT = 60;
const TRIANGLES = 100_000;
const TEXTURES = 12;

test('draw calls, triangles, textures at the foot, ridge 2 and the giant’s line of each of the 10 mountains; perf.md', async ({ page, openGame }) => {
  test.setTimeout(300_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high');
  const rows: string[] = [];
  let worst = 0;
  let worstAt = '';
  let worstList: Array<[string, number]> = [];
  for (let n = 1; n <= worlds.length; n++) {
    const w = worlds[n - 1]!;
    await page.evaluate((i) => window.__TEST__!.gotoWorld(i), n);
    await waitTicks(page, 20);
    const ridges = w.segments.filter((s) => s.type === 'gate' && s.kind === 'ridge').map((s) => s.z);
    const points: Array<[string, number]> = [
      ['подножие', 20],
      ['рубеж 2', ridges[1]! - 6],
      ['начало зоны великана', w.bosses[0]!.zone[0] - 4],
    ];
    for (const [name, z] of points) {
      await page.evaluate((zz) => window.__TEST__!.teleport(zz), z);
      await waitTicks(page, 30);
      const info = (await page.evaluate(() => window.__TEST__!.renderInfo()))!;
      if (info.calls > worst) {
        worst = info.calls;
        worstAt = `${n} ${w.id}, ${name}`;
        worstList = await page.evaluate(() => window.__TEST__!.drawList());
      }
      rows.push(`| ${n} ${w.id} | ${name} | ${info.calls} | ${info.triangles} | ${info.textures} | ${info.geometries} |`);
      const what = info.calls > CALLS ? JSON.stringify(await page.evaluate(() => window.__TEST__!.drawList())) : '';
      expect(info.calls, `mountain ${n}, ${name} ${what}`).toBeLessThanOrEqual(CALLS_LIMIT);
      expect(info.calls, `mountain ${n}, ${name} (target ${CALLS}) ${what}`).toBeLessThanOrEqual(CALLS);
      expect(info.triangles, `mountain ${n}, ${name}`).toBeLessThanOrEqual(TRIANGLES);
      expect(info.textures, `mountain ${n}, ${name}`).toBeLessThanOrEqual(TEXTURES);
    }
  }
  writeFileSync(
    `${EVIDENCE}/perf.md`,
    [
      '# Простор: замеры отрисовки (PS-09)',
      '',
      `Сборка \`build:e2e\`, Chromium + SwiftShader, \`?pace=open&quality=high\`, 960×540. Цели \`docs/02-tech.md\` 9.5: draw calls ${CALLS} (предел ${CALLS_LIMIT}), треугольники ≤ ${TRIANGLES}, текстуры ≤ ${TEXTURES}. Худшее: ${worst} вызовов.`,
      '',
      '| Гора | Точка | Draw calls | Треугольники | Текстуры | Геометрии |',
      '|---|---|---|---|---|---|',
      ...rows,
      '',
      `Из чего худшая точка (${worstAt}), объект и число отрисовок за кадр:`,
      '',
      ...worstList.map(([k, c]) => `- ${k}: ${c}`),
      '',
    ].join('\n'),
  );
});

test('a simulation step on mountain 10 at CPU ×4 stays within 2 ms; memory does not grow over 5 transitions', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  await openGame('pace=open&quality=high');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.evaluate(() => window.__TEST__!.gotoWorld(10));
  await waitTicks(page, 30);
  await page.evaluate(() => {
    window.__TEST__!.teleport(60);
    window.__TEST__!.setAutoRun(true);
  });
  // The step of the simulation (sim.step) and, for the record, the whole tick with the save mirror and the views:
  // 300 ticks run in the page one by one (each with its frame), so the other worker's load hits few of them.
  const samples = await page.evaluate(() => {
    const out: Array<[number, number]> = [];
    for (let i = 0; i < 300; i++) {
      window.__TEST__!.runSim(1 / 60);
      const st = window.__TEST__!.state();
      out.push([st.lastStepMs, st.lastSimMs]);
    }
    return out;
  });
  const ms = samples.map((x) => x[0]);
  const tick = samples.map((x) => x[1]);
  await page.evaluate(() => window.__TEST__!.setAutoRun(false));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
  const stats = (a: number[]): string => {
    const m = mean(a);
    a.sort((x, y) => x - y);
    return `mean ${m.toFixed(3)} ms, median ${a[150]!.toFixed(3)} ms, p90 ${a[270]!.toFixed(3)} ms, max ${a[299]!.toFixed(3)} ms`;
  };
  const stepMean = mean(ms);
  const line = `mountain 10, CPU x4, 300 ticks: sim.step ${stats(ms)}; whole tick ${stats(tick)}\n`;
  writeFileSync(`${EVIDENCE}/perf-sim.txt`, line);
  // The mean: CPU throttling stops the page in quanta, a single tick that meets one is ~15 ms (docs/допущения.md).
  expect(stepMean, line).toBeLessThanOrEqual(2);

  // Memory: the same mountain after 5 other ones has as many geometries and textures as before.
  await page.evaluate(() => window.__TEST__!.gotoWorld(1));
  await waitTicks(page, 20);
  const before = (await page.evaluate(() => window.__TEST__!.renderInfo()))!;
  for (const n of [2, 3, 4, 5, 6, 1]) {
    await page.evaluate((i) => window.__TEST__!.gotoWorld(i), n);
    await waitTicks(page, 20);
  }
  const after = (await page.evaluate(() => window.__TEST__!.renderInfo()))!;
  expect(after.geometries).toBeLessThanOrEqual(before.geometries);
  expect(after.textures).toBeLessThanOrEqual(before.textures);
});

test('the ridge view and the giant’s shot come back behind the hero within 1.5 s; a turn by hand ends them', async ({ page, openGame }) => {
  test.setTimeout(150_000);
  await openGame('pace=open');
  const w = worlds[0]!;
  const ridge1 = w.segments.find((s) => s.type === 'gate' && s.kind === 'ridge')!.z;
  // The ridge view, to the end by itself.
  await page.evaluate(([z, s]) => {
    window.__TEST__!.setStat(s);
    window.__TEST__!.teleport(z);
    window.__TEST__!.setAutoRun(true);
  }, [ridge1 - 10, 60] as const);
  await page.waitForFunction(() => window.__TEST__!.state().cameraViewBlend > 0, undefined, { timeout: 20_000 });
  const t0 = (await testState(page)).timeSec;
  await page.waitForFunction(() => window.__TEST__!.state().cameraViewBlend === 0, undefined, { timeout: 20_000 });
  expect((await testState(page)).timeSec - t0).toBeLessThanOrEqual(1.5 + 0.1);
  await page.evaluate(() => window.__TEST__!.setAutoRun(false));
  // The giant's shot, cut short by a turn of the camera by hand (a mouse drag).
  const zone = w.bosses[0]!.zone;
  await page.evaluate(([z, s]) => {
    window.__TEST__!.setStat(s);
    window.__TEST__!.teleport(z);
    window.__TEST__!.setAutoRun(true);
  }, [zone[0] - 6, 1e5] as const);
  await page.waitForFunction(() => window.__TEST__!.state().cameraViewBlend > 0.3, undefined, { timeout: 20_000 });
  const box = (await page.locator('#game').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5, { steps: 4 });
  await page.mouse.up();
  await waitTicks(page, 3);
  expect((await testState(page)).cameraViewBlend).toBe(0);
  await page.evaluate(() => window.__TEST__!.setAutoRun(false));
});

// RG: section 2 of mountain 2 is the chasm now (docs/01a-content.md 17.1); the first plain fork of section 2 is on mountain 4.
test('640×360: both lanes of the fork of section 2 of mountain 4 are in the frame from its start', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 640, height: 360 });
  await openGame('pace=open');
  await page.evaluate(() => window.__TEST__!.gotoWorld(4));
  await waitTicks(page, 20);
  const fork = worlds[3]!.segments.find((s) => s.type === 'fork' && s.section === 2)!;
  await page.evaluate(([z]) => {
    window.__TEST__!.setStat(1e6);
    window.__TEST__!.teleport(z);
  }, [fork.z - 8] as const);
  await waitTicks(page, 40);
  const mid = fork.z + fork.length! / 2;
  for (const x of [-forkLaneX(fork), forkLaneX(fork)]) {
    const p = await page.evaluate(([xx, zz]) => window.__TEST__!.project(xx, 2, zz), [x, mid] as const);
    expect(p.ahead, `lane x ${x}`).toBe(true);
    expect(p.x, `lane x ${x}`).toBeGreaterThan(0);
    expect(p.x, `lane x ${x}`).toBeLessThan(640);
    expect(p.y, `lane x ${x}`).toBeGreaterThan(0);
    expect(p.y, `lane x ${x}`).toBeLessThan(360);
  }
});
