import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import skins from '../content/avalanche/skins.json' with { type: 'json' };
import tuning from '../content/avalanche/tuning.json' with { type: 'json' };

// RG-13: the camera in a tight grotto (docs/01-gdd.md 18.8, item 3; docs/01a-content.md 16.7). In a shelter the camera
// never comes closer than camera.minDist to the hero's body; pressed into a wall by a turn by hand it takes the grotto
// frame (a wide shot from the mouth); out of the grotto it is behind the hero within 1 s. The camera is shared: open and fast.
const EVIDENCE = 'docs/evidence/rg';
const skin = skins.skins.find((s) => s.id === skins.default)!;
const HEAD = skin.colors.head;

async function pastScriptedWave(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
}

/** A turn by hand of 360° in about 4 s: 48 drags of 30 px (camera.mouseDegPerPx 0.25 → 7.5° each). */
async function turnAround(page: Page, onStep: (i: number) => Promise<void>): Promise<void> {
  const px = 360 / (48 * tuning.camera.mouseDegPerPx);
  for (let i = 0; i < 48; i++) {
    await page.mouse.move(400, 300);
    await page.mouse.down();
    await page.mouse.move(400 + px, 300, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(70);
    await onStep(i);
  }
}

async function inGrottoTurn(page: Page, which: (s: Array<{ kind: string; side: string; inside: [number, number]; mouth: [number, number]; z: number }>) => number, shotPath?: string, tight = true): Promise<void> {
  const shelters = await page.evaluate(() => window.__TEST__!.shelters());
  const n = shelters[which(shelters)]!;
  // At the back of the grotto, facing its back wall: the camera behind the hero is out on the slope.
  const sign = n.side === 'left' ? -1 : 1;
  await page.evaluate(([x, z]) => {
    window.__TEST__!.holdWave(60);
    window.__TEST__!.teleport(z, x);
  }, [n.inside[0] + sign * 1, n.z] as const);
  await waitTicks(page, 30);
  expect((await testState(page)).inShelter).toBe(true);
  await page.evaluate(() => window.__TEST__!.resetCameraStats());
  const vp = page.viewportSize()!;
  const shares: number[] = [];
  await turnAround(page, async (i) => {
    if (i % 4 !== 3) return;
    // The centre of the screen: 30% × 40% of the field; the head at any light (shade in the grotto).
    shares.push(await page.evaluate(([c, x0, y0, x1, y1]) => window.__TEST__!.colorShare(c, 14, x0, y0, x1, y1), [HEAD, vp.width * 0.35, vp.height * 0.3, vp.width * 0.65, vp.height * 0.7] as const));
    if (i === 47 && shotPath) await shot1080(page, shotPath, 5);
  });
  const st = await page.evaluate(() => window.__TEST__!.cameraStats());
  expect(st.frames).toBeGreaterThan(60);
  expect(st.heroNear, JSON.stringify(st.bad)).toBe(0);
  expect(st.inside, JSON.stringify(st.bad)).toBe(0);
  // Pressed into a wall on the way round, the camera took the grotto frame (a roomy cave of fast never presses it).
  if (tight) expect(st.tight).toBeGreaterThan(0);
  expect(Math.min(...shares), shares.map((s) => s.toFixed(3)).join(' ')).toBeGreaterThanOrEqual(0.01);
  // Straight out of the grotto onto the slope: within 1 s of leaving it the camera is behind the hero (on the side
  // away from where he runs).
  const far = -sign * (Math.abs(n.mouth[0]) - 2);
  await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z]]), [far, n.z] as const);
  let out = false;
  for (let k = 0; k < 40 && !out; k++) {
    out = !(await testState(page)).inShelter;
    if (!out) await waitTicks(page, 2);
  }
  expect(out).toBe(true);
  await waitTicks(page, 60);
  const t = await testState(page);
  const cam = await page.evaluate(() => window.__TEST__!.cameraPos());
  const dx = cam[0] - t.hero!.x;
  const dz = cam[2] - t.hero!.z;
  // He ran across the slope away from the grotto (−sign in x): the camera on the grotto side of him, within 45° of
  // straight behind.
  await page.evaluate(() => window.__TEST__!.botPath(null));
  const cos = (sign * dx) / Math.hypot(dx, dz);
  expect(cos, `camera ${cam.map((v) => v.toFixed(1))} hero ${t.hero!.x.toFixed(1)},${t.hero!.z.toFixed(1)} v ${t.hero!.vx.toFixed(1)}`).toBeGreaterThan(Math.SQRT1_2);
}

test('open: turned around by hand in a grotto the camera keeps off the hero, the head stays in frame; behind him outside', async ({ page, openGame }) => {
  test.setTimeout(150_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await pastScriptedWave(page);
  // Mountain 2: a grotto 10 wide (RG-13), the first one of section 2.
  await page.evaluate(() => window.__TEST__!.gotoWorld(2));
  await waitTicks(page, 20);
  await inGrottoTurn(page, (s) => s.findIndex((n) => n.kind === 'grotto' && n.z > 300), `${EVIDENCE}/grotto_camera_1920x1080_ru.png`);
  // And a grotto of mountain 1, still 8 wide (its worlds.json stays as it was).
  await page.evaluate(() => window.__TEST__!.gotoWorld(1));
  await waitTicks(page, 20);
  await inGrottoTurn(page, (s) => s.findIndex((n) => n.kind === 'grotto'));
});

test('fast: the same camera in a cave by a gate', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await openGame('pace=fast');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await pastScriptedWave(page);
  await inGrottoTurn(page, (s) => s.findIndex((n) => n.z > 60), undefined, false);
});
