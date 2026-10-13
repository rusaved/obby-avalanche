import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import { forkLaneX, passX, worlds } from './base-route.ts';

// SP-05 (docs/01-gdd.md 20.5; docs/01a-content.md 19.3): the fork of section 2 of mountain 1 is two lanes either side of a
// crevasse. The physical bot runs each lane up to ridge 2, not one fall; from one lane the floor of the other is in the
// frame; dropped on the bottom it is out up the slope within 4 s; «Two ways: pick one» only after a 2 s stop at the fork.
const w = worlds[0]!;
const fork = w.segments.find((s) => s.type === 'fork')!;
const ridge2 = w.segments.filter((s) => s.type === 'gate' && s.kind === 'ridge')[1]!;
const lane = forkLaneX(fork);
const EVIDENCE = 'docs/evidence/sp';

async function pastScriptedWave(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
}
const falls = (page: Page): Promise<number> => page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'fall' || e.name === 'respawn').length);

test('each lane of the fork up to ridge 2, no fall; the other lane in the frame; screenshot', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await pastScriptedWave(page);
  const px = passX(ridge2);
  for (const sign of [-1, 1]) {
    await page.evaluate((st) => {
      window.__TEST__!.holdWave(900);
      window.__TEST__!.setStat(st);
    }, ridge2.requires! * 1.2);
    await page.evaluate(([x, z]) => window.__TEST__!.teleport(z, x), [sign * lane, fork.z - 20] as const);
    await waitTicks(page, 10);
    const before = await falls(page);
    const mid = fork.z + fork.length! / 2;
    await page.evaluate((p) => window.__TEST__!.botPath(p), [
      [sign * lane, mid],
      [sign * lane, fork.z + fork.length!],
      [px, ridge2.z - 4],
      [px, ridge2.z + 12],
    ] as Array<[number, number]>);
    await page.waitForFunction((z) => (window.__TEST__!.state().hero?.z ?? 0) >= z, mid - 30, { timeout: 60_000 });
    const s = await testState(page);
    // The floor of the other lane ahead of him is in the frame (the crevasse lets him see it).
    const seen = await page.evaluate(
      ([x, y, z]) => {
        const f = window.__TEST__!.state().field;
        let n = 0;
        for (let dz = 10; dz <= 60; dz += 10) {
          const p = window.__TEST__!.project(x, y, z + dz);
          if (p.ahead && p.x >= 0 && p.x <= f.width && p.y >= 0 && p.y <= f.height) n++;
        }
        return n;
      },
      [-sign * lane, s.hero!.y, s.hero!.z] as const,
    );
    expect(seen, `lane ${sign}: the other lane in the frame`).toBeGreaterThan(0);
    if (sign < 0) await shot1080(page, `${EVIDENCE}/fork_m1_1920x1080_ru.png`, 2);
    await page.waitForFunction((z) => (window.__TEST__!.state().hero?.z ?? 0) > z, ridge2.z + 8, { timeout: 60_000 });
    expect(await falls(page), `lane ${sign}: falls`).toBe(before);
    await page.evaluate(() => window.__TEST__!.botPath(null));
  }
});

test('dropped on the bottom of the crevasse: out up its slope within 4 s, no fall', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await openGame('pace=open');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await pastScriptedWave(page);
  await page.evaluate((st) => {
    window.__TEST__!.holdWave(900);
    window.__TEST__!.setStat(st);
  }, ridge2.requires!);
  const y = (fork as { y?: number }).y ?? 0;
  for (const t of [0.15, 0.5, 0.85]) {
    const z = fork.z + t * fork.length!;
    await page.evaluate((zz) => window.__TEST__!.teleport(zz, 0), z);
    // Down onto the bottom (3 units: about half a second).
    await waitTicks(page, 40);
    const s0 = await testState(page);
    expect(s0.hero!.y, 'on the bottom').toBeLessThan(y - 1);
    const before = await falls(page);
    await page.evaluate((zz) => window.__TEST__!.botPath([[0, zz]]), z + 80);
    await page.waitForFunction((yy) => (window.__TEST__!.state().hero?.y ?? -99) > yy - 0.3 && window.__TEST__!.state().hero!.onGround, y, { timeout: 30_000 });
    const s1 = await testState(page);
    expect(s1.timeSec - s0.timeSec, `out from z ${z.toFixed(0)}`).toBeLessThanOrEqual(4);
    expect(await falls(page)).toBe(before);
    await page.evaluate(() => window.__TEST__!.botPath(null));
  }
});

test('«Two ways: pick one»: not while running through the fork; after a 2 s stop at it', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await openGame('pace=open');
  await page.evaluate(() => window.__TEST__!.setPlaySec(240));
  await pastScriptedWave(page);
  const sx = fork.bold === 'left' ? 1 : -1;
  await page.evaluate(([x, z, st]) => {
    window.__TEST__!.setStat(st);
    window.__TEST__!.teleport(z, x);
  }, [sx * lane, fork.z - 20, 60] as const);
  await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z]]), [sx * lane, fork.z + fork.length! - 5] as const);
  for (let i = 0; i < 30; i++) {
    expect((await testState(page)).hint).not.toBe('hint.fork');
    await waitTicks(page, 4);
  }
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await page.evaluate(([x, z]) => window.__TEST__!.teleport(z, x), [sx * lane, fork.z + 10] as const);
  const t0 = (await testState(page)).timeSec;
  await page.waitForFunction(() => window.__TEST__!.state().hint === 'hint.fork', undefined, { timeout: 15_000 });
  expect((await testState(page)).timeSec - t0).toBeGreaterThanOrEqual(1.9);
});
