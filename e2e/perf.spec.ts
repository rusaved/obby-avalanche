import { writeFileSync, mkdirSync } from 'node:fs';
import { test, expect, testState, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };

// «Размах» (SP) budgets (docs/01-gdd.md 20.11; docs/02-tech.md 9.5). SP-02: a simulation step on mountain 10 at CPU ×4
// with 6 bots at 120 units/s (tuning.controller.maxSpeed 120, Speed at the cap) stays within 2 ms.
const EVIDENCE = 'docs/evidence/sp';
type Seg = { type: string; z: number; kind?: string };
type OpenWorld = { id: string; segments: Seg[]; bosses: Array<{ zone: [number, number] }> };
const worlds = (openWorlds as unknown as { worlds: OpenWorld[] }).worlds;
/** SP-03 (docs/01-gdd.md 20.11): draw calls on the longer, wider mountains of «Размах» with far 800 — the target 45. */
const CALLS = 45;

test('SP-02: a simulation step on mountain 10 at CPU ×4 with 6 bots at 120 units/s stays within 2 ms', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high');
  await page.evaluate(() => window.__TEST__!.gotoWorld(10));
  await waitTicks(page, 30);
  await page.evaluate(() => {
    window.__TEST__!.holdWave(900);
    window.__TEST__!.setTuning('controller.maxSpeed', 120);
    window.__TEST__!.setStat(1e30);
    window.__TEST__!.teleport(60, -12);
    window.__TEST__!.setAutoRun(true);
  });
  await waitTicks(page, 30);
  const s0 = await testState(page);
  expect(s0.bots.length, 'bots out').toBe(6);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  // 300 ticks one by one in the page (as open-perf.spec.ts): the other worker's load hits few of them.
  const samples = await page.evaluate(() => {
    const out: Array<[number, number, number]> = [];
    for (let i = 0; i < 300; i++) {
      window.__TEST__!.runSim(1 / 60);
      const st = window.__TEST__!.state();
      out.push([st.lastStepMs, st.lastSimMs, st.hero!.speed]);
    }
    return out;
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.evaluate(() => window.__TEST__!.setAutoRun(false));
  const ms = samples.map((x) => x[0]);
  const top = Math.max(...samples.map((x) => x[2]));
  const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  const sorted = [...ms].sort((a, b) => a - b);
  const line = `mountain 10, CPU x4, 6 bots, run ${top.toFixed(0)} units/s, 300 ticks: sim.step mean ${mean.toFixed(3)} ms, median ${sorted[150]!.toFixed(3)} ms, p90 ${sorted[270]!.toFixed(3)} ms, max ${sorted[299]!.toFixed(3)} ms\n`;
  writeFileSync(`${EVIDENCE}/perf-sim.txt`, line);
  expect(top, 'ran at 120').toBeGreaterThan(110);
  // The mean: CPU throttling stops the page in quanta, a single tick that meets one is ~15 ms (docs/допущения.md).
  expect(mean, line).toBeLessThanOrEqual(2);
});

test('SP-03: draw calls at the foot, ridge 2 and the giant’s line of mountains 1, 5, 10 ≤ 45 (far 800)', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high');
  const rows: string[] = [];
  for (const n of [1, 5, 10]) {
    const w = worlds[n - 1]!;
    await page.evaluate((i) => window.__TEST__!.gotoWorld(i), n);
    await waitTicks(page, 20);
    await page.evaluate(() => window.__TEST__!.holdWave(900));
    const ridges = w.segments.filter((s) => s.type === 'gate' && s.kind === 'ridge').map((s) => s.z);
    for (const [name, z] of [['подножие', 20], ['рубеж 2', ridges[1]! - 6], ['начало зоны великана', w.bosses[0]!.zone[0] - 4]] as Array<[string, number]>) {
      await page.evaluate((zz) => window.__TEST__!.teleport(zz), z);
      await waitTicks(page, 30);
      const info = (await page.evaluate(() => window.__TEST__!.renderInfo()))!;
      rows.push(`| ${n} ${w.id} | ${name} | ${info.calls} | ${info.triangles} |`);
      const what = info.calls > CALLS ? JSON.stringify(await page.evaluate(() => window.__TEST__!.drawList())) : '';
      expect(info.calls, `mountain ${n}, ${name} ${what}`).toBeLessThanOrEqual(CALLS);
    }
  }
  writeFileSync(`${EVIDENCE}/perf.md`, ['# Размах: draw calls (SP-03)', '', `\`?pace=open&quality=high\`, 960×540, far 800; цель ${CALLS}.`, '', '| Гора | Точка | Draw calls | Треугольники |', '|---|---|---|---|', ...rows, ''].join('\n'));
});
