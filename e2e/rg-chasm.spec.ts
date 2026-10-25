import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };
import openSpec from '../content/avalanche/pace/open/worlds-spec.json' with { type: 'json' };
import ru from '../content/avalanche/i18n/ru.json' with { type: 'json' };

// RG-02: the chasm of mountain 2 (docs/01-gdd.md 18.3; docs/01a-content.md 17.2). The physical bot over the middle
// trampoline takes the gifts in the air; past the plates it goes down, takes the 3 gifts of the bottom and out up the
// ramp; «Gifts below…» once a save; the siren over the chasm — a grotto is in reach from its bottom.
type Seg = { type: string; z: number; x?: number; y?: number; length?: number; depth?: number; section?: number; air?: boolean; bottom?: boolean };
const w2 = (openWorlds as unknown as { worlds: Array<{ segments: Seg[]; threat: { warnSec: number } }> }).worlds[1]!;
const chasm = w2.segments.find((s) => s.type === 'chasm' && s.section === 2)!;
const c0 = chasm.z;
const c1 = chasm.z + chasm.length!;
// RL-03 (docs/01-gdd.md 21.3): the middle of the chasm is a pit (a fall — back to the flag); the walk round its bottom is
// at the edges: the middle of the left one.
const pit = (w2.segments as Array<Seg & { x1?: number; side?: string }>).find((s) => s.type === 'pit' && s.section === 2 && s.side === undefined)!;
const half = (openSpec as unknown as { mountains: Array<{ sections: Array<{ width: number }> }> }).mountains[1]!.sections[1]!.width / 2;
const WALK = -(pit.x1! + half) / 2;
const STAT = (openSpec as unknown as { mountains: Array<{ ridges: Array<{ requires: number }> }> }).mountains[1]!.ridges[0]!.requires;
const EVIDENCE = 'docs/evidence/rg';

async function pastScriptedWave(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
}

async function toMountain2(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await pastScriptedWave(page);
  await page.evaluate(() => window.__TEST__!.gotoWorld(2));
  await waitTicks(page, 20);
  await page.evaluate((st) => {
    window.__TEST__!.holdWave(120);
    window.__TEST__!.setStat(st);
  }, STAT);
}

/** Runs the bot path to its end; returns the toasts seen on the way. */
async function run(page: Page, path: Array<[number, number]>, maxTicks = 900): Promise<string[]> {
  await page.evaluate((p) => window.__TEST__!.botPath(p), path);
  const toasts: string[] = [];
  for (let t = 0; t < maxTicks; t += 3) {
    const s = await testState(page);
    if (s.waveHud.toast && !toasts.includes(s.waveHud.toast)) toasts.push(s.waveHud.toast);
    expect(s.respawning).toBe(false);
    if ((await page.evaluate(() => window.__TEST__!.botLeft())) === 0) break;
    await waitTicks(page, 3);
  }
  return toasts;
}

test('mountain 2: over the chasm from the middle trampoline with the gifts in the air; screenshot', async ({ page, openGame }) => {
  test.setTimeout(150_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high');
  await toMountain2(page);
  await page.evaluate((z) => window.__TEST__!.teleport(z, 4), c0 - 16);
  await waitTicks(page, 10);
  await shot1080(page, `${EVIDENCE}/chasm_1920x1080_ru.png`, 20);
  await page.evaluate((z) => window.__TEST__!.teleport(z, 0), c0 - 30);
  await waitTicks(page, 10);
  const before = await testState(page);
  const air = before.gifts.flatMap((g, i) => (g.z > c0 - 1 && g.z < c1 + 1 && g.y > chasm.y! + 2 && Math.abs(g.x) < 1 ? [i] : []));
  expect(air).toHaveLength(2);
  await run(page, [[0, c1 + 20]]);
  const s = await testState(page);
  expect(s.fun.launches).toBeGreaterThan(0);
  for (const i of air) expect(s.giftsTaken[i], `air gift ${i}`).toBe(true);
  expect(s.hero!.z).toBeGreaterThan(c1 + 10);
});

test('mountain 2: by the walk at the edge down into the chasm, its gift, out up the ramp; the toast once; the siren from the bottom', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await openGame('pace=open');
  await toMountain2(page);
  const st0 = await testState(page);
  const bottom = st0.gifts.flatMap((g, i) => (g.z > c0 && g.z < c1 && g.y < chasm.y! - 2 ? [i] : []));
  expect(bottom).toHaveLength(3);
  const left = bottom.filter((i) => st0.gifts[i]!.x < 0);
  expect(left).toHaveLength(1);
  const g = st0.gifts[left[0]!]!;
  await page.evaluate(([z, x]) => window.__TEST__!.teleport(z!, x!), [c0 - 12, WALK]);
  await waitTicks(page, 10);
  const want = ru['toast.chasm'];
  const first = await run(page, [[WALK, c0 + 2], [g.x, g.z], [g.x, c1 + 8]]);
  let s = await testState(page);
  expect(s.giftsTaken[left[0]!], 'the bottom gift of the walk').toBe(true);
  expect(s.hero!.z).toBeGreaterThan(c1 + 4);
  // Out of the ramp at a run he is thrown a little (RL-04: like the way out of a dip): on the snow once he lands.
  await page.waitForFunction(() => window.__TEST__!.state().hero?.onGround === true, undefined, { timeout: 10_000 });
  s = await testState(page);
  expect(s.hero!.y).toBeCloseTo(chasm.y!, 0);
  // FX-01: the toast waits its turn behind one up before it (each holds its minimum) — it may come after the walk.
  if (!first.includes(want)) await page.waitForFunction((w) => window.__TEST__!.state().waveHud.toast === w, want, { timeout: 5_000 });
  // Down again, the first toast gone: no toast this time (once a save).
  await page.waitForFunction((w) => window.__TEST__!.state().waveHud.toast !== w, want, { timeout: 30_000 });
  await page.evaluate(([z, x]) => window.__TEST__!.teleport(z!, x!), [c0 - 12, WALK]);
  const again = await run(page, [[WALK, c0 + 2], [WALK, c1 + 8]]);
  expect(again).not.toContain(want);
  const downs = (await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'chasmDown').length)) as number;
  expect(downs).toBe(2);
  // The siren with the hero on the bottom: he runs to the lit shelter and is in it before the front.
  // A wave of the timer still fading out (gone) takes no trigger: wait it out first (verify SD: a race, not a bug), and
  // only then down to the bottom with the timer held — a timer wave that came while he waited there caught him and its
  // rollback put the triggered one to «gone» (verify M6, under load).
  await page.evaluate(() => window.__TEST__!.setTimeScale(4));
  await page.waitForFunction(() => (window.__TEST__!.state().wave?.phase ?? 'idle') === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  await page.evaluate(() => window.__TEST__!.holdWave(60));
  await page.evaluate(([z, x]) => window.__TEST__!.teleport(z!, x!), [c1 - 4, WALK]);
  await waitTicks(page, 20);
  s = await testState(page);
  expect(s.hero!.y).toBeLessThan(chasm.y! - 1);
  expect(s.caught, 'not rolled back').toBeNull();
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await waitTicks(page, 2);
  s = await testState(page);
  expect(s.wave!.phase).toBe('warn');
  const lit = (await page.evaluate(() => window.__TEST__!.shelters()))[s.wave!.shelter]!;
  // Game time (ticks), not the machine's.
  const t0 = s.ticks / 60;
  await page.evaluate(([mx, mz, ix, iz]) => window.__TEST__!.botPath([[mx, mz], [ix, iz]]), [lit.mouth[0], lit.mouth[1], lit.inside[0], lit.inside[1]] as const);
  let inAt = -1;
  for (let k = 0; k < 400 && inAt < 0; k++) {
    s = await testState(page);
    if (s.inShelter) inAt = s.ticks / 60;
    else await waitTicks(page, 2);
  }
  expect(inAt).toBeGreaterThan(0);
  expect(inAt - t0, `to ${JSON.stringify(lit)}`).toBeLessThanOrEqual(w2.threat.warnSec * 0.8);
  // In the shelter: the rest of the wave at ×4 (real seconds under load, not the game's).
  await page.evaluate(() => window.__TEST__!.setTimeScale(4));
  await page.waitForFunction(() => ['survived', 'caught'].includes(window.__TEST__!.state().wave?.outcome ?? ''), undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  expect((await testState(page)).wave!.outcome).toBe('survived');
});
