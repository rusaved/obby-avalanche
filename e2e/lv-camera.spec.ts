import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, testState, waitTicks } from './fixtures.ts';
import tuning from '../content/avalanche/tuning.json' with { type: 'json' };

// LV-10 (docs/01-gdd.md 22.11, producer 15.10). (a) On a PC the mouse moved over the field without a button turns the
// camera (camera.mouseLook, mouseYawPerPx); the keys stay relative to the view (W along it, D to screen-right); after
// camera.mouseReturnSec of no move the view eases back behind the hero by itself; a drag keeps the view the player's.
// (b) The scripted first wave of mountain 1 with the hero in the grotto of a rock: the frame avalanche.firstWaveShot looks
// out of its mouth up the slope, the front and the hero both in the frame on ≥ FRONT_SEEN of the frames of its pass (the
// run until the front is shotTriggerDist past the hero), the camera never inside the level; with the wave gone — the
// player's camera. Screenshot of the frame.
const FRONT_SEEN = 0.5;
const EVIDENCE = 'docs/evidence/lv';
const RETURN_SEC = tuning.camera.mouseReturnSec;
const BACK_SEC = tuning.avalanche.shotReturnSec;
const TRIGGER = tuning.avalanche.shotTriggerDist;
type Shelter = { kind: string; z: number; mouth: [number, number]; inside: [number, number] };

test.use({ viewport: { width: 1280, height: 720 } });

const angle = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** The mouse over the middle of the field, then `px` to the right without a button. */
async function look(page: Page, px: number): Promise<void> {
  await page.mouse.move(640, 400);
  await page.mouse.move(640 + px, 400, { steps: 10 });
}

test('PC: the mouse without a button turns the view, keys follow it, the view comes back behind the hero; a drag stays', async ({ page, openGame }) => {
  await openGame('pace=open');
  await page.evaluate(() => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.holdWave(900);
  });
  await waitTicks(page, 20);
  const s0 = await testState(page);
  expect(angle(s0.viewYaw, s0.hero!.yaw), 'behind the hero at the start').toBeLessThan(0.05);

  // A look to the right: the view turns right (yaw down), the movement frame with it.
  await look(page, 200);
  await waitTicks(page, 3);
  const s1 = await testState(page);
  const turned = 200 * tuning.camera.mouseYawPerPx * (Math.PI / 180);
  expect(angle(s1.viewYaw, s0.viewYaw - turned), `yaw ${s1.viewYaw.toFixed(3)}`).toBeLessThan(0.05);
  expect(s1.controlYaw).toBeCloseTo(s1.viewYaw, 6);
  // Still the player's view well before mouseReturnSec (the camera counts frame time: on a slow machine it runs up to 1.2
  // times the game ticks, docs/02-tech.md 4.2).
  await waitTicks(page, Math.round(RETURN_SEC * 0.6 * 60));
  expect(angle((await testState(page)).viewYaw, s1.viewYaw)).toBeLessThan(0.02);
  // mouseReturnSec + 1 s after the last move: behind the hero again (he stands: where he faces).
  await waitTicks(page, Math.round((RETURN_SEC * 0.4 + 1) * 60) + 6);
  const s2 = await testState(page);
  expect(angle(s2.viewYaw, s2.hero!.yaw), `yaw ${s2.viewYaw.toFixed(3)}, hero faces ${s2.hero!.yaw.toFixed(3)}`).toBeLessThan(0.05);

  // No inversion: a look to the left, then W runs along the view and D to screen-right (−cos, sin of the yaw).
  await look(page, -240);
  await waitTicks(page, 3);
  const yaw = (await testState(page)).viewYaw;
  expect(angle(yaw, s2.viewYaw), 'the second look turned the view').toBeGreaterThan(0.8);
  const run = async (key: string, dir: [number, number]): Promise<void> => {
    const a = (await testState(page)).hero!;
    await page.keyboard.down(key);
    await waitTicks(page, 30);
    await page.keyboard.up(key);
    const b = (await testState(page)).hero!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    expect(len, key).toBeGreaterThan(2);
    expect((dx * dir[0] + dz * dir[1]) / len, `${key}: moved (${dx.toFixed(1)}, ${dz.toFixed(1)}) at yaw ${yaw.toFixed(2)}`).toBeGreaterThan(0.9);
  };
  await run('KeyW', [Math.sin(yaw), Math.cos(yaw)]);
  await run('KeyD', [-Math.cos(yaw), Math.sin(yaw)]);

  // A look and then a drag at once: the drag is the player's, the view stays where he dragged it.
  await look(page, 120);
  await page.mouse.down();
  await page.mouse.move(640 + 120 - 160, 400, { steps: 8 });
  await page.mouse.up();
  await waitTicks(page, 6);
  const y3 = (await testState(page)).viewYaw;
  // The hand going back after the drag is not a look either.
  await page.mouse.move(640, 400, { steps: 4 });
  await waitTicks(page, Math.round((RETURN_SEC + BACK_SEC + 0.5) * 60));
  expect(angle((await testState(page)).viewYaw, y3), 'a drag keeps the view').toBeLessThan(0.02);
});

test('the scripted first wave from the grotto of a rock: the front and the hero in the frame, the camera out of the rock; screenshot', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  await openGame('pace=open');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  expect((await testState(page)).wave?.scriptedPending).toBe(true);
  const list = (await page.evaluate(() => window.__TEST__!.shelters())) as Shelter[];
  // The first rocks of the fork: the scripted wave lights the one the hero is in.
  const rock = list.filter((s) => s.kind === 'island').sort((a, b) => a.z - b.z)[0]!;
  await page.evaluate(([z, x]) => window.__TEST__!.teleport(z, x), [rock.inside[1], rock.inside[0]] as const);
  await waitTicks(page, 30);
  expect((await testState(page)).inShelter).toBe(true);
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'warn', undefined, { timeout: 30_000 });
  await waitTicks(page, 30);
  let s = await testState(page);
  expect(s.wave!.scripted).toBe(true);
  expect(s.waveHud.shot, 'the wave frame on the siren').toBe(true);
  // Looking up the slope (+z) out of the rock, from below its mouth.
  expect(Math.cos(s.viewYaw), `yaw ${s.viewYaw.toFixed(2)}`).toBeGreaterThan(0.9);
  expect(s.cameraPos[2]).toBeLessThan(s.hero!.z);

  // Per game tick of the pass, in the page: the front and the hero's chest inside the field.
  await page.evaluate((trigger) => {
    const w = window as unknown as { __lv: { pass: number; both: number; front: number; hero: number; done: boolean; tick: number } };
    w.__lv = { pass: 0, both: 0, front: 0, hero: 0, done: false, tick: -1 };
    const T = window.__TEST__!;
    const step = (): void => {
      const st = T.state();
      const f = T.avalancheFront();
      if (st.wave?.phase === 'run' && f && st.hero && st.ticks !== w.__lv.tick) {
        w.__lv.tick = st.ticks;
        if (f[2] > st.hero.z - trigger) {
          const inside = (p: { x: number; y: number; ahead: boolean }): boolean => p.ahead && p.x >= 0 && p.x <= st.field.width && p.y >= 0 && p.y <= st.field.height;
          const front = inside(T.project(f[0], f[1], f[2]));
          const hero = inside(T.project(st.hero.x, st.hero.y + 1.5, st.hero.z));
          w.__lv.pass++;
          if (front) w.__lv.front++;
          if (hero) w.__lv.hero++;
          if (front && hero) w.__lv.both++;
        }
      }
      if (st.wave?.phase === 'idle' || st.wave?.phase === 'gone') w.__lv.done = true;
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, TRIGGER);
  // Slow time: more rendered frames on the pass; the screenshot with the front above the hero.
  await page.evaluate(() => window.__TEST__!.setTimeScale(0.25));
  await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'run', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.resetCameraStats());
  let shot = false;
  for (let i = 0; i < 2000 && !shot; i++) {
    s = await testState(page);
    if (s.wave!.phase !== 'run') break;
    if (s.wave!.frontZ - s.hero!.z < 45) {
      await page.evaluate(() => window.__TEST__!.setTimeScale(0));
      mkdirSync(EVIDENCE, { recursive: true });
      await page.screenshot({ path: `${EVIDENCE}/camera-grotto-wave.png` });
      await page.evaluate(() => window.__TEST__!.setTimeScale(0.25));
      shot = true;
    }
  }
  expect(shot).toBe(true);
  // The pass: until the front is shotTriggerDist past the hero.
  await page.waitForFunction((tr) => {
    const st = window.__TEST__!.state();
    return st.wave?.phase !== 'run' || st.wave.frontZ < st.hero!.z - tr;
  }, TRIGGER, { timeout: 120_000 });
  const st = await page.evaluate(() => window.__TEST__!.cameraStats());
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  const lv = await page.evaluate(() => (window as unknown as { __lv: { pass: number; both: number; front: number; hero: number } }).__lv);
  console.log(`first wave from the rock: ${lv.pass} ticks of the pass, front in the frame ${lv.front}, hero ${lv.hero}, both ${lv.both} (${((lv.both / Math.max(1, lv.pass)) * 100).toFixed(0)}%); camera frames ${st.frames}, inside ${st.inside}, hero near ${st.heroNear}, blocked ${st.heroBlocked}`);
  expect(lv.pass).toBeGreaterThan(30);
  expect(lv.both / lv.pass).toBeGreaterThanOrEqual(FRONT_SEEN);
  expect(lv.hero / lv.pass, 'the hero in the frame').toBeGreaterThanOrEqual(0.95);
  expect(st.inside, JSON.stringify(st.bad)).toBe(0);
  expect(st.heroNear, JSON.stringify(st.bad)).toBe(0);

  // The wave gone: the player's camera (the frame blended out), behind the hero.
  await page.waitForFunction(() => window.__TEST__!.state().waveHud.shot === false, undefined, { timeout: 60_000 });
  await waitTicks(page, Math.round(BACK_SEC * 60) + 10);
  s = await testState(page);
  expect(s.cameraFixedBlend).toBe(0);
});
