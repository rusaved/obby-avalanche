import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };

// FM-01 (docs/01-gdd.md 19.9, Q-048): the invisible wall over the side borders, along the summit and behind its portal.
// The hero jumps sideways at both borders of mountains 1, 5 and 9 (20 jumps a side) and runs past the summit portal of
// mountain 1 — not one fall (no `fall` event, no white screen); since SP-01 the summit is a funnel (see below). The chasm
// of mountain 2 stays a way: rg-chasm.spec.ts.
type OpenWorld = { length: number; segments: Array<{ type: string; z: number; x?: number }> };
const worlds = (openWorlds as unknown as { worlds: OpenWorld[] }).worlds;
const EVIDENCE = 'docs/evidence/fm';

async function pastScriptedWave(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
}

const falls = (page: Page): Promise<number> => page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'fall').length);

/** Holds a side key and jumps `n` times, a jump every 40 ticks (a jump lasts about 38). */
async function jumpSideways(page: Page, key: 'KeyA' | 'KeyD', n: number): Promise<void> {
  await page.evaluate((k) => window.__TEST__!.keyDown(k), key);
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => window.__TEST__!.jump());
    await waitTicks(page, 40);
  }
  await page.evaluate((k) => window.__TEST__!.keyUp(k), key);
}

test('jumps sideways at both borders of mountains 1, 5 and 9 — no fall; screenshot', async ({ page, openGame }) => {
  // 4.6 min on the narrow slope, over 5 beside another worker on the wide one (SP-04).
  test.setTimeout(480_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await pastScriptedWave(page);
  for (const m of [1, 5, 9]) {
    if (m > 1) {
      await page.evaluate((i) => window.__TEST__!.gotoWorld(i), m);
      await waitTicks(page, 20);
    }
    const w = worlds[m - 1]!;
    await page.evaluate(() => {
      window.__TEST__!.holdWave(600);
      window.__TEST__!.setStat(1e12);
    });
    const before = await falls(page);
    for (const z of [80, Math.round(w.length * 0.6)]) {
      await page.evaluate((zz) => window.__TEST__!.teleport(zz, 0), z);
      await waitTicks(page, 10);
      const y0 = (await testState(page)).hero!.y;
      for (const key of ['KeyA', 'KeyD'] as const) {
        await jumpSideways(page, key, z === 80 ? 20 : 6);
        const s = await testState(page);
        // On the slope or in a grotto of the border (the grottos stand outside it), never below it.
        expect(s.respawning, `mountain ${m}, z ${z}, ${key}`).toBe(false);
        expect(s.hero!.y, `mountain ${m}, z ${z}, ${key}`).toBeGreaterThan(y0 - 4);
        if (m === 1 && z === 80 && key === 'KeyA') {
          await page.evaluate(() => window.__TEST__!.keyDown('KeyA'));
          await page.evaluate(() => window.__TEST__!.jump());
          await waitTicks(page, 14);
          await shot1080(page, `${EVIDENCE}/bounds_1920x1080_ru.png`, 2);
          await page.evaluate(() => window.__TEST__!.keyUp('KeyA'));
        }
      }
    }
    expect(await falls(page), `mountain ${m}: falls`).toBe(before);
  }
});

// SP-01 (docs/01-gdd.md 20.2): the summit is a funnel now — the way past the portal beside it is closed by its snow
// walls. Running and jumping up along each wall: not one fall, never past the portal plane outside its opening (he
// slides along the wall into the portal).
for (const side of [-1, 1]) {
  test(`mountain 1: up along the ${side < 0 ? 'left' : 'right'} funnel wall of the summit, jumping — no fall, never past the portal beside it`, async ({ page, openGame }) => {
    test.setTimeout(150_000);
    await openGame('pace=open');
    await page.evaluate(() => window.__TEST__!.setPlaySec(400));
    await pastScriptedWave(page);
    const w = worlds[0]!;
    const portal = w.segments.find((s) => s.type === 'portal')!;
    const funnel = w.segments.find((s) => s.type === 'funnel') as unknown as { z: number; from: number; to: number };
    await page.evaluate(() => {
      window.__TEST__!.holdWave(600);
      window.__TEST__!.setStat(1e12);
    });
    const z0 = funnel.z + 6;
    const edge = funnel.from + ((funnel.to - funnel.from) * 6) / (portal.z - funnel.z);
    await page.evaluate(([zz, xx]) => window.__TEST__!.teleport(zz, xx), [z0, side * (edge - 2)] as const);
    await waitTicks(page, 10);
    await page.evaluate(() => window.__TEST__!.keyDown('KeyW'));
    let outside = 0;
    for (let i = 0; i < 12; i++) {
      await page.evaluate(() => window.__TEST__!.jump());
      // 10 ticks, or the portal: its window pauses the game (the ticks stop).
      const t0 = (await testState(page)).ticks;
      await page.waitForFunction((t) => window.__TEST__!.state().ticks >= t || window.__TEST__!.simEvents.some((e) => e.name === 'portal'), t0 + 10, { timeout: 60_000 });
      const s = await testState(page);
      if (s.world !== 'slope') break;
      expect(s.respawning).toBe(false);
      if (s.hero!.z > portal.z && Math.abs(s.hero!.x) > (portal as { width?: number }).width! / 2) outside++;
      if (await page.evaluate(() => window.__TEST__!.simEvents.some((e) => e.name === 'portal'))) break;
    }
    await page.evaluate(() => window.__TEST__!.keyUp('KeyW'));
    expect(outside).toBe(0);
    expect(await falls(page)).toBe(0);
    expect(await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'portal').length), 'slid into the portal').toBe(1);
  });
}
