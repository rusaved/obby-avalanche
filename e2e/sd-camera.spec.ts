import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, testState, waitTicks } from './fixtures.ts';
import stagesTuning from '../content/avalanche/pace/stages/tuning.json' with { type: 'json' };

// SD-01 (docs/01-gdd.md 23.1, producer 15.10: «the camera is hell»). Pace stages, 1280×720.
// (a) The mouse without a button turns the view in the middle of the field, not in the top camera.mouseTop of it and not
// within camera.mouseButtonPad px of a HUD button.
// (b) The scripted first wave of mountain 1 with the hero in the grotto of a rock: no frame of its own — the camera stays
// behind the hero (the wave frame off, no fixed blend), never inside the level (the rock is see-through), and «forward»
// always runs from the camera to the hero (no inversion): W in the grotto runs up the slope along the view.
const EVIDENCE = 'docs/evidence/sd';
const TOP = stagesTuning.camera.mouseTop;
type Shelter = { kind: string; z: number; mouth: [number, number]; inside: [number, number] };

test.use({ viewport: { width: 1280, height: 720 } });

const angle = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

async function sweep(page: Page, x: number, y: number, px: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.move(x + px, y, { steps: 10 });
}

test('PC: the mouse turns the view in the middle, not in the top band and not by a HUD button', async ({ page, openGame }) => {
  await openGame('pace=stages');
  await page.evaluate(() => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.holdWave(900);
  });
  await waitTicks(page, 20);
  const y0 = (await testState(page)).viewYaw;
  // The top band (pause, the goal): nothing.
  await sweep(page, 560, Math.round(720 * TOP * 0.6), 200);
  await waitTicks(page, 3);
  expect(angle((await testState(page)).viewYaw, y0), 'top band').toBeLessThan(0.01);
  // Right next to a HUD button (below the top band): nothing.
  const btn = await page.evaluate((top) => {
    const all = [...document.querySelectorAll('[data-role="hud"] button')] as HTMLElement[];
    const r = all.map((b) => b.getBoundingClientRect()).find((q) => q.width > 0 && q.top > innerHeight * top + 40 && q.left > 200 && q.right < innerWidth - 200);
    return r ? { x: r.left + r.width / 2, y: r.top - 20 } : null;
  }, TOP);
  if (btn) {
    await page.mouse.move(btn.x - 15, btn.y, { steps: 6 });
    await page.mouse.move(btn.x + 15, btn.y, { steps: 6 });
    await waitTicks(page, 3);
    expect(angle((await testState(page)).viewYaw, y0), 'by a button').toBeLessThan(0.01);
  }
  // The middle of the field: it turns (the hand comes down from the band straight, no move across).
  await page.mouse.move(760, 380, { steps: 6 });
  await page.mouse.move(960, 380, { steps: 10 });
  await waitTicks(page, 3);
  expect(angle((await testState(page)).viewYaw, y0), 'middle').toBeGreaterThan(0.2);
});

test('the first wave in the grotto of a rock: the view stays behind the hero, no inversion; screenshot', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  await openGame('pace=stages');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  const list = (await page.evaluate(() => window.__TEST__!.shelters())) as Shelter[];
  const rock = list.filter((s) => s.kind === 'island').sort((a, b) => a.z - b.z)[0]!;
  await page.evaluate(([z, x]) => window.__TEST__!.teleport(z, x), [rock.inside[1], rock.inside[0]] as const);
  await waitTicks(page, 30);
  expect((await testState(page)).inShelter).toBe(true);
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'warn', undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__TEST__!.resetCameraStats());

  // Every tick of the warning and the pass: no frame, the camera on the hero's back side of the view.
  await page.evaluate(() => {
    const w = window as unknown as { __sd: { ticks: number; shot: number; fixed: number; inverted: number; done: boolean; tick: number } };
    w.__sd = { ticks: 0, shot: 0, fixed: 0, inverted: 0, done: false, tick: -1 };
    const T = window.__TEST__!;
    const step = (): void => {
      const st = T.state();
      if (st.hero && st.ticks !== w.__sd.tick) {
        w.__sd.tick = st.ticks;
        w.__sd.ticks++;
        if (st.waveHud.shot) w.__sd.shot++;
        if (st.cameraFixedBlend > 0) w.__sd.fixed++;
        // «Forward» of the movement frame runs from the camera towards the hero.
        const fx = Math.sin(st.controlYaw);
        const fz = Math.cos(st.controlYaw);
        if ((st.hero.x - st.cameraPos[0]) * fx + (st.hero.z - st.cameraPos[2]) * fz <= 0) w.__sd.inverted++;
      }
      if (st.wave?.phase === 'idle' || st.wave?.phase === 'gone' || w.__sd.ticks > 1500) w.__sd.done = true;
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'run', undefined, { timeout: 60_000 });
  await page.waitForFunction(() => {
    const st = window.__TEST__!.state();
    return st.wave!.frontZ - st.hero!.z < 30;
  }, undefined, { timeout: 60_000 });
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: `${EVIDENCE}/camera-grotto-wave.png` });
  await page.waitForFunction(() => (window as unknown as { __sd: { done: boolean } }).__sd.done, undefined, { timeout: 120_000 });
  const sd = await page.evaluate(() => (window as unknown as { __sd: { ticks: number; shot: number; fixed: number; inverted: number } }).__sd);
  const st = await page.evaluate(() => window.__TEST__!.cameraStats());
  console.log(`grotto wave: ${sd.ticks} ticks, shot ${sd.shot}, fixed ${sd.fixed}, inverted ${sd.inverted}; camera inside ${st.inside}, hero near ${st.heroNear}`);
  expect(sd.ticks).toBeGreaterThan(60);
  expect(sd.shot, 'no wave frame').toBe(0);
  expect(sd.fixed, 'no fixed frame').toBe(0);
  expect(sd.inverted, 'forward from the camera to the hero').toBe(0);
  expect(st.inside, JSON.stringify(st.bad)).toBe(0);

  // W in the grotto: along the view (up the slope), not back down.
  const a = (await testState(page)).hero!;
  const yaw = (await testState(page)).controlYaw;
  await page.keyboard.down('KeyW');
  await waitTicks(page, 30);
  await page.keyboard.up('KeyW');
  const b = (await testState(page)).hero!;
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  expect(len).toBeGreaterThan(1);
  expect(((b.x - a.x) * Math.sin(yaw) + (b.z - a.z) * Math.cos(yaw)) / len).toBeGreaterThan(0.7);
});
