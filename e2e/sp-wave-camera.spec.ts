import type { Page } from '@playwright/test';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import openTuning from '../content/avalanche/pace/open/tuning.json' with { type: 'json' };

// Q-066 (playtest of «Размах»: at the first avalanche the hero ran past the rock of its grotto and back to its mouth, and
// all the way back the camera looked into his face): the hero above the first rock of the lane on the siren of the scripted
// wave runs back down to its mouth; the camera is in front of him (in his face: within 60° of where he runs) in at most
// FACE of the frames with camera.shelterKeep, and in more of them without it (the same run, the flag off). Screenshot.
const FACE = 0.25;
const EVIDENCE = 'docs/evidence/sp';
type Shelter = { kind: string; side: string; z: number; mouth: [number, number]; inside: [number, number] };

/** One run back to the mouth of the first rock from 25 units above it on the siren; the share of frames in his face. */
async function runBack(page: Page, keep: boolean, shot?: string): Promise<{ face: number; frames: number }> {
  await page.evaluate((k) => window.__TEST__!.setTuning('camera.shelterKeep', k), keep ? openTuning.camera.shelterKeep : 0);
  const list = (await page.evaluate(() => window.__TEST__!.shelters())) as Shelter[];
  // The first rock of the bold lane (+x): above it no other shelter is nearer.
  const first = list.filter((s) => s.kind === 'island' && s.mouth[0] > 0).sort((a, b) => a.z - b.z)[0]!;
  // Above the rock on its lane, looking up the slope as a runner does.
  await page.evaluate(([z, x]) => window.__TEST__!.teleport(z, x), [first.z + 25, first.mouth[0]] as const);
  await page.evaluate(() => window.__TEST__!.setCamera({ yaw: 0 }));
  await waitTicks(page, 10);
  await page.evaluate(() => window.__TEST__!.setCamera('auto'));
  await waitTicks(page, 20);
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'warn', undefined, { timeout: 30_000 });
  // The shelter the game lit (the rock, both times): round it on its inner side (the crevasse is farther in), then into its mouth.
  const rock = list[(await testState(page)).wave!.shelter]!;
  expect(rock.kind).toBe('island');
  const out = rock.mouth[0] - 12;
  await page.evaluate((p) => window.__TEST__!.botPath(p), [
    [out, rock.z + 10],
    [out, rock.mouth[1]],
    [rock.mouth[0], rock.mouth[1]],
    [rock.inside[0], rock.inside[1]],
  ] as Array<[number, number]>);
  let frames = 0;
  let face = 0;
  for (let i = 0; i < 150; i++) {
    await waitTicks(page, 3);
    const s = await testState(page);
    if (s.inShelter) break;
    const h = s.hero!;
    const v = Math.hypot(h.vx, h.vz);
    if (v < 3) continue;
    const dx = s.cameraPos[0] - h.x;
    const dz = s.cameraPos[2] - h.z;
    frames++;
    if ((dx * h.vx + dz * h.vz) / (Math.hypot(dx, dz) * v) > 0.5) face++;
    if (shot && frames === 12) await shot1080(page, shot);
  }
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 90_000 });
  return { face: frames ? face / frames : 1, frames };
}

test('the first rock: back to its mouth on the siren the camera is in his face in ≤ FACE of the frames (with shelterKeep); screenshot', async ({ page, openGame }) => {
  test.setTimeout(300_000);
  await openGame('pace=open');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  expect((await testState(page)).wave?.scriptedPending).toBe(true);
  const off = await runBack(page, false);
  // The scripted wave is over: the same run on a normal one.
  await page.evaluate(() => window.__TEST__!.holdWave(900));
  const on = await runBack(page, true, `${EVIDENCE}/first_rock_back_1920x1080_ru.png`);
  console.log(`first rock, back to the mouth: in his face ${(off.face * 100).toFixed(0)}% of ${off.frames} frames without shelterKeep, ${(on.face * 100).toFixed(0)}% of ${on.frames} with it`);
  expect(on.frames).toBeGreaterThan(5);
  expect(on.face).toBeLessThanOrEqual(FACE);
  expect(off.face).toBeGreaterThan(on.face);
});
