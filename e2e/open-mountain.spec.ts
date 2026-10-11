import { mkdirSync } from 'node:fs';
import { test, expect, testState, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };

// PS-03: mountains of the open slope (docs/01-gdd.md 17.2; docs/01a-content.md 16.1, 16.5): every one of the 10 loads
// by teleport without console errors — the camp, the ridges, the grotto before the giant's zone, the summit; evidence
// screenshots of mountain 1 at 1920×1080: the camp, ridge 2 seen from section 2, the line of the giant's zone.
type Seg = { type: string; z: number; x?: number; side?: string; kind?: string; length?: number; wall?: number };
type OpenWorld = { id: string; length: number; wallCount: number; segments: Seg[]; bosses: Array<{ zone: [number, number] }> };
const worlds = (openWorlds as unknown as { worlds: OpenWorld[] }).worlds;
const EVIDENCE = 'docs/evidence/open';

test('open slope: every one of the 10 mountains loads by teleport (camp, ridges, grotto before the giant, summit); screenshots', async ({ page, openGame }) => {
  test.setTimeout(300_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame('pace=open&quality=high');
  await waitTicks(page, 20);
  let s = await testState(page);
  expect(s.pace).toBe('open');
  expect(s.width).toBe(56);
  await page.screenshot({ path: `${EVIDENCE}/mountain1_camp_1920x1080_ru.png` });
  // Ridge 2 from the middle of section 2: the low carniz with its number, the next terrace over it.
  const m1 = worlds[0]!;
  const ridges = m1.segments.filter((x) => x.type === 'gate' && x.kind === 'ridge').map((x) => x.z);
  await page.evaluate((z) => window.__TEST__!.teleport(z), ridges[1]! - 70);
  await waitTicks(page, 30);
  await page.screenshot({ path: `${EVIDENCE}/mountain1_ridge2_1920x1080_ru.png` });
  // The line of the giant's zone from the grotto with the belt before it.
  const line = m1.bosses[0]!.zone[0];
  await page.evaluate((z) => window.__TEST__!.teleport(z), line - 12);
  await waitTicks(page, 30);
  await page.screenshot({ path: `${EVIDENCE}/mountain1_bossline_1920x1080_ru.png` });
  await page.setViewportSize({ width: 960, height: 540 });

  for (let n = 1; n <= worlds.length; n++) {
    const w = worlds[n - 1]!;
    await page.evaluate((i) => window.__TEST__!.gotoWorld(i), n);
    await waitTicks(page, 30);
    s = await testState(page);
    expect(s.world).toBe(w.id);
    expect(s.width).toBe(56);
    expect(s.gatesOpen).toHaveLength(w.wallCount);
    expect(s.hero!.z).toBeLessThan(40);
    expect(s.hero!.onGround).toBe(true);
    const flags = w.segments.filter((x) => x.type === 'checkpoint').map((x) => x.z);
    const grotto = w.segments.find((x) => x.type === 'niche' && x.kind === 'bossLine')!;
    for (const z of [20, ...flags.slice(0, 2), grotto.z, w.length - 30]) {
      await page.evaluate((zz) => window.__TEST__!.teleport(zz), z);
      await waitTicks(page, 30);
      s = await testState(page);
      expect(s.respawning, `mountain ${n} at z ${z}`).toBe(false);
      expect(Math.abs(s.hero!.z - z), `mountain ${n} at z ${z}`).toBeLessThan(3);
      expect(s.hero!.onGround, `mountain ${n} at z ${z}`).toBe(true);
    }
    const info = await page.evaluate(() => window.__TEST__!.renderInfo());
    expect(info!.calls, `mountain ${n}`).toBeLessThanOrEqual(60);
  }
});
