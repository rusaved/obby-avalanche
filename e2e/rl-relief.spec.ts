import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };
import openSpec from '../content/avalanche/pace/open/worlds-spec.json' with { type: 'json' };
import game from '../content/avalanche/game.json' with { type: 'json' };
import ru from '../content/avalanche/i18n/ru.json' with { type: 'json' };
import { toFirstBase } from './base-route.ts';

// RL (docs/01-gdd.md 21): the relief of the open slope in the game — a fall into the pit of a chasm rolls the hero back
// to the flag of the ridge within 2 s and «forward» leads up the slope after it; the middle trampoline flies over; the
// dip, the chute with its sparks, the stairs to a ridge and the tint of mountain 2, the sure blizzard of mountain 2, a tall
// wall see-through in the way of the camera, the gift cards on the base without the pause. Screenshots — docs/evidence/rl/.
type Seg = { type: string; z: number; x?: number; y?: number; length?: number; section?: number; stretch?: number; shape?: string; side?: string; wall?: number };
type W = { id: string; segments: Seg[]; zones: Array<{ k: number; zStart: number; zEnd: number }> };
const worlds = (openWorlds as unknown as { worlds: W[] }).worlds;
const spec = openSpec as unknown as { mountains: Array<{ ridges: Array<{ requires: number }> }> };
const w1 = worlds[0]!;
const chasm = w1.segments.find((s) => s.type === 'chasm')!;
const flag2 = w1.segments.find((s) => s.type === 'checkpoint' && s.wall === 2)!;
const EVIDENCE = 'docs/evidence/rl';

async function pastScriptedWave(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
}

async function ready(page: Page, world: number, stat: number): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await pastScriptedWave(page);
  if (world > 1) {
    await page.evaluate((w) => window.__TEST__!.gotoWorld(w), world);
    await waitTicks(page, 20);
  }
  await page.evaluate((st) => {
    window.__TEST__!.holdWave(300);
    window.__TEST__!.setStat(st);
  }, stat);
}

test('mountain 1, section 3: off the trampolines into the pit — back at the flag of ridge 2 within 2 s, the toast, «forward» goes up the slope', async ({ page, openGame }) => {
  test.setTimeout(150_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high');
  await ready(page, 1, 600);
  await page.evaluate((z) => window.__TEST__!.teleport(z, 0), flag2.z + 2);
  await waitTicks(page, 10);
  await page.evaluate((z) => window.__TEST__!.teleport(z, 4), chasm.z - 16);
  await waitTicks(page, 10);
  await shot1080(page, `${EVIDENCE}/chasm_1920x1080_ru.png`, 20);
  await page.evaluate((z) => window.__TEST__!.teleport(z, -9), chasm.z - 12);
  await waitTicks(page, 5);
  await page.evaluate(() => window.__TEST__!.keyDown('KeyW'));
  let caughtSeen: { t: number; total: number } | null = null;
  const toasts: string[] = [];
  for (let k = 0; k < 120 && !caughtSeen; k++) {
    await waitTicks(page, 2);
    const s = await testState(page);
    if (s.caught) caughtSeen = s.caught;
    if (s.waveHud.toast && !toasts.includes(s.waveHud.toast)) toasts.push(s.waveHud.toast);
  }
  await page.evaluate(() => window.__TEST__!.keyUp('KeyW'));
  expect(caughtSeen, 'the fall rolls him back').not.toBeNull();
  expect(caughtSeen!.total).toBeLessThanOrEqual(2);
  for (let k = 0; k < 120 && (await testState(page)).caught; k++) {
    const s = await testState(page);
    if (s.waveHud.toast && !toasts.includes(s.waveHud.toast)) toasts.push(s.waveHud.toast);
    await waitTicks(page, 3);
  }
  const at = await testState(page);
  expect(at.caught).toBeNull();
  expect(Math.abs(at.hero!.z - flag2.z)).toBeLessThan(1);
  expect(toasts).toContain(ru['toast.fallBack']);
  // RL-09: no inverted controls after the roll back — «forward» runs up the slope (course within 15°).
  await page.evaluate(() => window.__TEST__!.keyDown('KeyW'));
  await waitTicks(page, 40);
  await page.evaluate(() => window.__TEST__!.keyUp('KeyW'));
  const run = await testState(page);
  const dz = run.hero!.z - at.hero!.z;
  expect(dz).toBeGreaterThan(5);
  expect(Math.abs(run.hero!.x - at.hero!.x)).toBeLessThan(dz * Math.tan((15 * Math.PI) / 180));
});

test('mountain 1, section 3: the middle trampoline throws over the chasm, no roll back; the dip and the chute (sparks); screenshots', async ({ page, openGame }) => {
  test.setTimeout(150_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high');
  await ready(page, 1, 600);
  await page.evaluate((z) => window.__TEST__!.teleport(z, 0), chasm.z - 25);
  await waitTicks(page, 10);
  await page.evaluate((p) => window.__TEST__!.botPath(p), [[0, chasm.z + chasm.length! + 30]] as Array<[number, number]>);
  let caught = false;
  for (let k = 0; k < 150 && (await page.evaluate(() => window.__TEST__!.botLeft())) > 0; k++) {
    if ((await testState(page)).caught) caught = true;
    await waitTicks(page, 3);
  }
  const s = await testState(page);
  expect(caught).toBe(false);
  expect(s.fun.launches).toBeGreaterThan(0);
  expect(s.hero!.z).toBeGreaterThan(chasm.z + chasm.length! + 5);
  const dip = w1.segments.find((x) => x.type === 'dip')!;
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await page.evaluate((z) => window.__TEST__!.teleport(z, 6), dip.z - 14);
  await waitTicks(page, 10);
  await shot1080(page, `${EVIDENCE}/dip_1920x1080_ru.png`, 20);
  const chute = w1.segments.find((x) => x.type === 'slide' && x.shape === 'chute')!;
  // The bot's path is over: the keys again (base-route.ts does the same before «Next»).
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await page.evaluate((z) => window.__TEST__!.teleport(z, 0), chute.z - chute.length! / 2 + 2);
  await waitTicks(page, 10);
  await page.evaluate(() => window.__TEST__!.keyDown('KeyW'));
  let sparks = 0;
  for (let k = 0; k < 30; k++) {
    await waitTicks(page, 2);
    sparks = Math.max(sparks, (await testState(page)).funFx.spark);
  }
  await shot1080(page, `${EVIDENCE}/chute_1920x1080_ru.png`, 1);
  await page.evaluate(() => window.__TEST__!.keyUp('KeyW'));
  expect(sparks, 'sparks of the ice on the chute').toBeGreaterThan(0);
});

test('mountain 2: its own tint, the stairs of plates to a ridge in the frame, the camera never inside geometry; screenshot', async ({ page, openGame }) => {
  test.setTimeout(150_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high');
  const w2 = worlds[1]!;
  await ready(page, 2, spec.mountains[1]!.ridges[0]!.requires);
  expect((await testState(page)).world).toBe('pines');
  const st = w2.segments.find((x) => x.type === 'stairs' && x.section === 2)!;
  await page.evaluate(([z, x]) => window.__TEST__!.teleport(z!, x!), [st.z - 12, (st.x ?? 0) * 0.6]);
  await waitTicks(page, 20);
  expect(await page.evaluate(() => window.__TEST__!.cameraInsideGeometry())).toBe(false);
  await shot1080(page, `${EVIDENCE}/stairs_1920x1080_ru.png`, 20);
});

test('mountain 2: the sure blizzard comes on section 2 or 3 without a mock', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  mkdirSync(EVIDENCE, { recursive: true });
  expect(game.events.blizzard.fromWorld).toBe(2);
  await openGame('pace=open&quality=high');
  const w2 = worlds[1]!;
  await ready(page, 2, spec.mountains[1]!.ridges[1]!.requires);
  let on = false;
  for (const k of [2, 3]) {
    const zone = w2.zones.find((z) => z.k === k)!;
    await page.evaluate((z) => window.__TEST__!.teleport(z, 0), zone.zStart + 45);
    for (let i = 0; i < 60 && !on; i++) {
      await waitTicks(page, 6);
      on = (await testState(page)).blizzard.on;
    }
    if (on) break;
  }
  expect(on).toBe(true);
  await shot1080(page, `${EVIDENCE}/blizzard_m2_1920x1080_ru.png`, 1);
});

test('mountain 3: a throat wall between the camera and the hero turns see-through, the camera keeps its distance', async ({ page, openGame }) => {
  test.setTimeout(150_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high');
  await ready(page, 3, spec.mountains[2]!.ridges[1]!.requires);
  const walls = await page.evaluate(() => window.__TEST__!.seeThrough());
  const wall = walls.find((b) => b.max[1]! - b.min[1]! > 8 && b.min[0]! > 0)!;
  expect(wall, 'a tall wall on the right').toBeDefined();
  const [x0, , z0] = wall.min as [number, number, number];
  const z = (z0 + wall.max[2]!) / 2;
  await page.evaluate(([zz, x]) => window.__TEST__!.teleport(zz!, x!), [z, x0 - 3]);
  await waitTicks(page, 10);
  let faded = false;
  let dist = 0;
  for (const yaw of [-Math.PI / 2, Math.PI / 2]) {
    await page.evaluate((y) => window.__TEST__!.setCamera({ yaw: y, dist: 10 }), yaw);
    await waitTicks(page, 20);
    const now = (await page.evaluate(() => window.__TEST__!.seeThrough())).some((b) => b.faded);
    if (now) {
      faded = true;
      const c = await page.evaluate(() => window.__TEST__!.cameraPos());
      const h = (await testState(page)).hero!;
      dist = Math.hypot(c[0] - h.x, c[2] - h.z);
      await shot1080(page, `${EVIDENCE}/see_through_1920x1080_ru.png`, 1);
      break;
    }
  }
  await page.evaluate(() => window.__TEST__!.setCamera('auto'));
  expect(faded).toBe(true);
  expect(dist).toBeGreaterThan(0.8 * 10 * 0.7);
});

test('the base: the gift cards by the shop side without the pause (one tap — the same window); none on a mountain; 640 × 360 fits', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  mkdirSync(EVIDENCE, { recursive: true });
  const ids = Object.keys(game.community as Record<string, string>);
  await toFirstBase(page, openGame);
  expect((await testState(page)).onBase).toBe(true);
  // G-05 (producer 26.10): no gift for a visit to the group on Yandex — no such cards on the base.
  for (const id of ids) await expect(page.locator(`[data-hud="base-gift-sub-${id}"]`)).toHaveCount(0);
  await shot1080(page, `${EVIDENCE}/base_gifts_1920x1080_ru.png`, 1);
  await page.evaluate(() => window.__TEST__!.gotoWorld(2));
  await waitTicks(page, 20);
  for (const id of ids) await expect(page.locator(`[data-hud="base-gift-sub-${id}"]`)).toBeHidden();
});
