import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };

// PS-08: sections of the open slope (docs/01-gdd.md 17.7, 17.8). The physical bot takes the bold lane of section 2 of
// mountain 2 — the slide, the trampoline over the crevasse (or down and out of it), past the ice cliff — up to ridge 2.
// «Two ways: pick one» never shows while the hero runs, and shows once when he first stands at a fork for 2 s.
type Seg = { type: string; z: number; x?: number; x0?: number; x1?: number; length?: number; kind?: string; section?: number; bold?: string; wall?: number };
type OpenWorld = { segments: Seg[]; zones: Array<{ zStart: number; zEnd: number }> };
const worlds = (openWorlds as unknown as { worlds: OpenWorld[] }).worlds;
const EVIDENCE = 'docs/evidence/open';

async function pastScriptedWave(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
}

// RG: section 2 of mountain 2 is the chasm now (docs/01a-content.md 17.1); its fork of 17.7 is in section 3.
test('the bot takes the bold lane of section 3 on mountain 2: over the crevasse, past the cliff, up to ridge 3; screenshots', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high');
  await pastScriptedWave(page);
  await page.evaluate(() => window.__TEST__!.gotoWorld(2));
  await waitTicks(page, 20);
  const w = worlds[1]!;
  const fork = w.segments.find((s) => s.type === 'fork' && s.section === 3)!;
  const gap = w.segments.find((s) => s.type === 'gap' && s.z > fork.z && s.z < fork.z + fork.length!)!;
  const ridge2 = w.segments.filter((s) => s.type === 'gate' && s.kind === 'ridge')[2]!.z;
  const sx = fork.bold === 'left' ? -1 : 1;
  const xb = sx * 16;
  // The ridges of the mountain open by the stat: the run is about the lane.
  await page.evaluate(([z, s]) => {
    window.__TEST__!.setStat(s);
    window.__TEST__!.teleport(z);
  }, [fork.z - 12, 1e6] as const);
  await shot1080(page, `${EVIDENCE}/fork_1920x1080_ru.png`, 30);
  await page.evaluate(([x, z]) => window.__TEST__!.teleport(z, x), [xb, gap.z - 14] as const);
  await shot1080(page, `${EVIDENCE}/crevasse_1920x1080_ru.png`, 30);
  // The run: from below the slide, along the bold lane to the end of the fork, then to ridge 3.
  await page.evaluate(([x, z]) => window.__TEST__!.teleport(z, x), [xb, fork.z - 2] as const);
  await waitTicks(page, 5);
  await page.evaluate(
    ([x, zEnd, zr]) => window.__TEST__!.botPath([[x, zEnd + 10], [0, zr + 6]]),
    [xb, fork.z + fork.length!, ridge2] as const,
  );
  let minY = Infinity;
  let launched = false;
  for (let i = 0; i < 600; i++) {
    const s = await testState(page);
    if (Math.abs(s.hero!.z - (gap.z + 2.5)) < 3) minY = Math.min(minY, s.hero!.y);
    if (s.fun.launches > 0) launched = true;
    expect(s.respawning).toBe(false);
    if (s.hero!.z > ridge2 + 2) break;
    await waitTicks(page, 3);
  }
  const s = await testState(page);
  expect(s.hero!.z).toBeGreaterThan(ridge2);
  expect(s.gatesPassed[2]).toBe(true);
  // Over the crevasse by the trampoline, or down into it and out by its slope: either way on.
  expect(launched || minY < 0).toBe(true);
});

test('«Two ways: pick one»: not while the hero runs through a fork; once after he stands at one for 2 s', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await openGame('pace=open');
  await page.evaluate(() => window.__TEST__!.setPlaySec(240));
  await pastScriptedWave(page);
  const w = worlds[0]!;
  const fork = w.segments.find((s) => s.type === 'fork')!;
  const sx = fork.bold === 'left' ? 1 : -1;
  // Through the fork on the calm lane at a run: no plaque.
  await page.evaluate(([x, z, s]) => {
    window.__TEST__!.setStat(s);
    window.__TEST__!.teleport(z, x);
  }, [sx * 16, fork.z - 20, 60] as const);
  await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z]]), [sx * 16, fork.z + fork.length! - 5] as const);
  for (let i = 0; i < 40; i++) {
    expect((await testState(page)).hint).not.toBe('hint.fork');
    await waitTicks(page, 4);
  }
  await page.evaluate(() => window.__TEST__!.botPath(null));
  // Standing at the fork: after 2 s the plaque, once.
  await page.evaluate(([x, z]) => window.__TEST__!.teleport(z, x), [sx * 16, fork.z + 10] as const);
  await page.waitForFunction(() => window.__TEST__!.state().hint === 'hint.fork', undefined, { timeout: 15_000 });
  await expect(page.locator('[data-role="hint"].shown .hud-hint-text')).toHaveText('Две дороги: выбирай');
  await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z]]), [sx * 16, fork.z + 30] as const);
  await page.waitForFunction(() => window.__TEST__!.state().hint !== 'hint.fork', undefined, { timeout: 15_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  for (let i = 0; i < 30; i++) {
    expect((await testState(page)).hint).not.toBe('hint.fork');
    await waitTicks(page, 6);
  }
});
