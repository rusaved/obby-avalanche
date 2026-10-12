import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };
import openSpec from '../content/avalanche/pace/open/worlds-spec.json' with { type: 'json' };

// RG-08: the hump of mountain 8 (docs/01-gdd.md 18.3; docs/01a-content.md 17.2). The physical bot runs up the ice slide,
// the trampoline on the crest throws him over the section into the landing; no «+N» in the air; the 6 gifts of the
// flight taken; the siren in the flight — he is in the landing grotto before the front.
type Seg = { type: string; z: number; y?: number; length?: number; section?: number; side?: string; x0?: number; x1?: number; land?: [number, number]; landEnd?: number };
const w8 = (openWorlds as unknown as { worlds: Array<{ segments: Seg[]; threat: { warnSec: number } }> }).worlds[7]!;
const hump = w8.segments.find((s) => s.type === 'hump' && s.section === 2)!;
const xm = (hump.x0! + hump.x1!) / 2;
const STAT = (openSpec as unknown as { mountains: Array<{ ridges: Array<{ requires: number }> }> }).mountains[7]!.ridges[0]!.requires;
const EVIDENCE = 'docs/evidence/rg';

async function toMountain8(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  await page.evaluate(() => window.__TEST__!.gotoWorld(8));
  await waitTicks(page, 20);
  await page.evaluate((st) => {
    window.__TEST__!.holdWave(120);
    window.__TEST__!.setStat(st);
  }, STAT);
}

/** Up the hump along the middle of its lane to the landing; returns the launch and landing ticks of the sim and where
 * he came down — from its land event, not from the moment the test looked (a slow runner looks late). */
async function upAndOver(page: Page, onFlight?: () => Promise<void>): Promise<{ launch: number; land: number; landZ: number }> {
  await page.evaluate(([x, z]) => window.__TEST__!.teleport(z, x), [xm, hump.z - 12] as const);
  await waitTicks(page, 10);
  await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z]]), [xm, hump.landEnd! + 4] as const);
  let launch = -1;
  let land = -1;
  let landZ = 0;
  for (let k = 0; k < 600 && land < 0; k++) {
    const s = await testState(page);
    if (launch < 0 && s.fun.padFlight) {
      launch = s.simTick;
      if (onFlight) await onFlight();
    } else if (launch >= 0 && !s.fun.padFlight && s.hero!.onGround) {
      // The landing itself: the first land event of the sim after the launch (its tick and z).
      const ev = (await page.evaluate((t) => window.__TEST__!.simEvents.find((e) => e.name === 'land' && e['world'] === 8 && (e.tick as number) > t), launch)) as { tick: number; z: number } | undefined;
      land = ev?.tick ?? s.simTick;
      landZ = ev?.z ?? s.hero!.z;
    }
    if (land < 0) await waitTicks(page, 1);
  }
  return { launch, land, landZ };
}

test('mountain 8: up the hump, off the crest into the landing; no «+N» in the air; the gifts of the flight; screenshot', async ({ page, openGame }) => {
  test.setTimeout(150_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high');
  await toMountain8(page);
  const st0 = await testState(page);
  const air = st0.gifts.flatMap((g, i) => (g.z > hump.z + hump.length! && g.z < hump.land![1] && g.y > hump.y! + 2 ? [i] : []));
  expect(air).toHaveLength(6);
  const { launch, land, landZ } = await upAndOver(page, async () => {
    await shot1080(page, `${EVIDENCE}/hump_1920x1080_ru.png`, 1);
  });
  expect(launch).toBeGreaterThan(0);
  expect(land).toBeGreaterThan(launch);
  expect(landZ).toBeGreaterThanOrEqual(hump.land![0] - 3);
  expect(landZ).toBeLessThanOrEqual(hump.landEnd! + 3);
  const gains = (await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'gain').map((e) => e.tick as number))) as number[];
  expect(gains.filter((t) => t > launch + 1 && t < land - 1)).toEqual([]);
  const s = await testState(page);
  for (const i of air) expect(s.giftsTaken[i], `gift ${i}`).toBe(true);
});

test('mountain 8: the siren in the flight — into the landing grotto before the front', async ({ page, openGame }) => {
  test.setTimeout(150_000);
  await openGame('pace=open');
  await toMountain8(page);
  await upAndOver(page, async () => {
    await page.evaluate(() => {
      window.__TEST__!.holdWave(0);
      window.__TEST__!.triggerWave();
    });
  });
  // Landed: the lit shelter of this moment (the warning follows the hero) — a grotto by the landing, on his lane.
  let s = await testState(page);
  expect(s.wave!.phase).toBe('warn');
  const lit = (await page.evaluate(() => window.__TEST__!.shelters()))[s.wave!.shelter]!;
  expect(lit.side).toBe(hump.side);
  expect(Math.abs(lit.z - s.hero!.z)).toBeLessThan(30);
  await page.evaluate(([mx, mz, ix, iz]) => window.__TEST__!.botPath([[mx, mz], [ix, iz]]), [lit.mouth[0], lit.mouth[1], lit.inside[0], lit.inside[1]] as const);
  await page.waitForFunction(() => ['survived', 'caught'].includes(window.__TEST__!.state().wave?.outcome ?? ''), undefined, { timeout: 60_000 });
  s = await testState(page);
  expect(s.wave!.outcome).toBe('survived');
});
