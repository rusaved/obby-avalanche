import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };
import openSpec from '../content/avalanche/pace/open/worlds-spec.json' with { type: 'json' };

// SP-04 (docs/01-gdd.md 20.4; docs/01a-content.md 19.2): the field of mountain 1 is section 2, 180 wide. A runner at either
// edge of it (x = ±(width/2 − 5)) at the minimum speed of the section reaches a shelter on the siren 10 times of 10; in
// the middle of the field at the hero's level the borders are out of the frame; the screenshot of the field.
type Seg = { type: string; z: number; kind?: string; requires?: number };
type OpenWorld = { zones: Array<{ zStart: number; zEnd: number }>; segments: Seg[] };
const world = (openWorlds as unknown as { worlds: OpenWorld[] }).worlds[0]!;
const width = (openSpec as unknown as { mountains: Array<{ sections: Array<{ width: number }> }> }).mountains[0]!.sections[1]!.width;
const field = world.zones[1]!;
const ridge1 = world.segments.find((s) => s.type === 'gate' && s.kind === 'ridge')!;
const EVIDENCE = 'docs/evidence/sp';

async function pastScriptedWave(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
}

test('a runner at an edge of the field of mountain 1 (±(width/2 − 5)) reaches a shelter on the siren 10 of 10', async ({ page, openGame }) => {
  test.setTimeout(420_000);
  await openGame('pace=open');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await pastScriptedWave(page);
  // The minimum speed of the section: the number of the ridge below it.
  await page.evaluate((st) => window.__TEST__!.setStat(st), ridge1.requires!);
  const x = width / 2 - 5;
  // Past the change of width (8 + 40 from the ridge), up to the approach rise.
  const L = field.zEnd - field.zStart;
  const zs = [0, 1, 2, 3, 4].map((k) => Math.round(field.zStart + 60 + ((0.7 * L - 60) * k) / 4));
  const rows: string[] = [];
  let safe = 0;
  for (const z of zs) {
    for (const sign of [-1, 1]) {
      await page.evaluate(() => window.__TEST__!.holdWave(600));
      await page.evaluate(([zz, xx]) => window.__TEST__!.teleport(zz, xx), [z, sign * x] as const);
      await waitTicks(page, 10);
      const before = await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'waveSurvived').length);
      await page.evaluate(() => window.__TEST__!.triggerWave());
      await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'warn', undefined, { timeout: 30_000 });
      const s = await testState(page);
      const shelters = await page.evaluate(() => window.__TEST__!.shelters());
      const target = shelters[s.wave!.shelter]!;
      // To its mouth, then in.
      await page.evaluate(([m, i]) => window.__TEST__!.botPath([m, i]), [target.mouth, target.inside] as const);
      await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'gone' || window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
      await page.evaluate(() => window.__TEST__!.botPath(null));
      const after = await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'waveSurvived').length);
      const ok = after > before;
      if (ok) safe++;
      rows.push(`z ${z}, x ${sign * x}: ${target.kind} at z ${target.z} — ${ok ? 'safe' : 'caught'}`);
      await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
    }
  }
  expect(safe, rows.join('\n')).toBe(10);
});

test('in the middle of the field of mountain 1 at the hero’s level the borders are out of the frame; screenshot', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await pastScriptedWave(page);
  await page.evaluate(() => {
    window.__TEST__!.holdWave(600);
    window.__TEST__!.setStat(1e4);
  });
  const z = Math.round((field.zStart + field.zEnd) / 2);
  await page.evaluate((zz) => window.__TEST__!.teleport(zz, 0), z - 30);
  await page.evaluate((zz) => window.__TEST__!.botPath([[0, zz]]), z);
  await page.waitForFunction((zz) => (window.__TEST__!.state().hero?.z ?? 0) >= zz - 1, z, { timeout: 30_000 });
  await waitTicks(page, 30);
  const s = await testState(page);
  const hz = s.hero!.z;
  const seen = await page.evaluate(
    ([e, z0, y]) => {
      const f = window.__TEST__!.state().field ?? { width: 1920, height: 1080 };
      const out: string[] = [];
      for (let zz = z0 - 5; zz <= z0 + 20; zz += 1)
        for (const sign of [-1, 1]) {
          const p = window.__TEST__!.project(sign * e, y + 1, zz);
          if (p.ahead && p.x >= 0 && p.x <= f.width && p.y >= 0 && p.y <= f.height) out.push(`x ${sign * e}, z ${zz}: (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`);
        }
      return out;
    },
    [width / 2, hz, s.hero!.y] as const,
  );
  expect(seen).toEqual([]);
  await shot1080(page, `${EVIDENCE}/field_m1_1920x1080_ru.png`, 4);
  await page.evaluate(() => window.__TEST__!.botPath(null));
});
