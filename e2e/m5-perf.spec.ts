import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect, waitTicks } from './fixtures.ts';
import { STAGES, flagOf, threshold } from './lv-stage-data.ts';

// M5-06 (docs/02-tech.md 9.5): the budgets on the final content of the release pace (stages). Rendering: draw calls ≤ 60,
// triangles ≤ 150 K, textures ≤ 16 at the start, the trial and the last finish of each of the 10 mountains; a switch of
// mountains ≤ 1 s at CPU ×4 and no growth of geometries and textures over 5 switches. Loading (@full): time to ready()
// ≤ 4 s and ≤ 1.2 MB before it, the median of 3 loads at 10 Mbit/s, RTT 100 ms, CPU ×4. docs/evidence/M5/budgets-*.txt.
const DIR = 'docs/evidence/M5';
const LIMIT = { calls: 60, triangles: 150_000, textures: 16, switchMs: 1000, readyMs: 4000, readyBytes: 1.2 * 1024 * 1024 };

test('M5-06: draw calls, triangles, textures at 3 points of each of the 10 mountains; a switch ≤ 1 s at CPU ×4, memory flat', async ({ page, openGame }) => {
  test.setTimeout(300_000);
  mkdirSync(DIR, { recursive: true });
  await page.setViewportSize({ width: 960, height: 540 });
  await openGame('pace=stages&quality=high');
  await page.evaluate(() => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.setFlag('firstWaveDone', true);
    window.__TEST__!.setTutor(9);
  });
  const rows: string[] = [];
  let worst = { calls: 0, triangles: 0, textures: 0 };
  for (let wi = 1; wi <= 10; wi++) {
    if (wi > 1) await page.evaluate((i) => window.__TEST__!.gotoWorld(i), wi);
    await waitTicks(page, 20);
    const stages = STAGES[wi - 1]!.stages;
    const mid = stages[Math.floor(stages.length / 2)]!;
    const last = stages[stages.length - 1]!;
    for (const [name, st, z] of [['start', stages[0]!, stages[0]!.start + 4], ['trial', mid, flagOf(wi, mid).z + 2], ['finish', last, last.finish[0] + 1]] as const) {
      await page.evaluate(([s, zz]) => {
        window.__TEST__!.holdWave(9000);
        window.__TEST__!.setStat(s);
        window.__TEST__!.teleport(zz);
      }, [threshold(st.level) * 1.05, z] as const);
      await waitTicks(page, 30);
      const info = (await page.evaluate(() => window.__TEST__!.renderInfo()))!;
      rows.push(`| ${wi} | ${name} | ${info.calls} | ${info.triangles} | ${info.textures} |`);
      worst = { calls: Math.max(worst.calls, info.calls), triangles: Math.max(worst.triangles, info.triangles), textures: Math.max(worst.textures, info.textures) };
    }
  }
  // A switch of mountains at CPU ×4 (the build of the level and its meshes), memory after 5 switches.
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => window.__TEST__!.gotoWorld(1));
  await waitTicks(page, 20);
  const before = (await page.evaluate(() => window.__TEST__!.renderInfo()))!;
  const switchTo = (i: number): Promise<number> =>
    page.evaluate((n) => {
      const t0 = performance.now();
      window.__TEST__!.gotoWorld(n);
      window.__TEST__!.stepFrames(1);
      return performance.now() - t0;
    }, i);
  // M6: the player switches from the base, where the own mountain's collision trees are built ahead a slice a frame
  // (src/sim/collision.ts) — here built at full speed (a slice a frame at CPU ×4 takes minutes of test time), the switch
  // itself at CPU ×4. For the record, one switch without the prebuild.
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const cold = await switchTo(6);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await waitTicks(page, 20);
  const switches: number[] = [];
  for (const n of [2, 5, 8, 10, 1]) {
    await page.evaluate((i) => window.__TEST__!.prebuildWorld(i), n);
    await expect.poll(async () => page.evaluate(() => window.__TEST__!.prebuildReady()), { timeout: 60_000, intervals: [200] }).toBe(true);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    switches.push(await switchTo(n));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await waitTicks(page, 20);
  }
  const after = (await page.evaluate(() => window.__TEST__!.renderInfo()))!;
  writeFileSync(
    `${DIR}/budgets-render.txt`,
    [
      `M5-06 · budgets of rendering (docs/02-tech.md 9.5), pace stages, quality high, 960×540, build:e2e, SwiftShader, ${new Date().toISOString()}`,
      `worst: draw calls ${worst.calls} / ${LIMIT.calls}, triangles ${worst.triangles} / ${LIMIT.triangles}, textures ${worst.textures} / ${LIMIT.textures}`,
      `switch of mountains at CPU x4, the trees built ahead (as from the base): ${switches.map((x) => x.toFixed(0)).join(', ')} ms (max ${Math.max(...switches).toFixed(0)} / ${LIMIT.switchMs}); without the prebuild: ${cold.toFixed(0)} ms`,
      `memory, mountain 1 before and after 5 switches: geometries ${before.geometries} -> ${after.geometries}, textures ${before.textures} -> ${after.textures}`,
      '',
      '| mountain | point | draw calls | triangles | textures |',
      '|---|---|---|---|---|',
      ...rows,
      '',
    ].join('\n'),
  );
  expect(worst.calls).toBeLessThanOrEqual(LIMIT.calls);
  expect(worst.triangles).toBeLessThanOrEqual(LIMIT.triangles);
  expect(worst.textures).toBeLessThanOrEqual(LIMIT.textures);
  expect(Math.max(...switches)).toBeLessThanOrEqual(LIMIT.switchMs);
  expect(after.geometries).toBeLessThanOrEqual(before.geometries);
  expect(after.textures).toBeLessThanOrEqual(before.textures);
});

test('M5-06 @full: time to ready() ≤ 4 s and ≤ 1.2 MB before it — median of 3 loads at 10 Mbit/s, RTT 100 ms, CPU ×4', async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(DIR, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: (10 * 1024 * 1024) / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  let bytes = 0;
  cdp.on('Network.loadingFinished', (e: { encodedDataLength: number }) => (bytes += e.encodedDataLength));
  const runs: Array<{ ms: number; bytes: number }> = [];
  // The phone of the 4G case (docs/02-tech.md 9.5): its own quality level; one load first warms the server and the disk.
  const url = '/?pace=stages&mock_device=mobile';
  await page.goto(url);
  await page.waitForFunction(() => (window.__YA_MOCK__?.calls ?? []).some((c) => c.name === 'LoadingAPI.ready'), undefined, { timeout: 60_000 });
  await page.goto('about:blank');
  for (let i = 0; i < 3; i++) {
    bytes = 0;
    const t0 = Date.now();
    await page.goto(url);
    await page.waitForFunction(() => (window.__YA_MOCK__?.calls ?? []).some((c) => c.name === 'LoadingAPI.ready'), undefined, { timeout: 60_000, polling: 25 });
    runs.push({ ms: Date.now() - t0, bytes });
    await page.goto('about:blank');
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const ms = runs.map((r) => r.ms).sort((a, b) => a - b)[1]!;
  const mb = runs.map((r) => r.bytes).sort((a, b) => a - b)[1]!;
  writeFileSync(
    `${DIR}/budgets-load.txt`,
    [
      `M5-06 · loading (docs/02-tech.md 9.5), build:e2e (with the test API and the SDK mock), phone (mock_device=mobile), 10 Mbit/s, RTT 100 ms, CPU x4, cache off, after one warm-up load, ${new Date().toISOString()}`,
      ...runs.map((r, k) => `load ${k + 1}: ready() at ${r.ms} ms, ${(r.bytes / 1024).toFixed(0)} KB before it`),
      `median: ${ms} ms / ${LIMIT.readyMs}; ${(mb / 1024).toFixed(0)} KB / ${(LIMIT.readyBytes / 1024).toFixed(0)} KB`,
      '',
    ].join('\n'),
  );
  expect(ms).toBeLessThanOrEqual(LIMIT.readyMs);
  expect(mb).toBeLessThanOrEqual(LIMIT.readyBytes);
});
