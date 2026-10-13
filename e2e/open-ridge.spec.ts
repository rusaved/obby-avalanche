import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };

// PS-04: the ridge of the open slope (docs/01-gdd.md 17.3, 17.9, 17.11). The physical bot (controller and collisions in
// the browser) runs up the middle from the camp and opens ridge 1 of mountain 1 on the approach without a stop; every
// passage melts at once, the coin fountain, the flag past it, the view frame higher and farther for 1.5 s and back. At the
// closed ridge 2 it only runs or stands on the belt of the ridge grotto. «▶ Ad: open the wall» never shows at a ridge;
// «▶ Ad: +N speed» shows in the ridge grotto after 60 s of play and the first avalanche.
type Seg = { type: string; z: number; x?: number; side?: string; kind?: string; length?: number; depth?: number; wall?: number };
const world = (openWorlds as unknown as { worlds: Array<{ segments: Seg[] }> }).worlds[0]!;
const ridges = world.segments.filter((s) => s.type === 'gate' && s.kind === 'ridge').map((s) => s.z);
const grottos = world.segments.filter((s) => s.type === 'niche' && s.kind === 'ridgeGrotto');
const flag1 = world.segments.find((s) => s.type === 'checkpoint' && s.wall === 1)!;
const TIME_SCALE = 4;
const EVIDENCE = 'docs/evidence/open';
/** The belt of the grotto right below ridge z as the game has it (SP-04: at the edge of its section, or a canopy by the run). */
async function beltBelow(page: Page, z: number): Promise<[number, number]> {
  const list = await page.evaluate(() => window.__TEST__!.shelters());
  const n = list.find((g) => g.belt !== null && g.z < z && g.z > z - 30)!;
  return n.belt!;
}

async function walk(page: Page, points: Array<[number, number]>): Promise<void> {
  await page.evaluate((p) => window.__TEST__!.botPath(p), points);
}

test('ridge 1 opens on the approach of the physical bot; all passages melt at once, fountain, flag, view frame; at ridge 2 only belt or run', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high');
  await waitTicks(page, 10);
  await page.evaluate((k) => window.__TEST__!.setTimeScale(k), TIME_SCALE);
  const t0 = (await testState(page)).timeSec;
  await walk(page, [[0, ridges[0]! + 16]]);
  // Up the middle without a stop: the ridge opens before the hero reaches it.
  await page.waitForFunction(() => window.__TEST__!.state().gatesOpen[0] === true, undefined, { timeout: 60_000 });
  let s = await testState(page);
  const openAt = s.timeSec;
  expect(openAt - t0, 'ridge 1 open by').toBeLessThanOrEqual(20);
  expect(s.hero!.z).toBeLessThan(ridges[0]!);
  expect(await page.evaluate(() => window.__TEST__!.gateStandMax())).toBeLessThan(0.5);
  // Within 0.5 s of game time every passage is open (one ice of the ridge melts whole).
  await page.waitForFunction((t) => window.__TEST__!.state().timeSec >= t + 0.5, openAt);
  s = await testState(page);
  expect(s.gateMelt[0]).toBe(1);
  // Up on the carniz: the ridge gift (fountain), the flag past it, the view frame.
  await page.waitForFunction(() => window.__TEST__!.state().gatesPassed[0] === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  let viewMax = 0;
  let rise = 0;
  let back = 0;
  for (let i = 0; i < 40; i++) {
    s = await testState(page);
    if (s.cameraViewBlend > viewMax) {
      viewMax = s.cameraViewBlend;
      rise = s.cameraPos[1] - s.hero!.y;
      back = Math.hypot(s.cameraPos[0] - s.hero!.x, s.cameraPos[1] - s.hero!.y, s.cameraPos[2] - s.hero!.z);
    }
    if (i === 8) await shot1080(page, `${EVIDENCE}/ridge_open_1920x1080_ru.png`, 1);
    await waitTicks(page, 3);
  }
  expect(viewMax).toBeGreaterThan(0.9);
  expect(s.funFx.fountains).toBeGreaterThanOrEqual(1);
  await page.waitForFunction((z) => window.__TEST__!.state().hero!.z >= z, flag1.z, { timeout: 30_000 });
  // The view ends by itself in 1.5 s; the camera is back behind the hero, lower and closer than in the frame.
  await page.waitForFunction(() => window.__TEST__!.state().cameraViewBlend === 0, undefined, { timeout: 30_000 });
  await walk(page, [[0, flag1.z + 3]]);
  await waitTicks(page, 40);
  s = await testState(page);
  const normalRise = s.cameraPos[1] - s.hero!.y;
  const normalBack = Math.hypot(s.cameraPos[0] - s.hero!.x, s.cameraPos[1] - s.hero!.y, s.cameraPos[2] - s.hero!.z);
  expect(rise, 'view frame higher').toBeGreaterThan(normalRise + 3);
  expect(back, 'view frame farther').toBeGreaterThan(normalBack + 1);

  // On to the closed ridge 2: off the fork cliff on the right, into the grotto under the ridge, onto its belt.
  const g2 = grottos[1]!;
  const b2 = await beltBelow(page, ridges[1]!);
  await page.evaluate((k) => window.__TEST__!.setTimeScale(k), TIME_SCALE);
  await walk(page, [
    [16, flag1.z + 6],
    [16, g2.z - 4],
    b2,
  ]);
  // The bot is off the flag where the test held it for the camera check.
  await page.waitForFunction((z) => window.__TEST__!.state().hero!.z > z + 2, flag1.z + 3, { timeout: 30_000 });
  let offBelt = 0;
  const offAt: string[] = [];
  let samples = 0;
  const until = (await testState(page)).timeSec + 30;
  for (;;) {
    s = await testState(page);
    if (s.timeSec >= until || s.gatesOpen[1]) break;
    samples++;
    const speed = Math.hypot(s.hero!.vx, s.hero!.vz);
    if (!s.onBelt && speed < 0.5 && !s.wave?.phase.match(/warn|run/)) {
      offBelt++;
      offAt.push(`x ${s.hero!.x.toFixed(1)} z ${s.hero!.z.toFixed(1)} wave ${s.wave?.phase} left ${await page.evaluate(() => window.__TEST__!.botLeft())}`);
    }
    await waitTicks(page, 20);
  }
  expect(samples).toBeGreaterThan(20);
  expect(offBelt, `stood off the belt at the closed ridge 2: ${offAt.join('; ')}`).toBe(0);
});

test('no «▶ Ad: open the wall» at any ridge; «▶ Ad: +N speed» in the ridge grotto after 60 s and the first avalanche', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await openGame('pace=open&mock_ad=ok');
  await page.evaluate(() => window.__TEST__!.setPlaySec(61));
  // The first avalanche (scripted) comes and goes: firstWaveDone.
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'idle' && window.__TEST__!.state().wave?.scriptedPending === false, undefined, { timeout: 90_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  for (const z of ridges) {
    await page.evaluate((zz) => window.__TEST__!.teleport(zz - 6), z);
    await waitTicks(page, 120);
    await expect(page.locator('[data-role="ads"]')).not.toContainText('открыть стену');
  }
  // In the grotto of ridge 1 on its belt: the button with the number of the reward.
  const b1 = await beltBelow(page, ridges[0]!);
  await page.evaluate(([x, z]) => window.__TEST__!.teleport(z, x), b1);
  await page.waitForFunction(() => window.__TEST__!.state().adButtons.includes('stat_now'), undefined, { timeout: 15_000 });
  const btn = page.locator('[data-hud="ad-stat_now"]');
  await expect(btn).toHaveText(/^▶ Реклама: \+.+ скорости$/);
  // The reward comes only with the ad (mock ok): the stat grows, the button rests for its cooldown.
  const before = (await testState(page)).stat;
  await btn.dispatchEvent('click');
  await page.waitForFunction(() => window.__TEST__!.state().adBusy === null && window.__TEST__!.state().pauseReasons.length === 0, undefined, { timeout: 20_000 });
  const s = await testState(page);
  expect(s.stat).toBeGreaterThan(before);
  expect(s.adButtons).not.toContain('stat_now');
  // SP-10 (docs/01-gdd.md 20.13): «Speed now» names its mountain.
  const resume = await page.evaluate(() => window.__TEST__!.analytics().filter((e) => e.name === 'ad_resume_ok').map((e) => e.params));
  expect(resume).toEqual([{ placement: 'stat_now', type: 'rewarded', mountain: 1 }]);
});

// PS-05: the section multiplier (docs/01-gdd.md 17.4): past ridge 1 every step of the run gives ×1.2 with the same shoes
// and pets, and the Speed plaque shows «×1,2 this section».
test('section multiplier: past ridge 1 a step gives ×1.2 with the same shoes and pets; the plaque shows ×1,2', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open');
  await waitTicks(page, 10);
  await expect(page.locator('[data-role="section-mult"]')).toHaveText('×1 за участок');
  await page.evaluate((k) => window.__TEST__!.setTimeScale(k), TIME_SCALE);
  await walk(page, [[0, flag1.z + 2], [-16, flag1.z + 40]]);
  await page.waitForFunction((z) => window.__TEST__!.state().hero!.z >= z, flag1.z + 38, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  const s = await testState(page);
  const events = await page.evaluate(() => window.__TEST__!.simEvents);
  const pass = events.find((e) => e.name === 'gatePass' && e['index'] === 0)!;
  const gains = events.filter((e) => e.name === 'gain' && e['belt'] === false);
  const before = gains.filter((e) => e.tick < pass.tick - 30).map((e) => e['amount'] as number);
  const after = gains.filter((e) => e.tick > pass.tick + 10).map((e) => e['amount'] as number);
  expect(before.length).toBeGreaterThan(5);
  expect(after.length).toBeGreaterThan(5);
  expect(s.shoeLevel).toBe(0);
  for (const a of before) expect(a).toBeCloseTo(1, 9);
  for (const a of after) expect(a).toBeCloseTo(1.2, 9);
  await expect(page.locator('[data-role="section-mult"]')).toHaveText('×1,2 за участок');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await waitTicks(page, 3);
  await page.locator('[data-role="stat"]').screenshot({ path: `${EVIDENCE}/hud_section_mult_1920x1080_ru.png` });
});

// Producer's playtest PS: the sign of an opened ridge hid as the hero went through it and came back behind him.
test('the sign of a ridge the hero has passed is gone for good, also when he looks back down', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await openGame('pace=open');
  await page.evaluate((z) => {
    window.__TEST__!.setStat(1e4);
    window.__TEST__!.teleport(z);
  }, ridges[0]! - 20);
  await waitTicks(page, 10);
  expect((await page.evaluate(() => window.__TEST__!.signBox(0))).hidden).toBe(false);
  // Through the middle passage, then the left lane of the fork of section 2 (its cliff stands on the axis).
  await walk(page, [[0, ridges[0]! + 12], [-16, ridges[0]! + 30]]);
  await page.waitForFunction(() => window.__TEST__!.state().gatesPassed[0] === true, undefined, { timeout: 30_000 });
  await page.waitForFunction((z) => window.__TEST__!.state().hero!.z >= z, ridges[0]! + 28, { timeout: 30_000 });
  for (const yaw of [0, Math.PI]) {
    await page.evaluate((y) => window.__TEST__!.setCamera({ yaw: y, pitch: 0.1 }), yaw);
    for (let i = 0; i < 10; i++) {
      await waitTicks(page, 3);
      expect((await page.evaluate(() => window.__TEST__!.signBox(0))).hidden, `yaw ${yaw}`).toBe(true);
    }
  }
  await page.evaluate(() => window.__TEST__!.setCamera('auto'));
});
