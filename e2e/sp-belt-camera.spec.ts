import type { Page } from '@playwright/test';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import tuning from '../content/avalanche/tuning.json' with { type: 'json' };
import openTuning from '../content/avalanche/pace/open/tuning.json' with { type: 'json' };

// Q-066 (plays of «Размах»: on a grotto belt the camera hung over the hero's head 3–4 units off — off the belt in a narrow
// grotto the view coming back after the belt frame was pressed into the wall and rose over him; the grotto frame waited
// for the way back to end): on every belt of mountains 1–3 the camera keeps NEAR units off the hero's head — walking in,
// stepping off the belt and out without a turn, turned round by hand 360° on the belt, and out after that turn.
// NEAR — the minDistance of the open camera (7: the playtester's «not closer than 7–8») less the unit its point over the
// hero leads him by; the open frame itself keeps 13. Screenshot: the turn on the belt.
const NEAR = openTuning.camera.minDistance - 1;
const EVIDENCE = 'docs/evidence/sp';
const RETURN_TICKS = Math.round(tuning.avalanche.shotReturnSec * 60);
type Shelter = { kind: string; side: string; z: number; mouth: [number, number]; inside: [number, number]; belt: [number, number] | null };

/** The nearest the camera came to the hero's head in any drawn frame while `act` runs (cameraStats), and where. */
async function watch(page: Page, act: () => Promise<boolean>, maxSteps = 200): Promise<{ min: number; at: string }> {
  await page.evaluate(() => window.__TEST__!.resetCameraStats());
  for (let i = 0; i < maxSteps; i++) {
    const done = await act();
    await waitTicks(page, 3);
    if (done) break;
  }
  const st = await page.evaluate(() => window.__TEST__!.cameraStats());
  return { min: st.headMin, at: st.headMinAt };
}

/** A bot walk through these points, watched to the end and shotReturnSec past it. */
async function walk(page: Page, points: Array<[number, number]>): Promise<{ min: number; at: string }> {
  await page.evaluate((p) => window.__TEST__!.botPath(p), points);
  let tail = -1;
  const r = await watch(page, async () => {
    if (tail < 0 && (await page.evaluate(() => window.__TEST__!.botLeft())) === 0) tail = 0;
    if (tail >= 0) tail += 3;
    return tail >= RETURN_TICKS;
  });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  return r;
}

test('belts of mountains 1–3: in, off without a turn, turned round by hand and out — the camera ≥ NEAR off the head; screenshot', async ({ page, openGame }) => {
  test.setTimeout(900_000);
  await openGame('pace=open');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  // 24 drags of 15° (camera.mouseDegPerPx 0.25).
  const px = 15 / tuning.camera.mouseDegPerPx;
  const rows: string[] = [];
  let worst = Infinity;
  let belts = 0;
  for (const m of [1, 2, 3]) {
    if (m > 1) {
      await page.evaluate((n) => window.__TEST__!.gotoWorld(n), m);
      await waitTicks(page, 20);
    }
    await page.evaluate(() => {
      window.__TEST__!.holdWave(900);
      window.__TEST__!.setStat(1e12);
    });
    const list = ((await page.evaluate(() => window.__TEST__!.shelters())) as Shelter[]).filter((s) => s.belt);
    expect(list.length, `mountain ${m}`).toBeGreaterThan(0);
    for (const n of list) {
      belts++;
      // 4 units out of the mouth (a rock grotto opens to the camp, a side one across the slope; in the giant's zone of
      // mountain 1 a rock stands right below the mouth of the next one) onto the belt, and back out there.
      const belt = n.belt!;
      await page.evaluate(([z, x]) => window.__TEST__!.teleport(z, x), [n.mouth[1], n.mouth[0]] as const);
      // Looking at the mouth, as a player running up to it (not the yaw left by the last belt).
      await page.evaluate((yaw) => window.__TEST__!.setCamera({ yaw }), Math.atan2(belt[0] - n.mouth[0], belt[1] - n.mouth[1]));
      await waitTicks(page, 5);
      await page.evaluate(() => window.__TEST__!.setCamera('auto'));
      await waitTicks(page, 30);
      const walkIn = await walk(page, [belt]);
      expect((await testState(page)).waveHud.beltShot, `mountain ${m} ${n.kind} z ${n.z.toFixed(0)}: the belt frame`).toBe(true);
      const offNoTurn = await walk(page, [n.mouth]);
      await walk(page, [belt]);
      let i = 0;
      const turn = await watch(page, async () => {
        await page.mouse.move(400, 300);
        await page.mouse.down();
        await page.mouse.move(400 + px, 300, { steps: 2 });
        await page.mouse.up();
        return ++i >= 24;
      });
      expect((await testState(page)).onBelt, `mountain ${m} ${n.kind} z ${n.z.toFixed(0)}: still on the belt`).toBe(true);
      if (belts === 2) await shot1080(page, `${EVIDENCE}/belt_turn_1920x1080_ru.png`);
      const offTurned = await walk(page, [n.mouth]);
      const parts = [
        ['in', walkIn],
        ['off', offNoTurn],
        ['turn', turn],
        ['off after the turn', offTurned],
      ] as const;
      for (const [, r] of parts) worst = Math.min(worst, r.min);
      const bad = parts.filter(([, r]) => r.min < NEAR);
      rows.push(`m${m} ${n.kind} z ${n.z.toFixed(0)}: ${parts.map(([w, r]) => `${w} ${r.min.toFixed(1)}`).join(', ')}${bad.length ? ` — ${bad.map(([w, r]) => `${w}: ${r.at}`).join('; ')}` : ''}`);
    }
  }
  console.log(`belt camera (head, units; NEAR ${NEAR}), ${belts} belts:\n` + rows.join('\n'));
  expect(belts).toBeGreaterThanOrEqual(15);
  expect(worst, rows.join('\n')).toBeGreaterThanOrEqual(NEAR);
});
