import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { forkLaneX } from './base-route.ts';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };

// RG-09: big sectors of mountains 8–10 (docs/01-gdd.md 18.2–18.3, 18.6; docs/01a-content.md 17.1). The physical bot runs
// section 2 of each — up the middle through the throat and over the chasm, the calm lane of the fork (the tunnel where it
// is) to the ridge — without getting stuck; draw calls ≤ 40 and triangles ≤ 100k at 3 points of each; screenshot.
type Seg = { type: string; z: number; y?: number; length?: number; section?: number; kind?: string; bold?: string; wall?: number; between?: number; track?: number };
type OpenWorld = { segments: Seg[]; zones: Array<{ k: number; zStart: number; zEnd: number }> };
const worlds = (openWorlds as unknown as { worlds: OpenWorld[] }).worlds;
const EVIDENCE = 'docs/evidence/rg';

async function start(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
}

for (const index of [8, 9, 10]) {
  test(`mountain ${index}: the bot runs section 2 through its elements without getting stuck; ≤ 40 draw calls at 3 points`, async ({ page, openGame }) => {
    test.setTimeout(150_000);
    mkdirSync(EVIDENCE, { recursive: true });
    await openGame('pace=open&quality=high');
    await start(page);
    await page.evaluate((i) => window.__TEST__!.gotoWorld(i), index);
    await waitTicks(page, 20);
    await page.evaluate(() => {
      window.__TEST__!.holdWave(120);
      window.__TEST__!.setStat(1e18);
    });
    const w = worlds[index - 1]!;
    const zone = w.zones.find((z) => z.k === 2)!;
    const fork = w.segments.find((s) => s.type === 'fork' && s.section === 2)!;
    const calm = (fork.bold === 'left' ? 1 : -1) * forkLaneX(fork);
    const ridge = w.segments.filter((s) => s.type === 'gate' && s.kind === 'ridge')[1]!;
    // Draw calls and triangles at the start of the section, in the fork, under the ridge.
    for (const [x, z] of [[0, zone.zStart + 14], [calm, fork.z + fork.length! / 2], [0, ridge.z - 10]] as const) {
      await page.evaluate(([xx, zz]) => window.__TEST__!.teleport(zz, xx), [x, z] as const);
      await waitTicks(page, 20);
      const info = (await page.evaluate(() => window.__TEST__!.renderInfo()))!;
      expect(info.calls, `calls at ${x},${z}`).toBeLessThanOrEqual(40);
      expect(info.triangles, `triangles at ${x},${z}`).toBeLessThanOrEqual(100_000);
    }
    await page.evaluate((z) => window.__TEST__!.teleport(z, 0), zone.zStart + 14);
    await waitTicks(page, 10);
    // The pass of ridge 2 on the calm lane's side nearest it (SP-04: the passes go by the width).
    const passes = ((ridge as { passes?: number[] }).passes ?? [0]).filter((x) => Math.sign(x) === Math.sign(calm));
    const passX = passes.reduce((a, b) => (Math.abs(b - calm) < Math.abs(a - calm) ? b : a), passes[0] ?? 0);
    await page.evaluate(
      ([fz, cx, fe, px, rz]) => window.__TEST__!.botPath([[0, fz - 6], [cx, fz + 6], [cx, fe], [px, rz - 12], [px, rz + 8]]),
      [fork.z, calm, fork.z + fork.length!, passX, ridge.z] as const,
    );
    let prevZ = -Infinity;
    let back = 0;
    for (let k = 0; k < 900; k++) {
      const s = await testState(page);
      expect(s.respawning).toBe(false);
      if (s.hero!.z < prevZ - 1) back++;
      prevZ = Math.max(prevZ, s.hero!.z);
      if (s.hero!.z > ridge.z + 4) break;
      await waitTicks(page, 3);
    }
    const s = await testState(page);
    await page.evaluate(() => window.__TEST__!.botPath(null));
    expect(s.hero!.z, 'past ridge 2').toBeGreaterThan(ridge.z);
    expect(back).toBe(0);
    if (index === 10) {
      // Section 4 of mountain 10: the throat, the chasm, the fork with the tunnel and the hump — from above its start.
      const z4 = w.zones.find((z) => z.k === 4)!;
      await page.evaluate((z) => window.__TEST__!.teleport(z, 0), z4.zStart + 10);
      await page.evaluate(() => window.__TEST__!.setCamera({ yaw: 0, pitch: 0.45, dist: 20 }));
      // The banner of the zone gone.
      await waitTicks(page, 240);
      await shot1080(page, `${EVIDENCE}/sector10_1920x1080_ru.png`, 5);
      await page.evaluate(() => window.__TEST__!.setCamera('auto'));
    }
  });
}
