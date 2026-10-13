import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };

// SP-07 (docs/01-gdd.md 20.7; docs/01a-content.md 19.5): the relief. A «child» bot on mountain 1 — the stick anywhere
// forward, now and then a jump — 10 runs from the camp up the terraces of 12: never a fall (respawn); the screenshot of
// the relief of mountain 8 (the terrace up to a ridge, the hump of section 2). The chasm of mountain 2 by the trampoline
// and down, the hump of mountain 8 into its landing — rg-chasm.spec.ts and rg-hump.spec.ts.
type Seg = { type: string; z: number; y?: number; length?: number; section?: number; x0?: number; x1?: number };
type OpenWorld = { segments: Seg[]; bosses: Array<{ zone: [number, number]; requires: number }> };
const worlds = (openWorlds as unknown as { worlds: OpenWorld[] }).worlds;
const EVIDENCE = 'docs/evidence/sp';

async function pastScriptedWave(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
}

/** A small deterministic random (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('mountain 1: a «child» bot, 10 runs of 40 s from the camp up the terraces — not one fall', async ({ page, openGame }) => {
  test.setTimeout(600_000);
  await openGame('pace=open');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await pastScriptedWave(page);
  // Speed past the giant: every ridge open, the giant passed; the avalanche held.
  const stat = worlds[0]!.bosses[0]!.requires * 1.3;
  const summit = worlds[0]!.bosses[0]!.zone[1];
  const rows: string[] = [];
  let falls = 0;
  for (let run = 0; run < 10; run++) {
    const r = rng(1000 + run);
    await page.evaluate((st) => {
      window.__TEST__!.setTimeScale(4);
      window.__TEST__!.holdWave(900);
      window.__TEST__!.setStat(st);
      window.__TEST__!.resetGiants();
    }, stat);
    await page.evaluate(() => window.__TEST__!.teleport(20, 0));
    await waitTicks(page, 10);
    let fell = 0;
    let was = false;
    let top = 0;
    for (let k = 0; k < (40 * 60) / 30; k++) {
      // A new whim every half second: anywhere forward, a third of the time a jump.
      await page.evaluate(
        ([x, y, j, st]) => {
          window.__TEST__!.stick(x, y);
          if (j) window.__TEST__!.jump();
          window.__TEST__!.setStat(st);
        },
        [r() * 2 - 1, 0.3 + 0.7 * r(), r() < 0.33, stat] as const,
      );
      await waitTicks(page, 30);
      const s = await testState(page);
      if (s.respawning && !was) fell++;
      was = s.respawning;
      top = Math.max(top, s.hero!.z);
      // On the summit: the run is over before the portal takes him away.
      if (s.hero!.z > summit - 10) break;
    }
    await page.evaluate(() => window.__TEST__!.stick(0, 0));
    falls += fell;
    rows.push(`run ${run + 1}: up to z ${top.toFixed(0)}, falls ${fell}`);
  }
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  console.log(rows.join('\n'));
  expect(falls, rows.join('\n')).toBe(0);
});

test('the relief of mountain 8: the terrace up to its ridge and the hump of section 2; screenshot', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await pastScriptedWave(page);
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  await page.evaluate(() => window.__TEST__!.gotoWorld(8));
  await waitTicks(page, 20);
  await page.evaluate(() => {
    window.__TEST__!.holdWave(900);
    window.__TEST__!.setStat(1e18);
  });
  const w = worlds[7]!;
  const hump = w.segments.find((s) => s.type === 'hump' && s.section === 2)!;
  const x = (hump.x0! + hump.x1!) / 2;
  await page.evaluate(([z, xx]) => window.__TEST__!.teleport(z, xx), [hump.z - 40, x] as const);
  await page.evaluate(() => window.__TEST__!.setCamera({ yaw: 0, pitch: 0.3, dist: 26 }));
  // The banner of the section gone.
  await waitTicks(page, 240);
  await shot1080(page, `${EVIDENCE}/relief_m8_1920x1080_ru.png`, 4);
  await page.evaluate(() => window.__TEST__!.setCamera('auto'));
  const s = await testState(page);
  expect(s.respawning).toBe(false);
});
