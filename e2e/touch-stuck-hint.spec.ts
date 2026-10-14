import type { Page } from '@playwright/test';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };
import balance from '../content/avalanche/balance.json' with { type: 'json' };

// Producer 14.10 (plays of «Размах», cycle 3, the phone: at the closed «Ridge 1.5K» 12 s with no hint or arrow to the belt
// nearby). On a phone at a closed ridge of mountain 1, the thumb pushing the stick up and to the side — the hero slides
// along the carniz, never up it: within LIMIT s of game time the «run or treadmill» plaque with its arrow to the belt of the
// grotto below and the arrows on the snow. Screenshot.
const LIMIT = balance.hints.stuckSec + 1.5;
type Seg = { type: string; z: number; kind?: string; requires?: number; passes?: number[] };

/** The stick held by a thumb (CDP touches): from (x0, y0) to (x1, y1) on the left half. */
async function stick(page: Page, dx: number, dy: number): Promise<() => Promise<void>> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 300, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 150 + dx, y: 300 + dy, id: 1 }] });
  return async () => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
}

test('phone, a closed ridge of mountain 1: pushing the stick along it, the hint with an arrow to the belt within LIMIT s; screenshot', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await openGame('pace=open&mock_device=mobile');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  const w = (openWorlds as unknown as { worlds: Array<{ segments: Seg[] }> }).worlds[0]!;
  const ridge = w.segments.filter((s) => s.type === 'gate' && s.kind === 'ridge').sort((a, b) => a.z - b.z)[2]!;
  // Short of its number, below it between two passes (the carniz), looking up the slope.
  await page.evaluate((r) => {
    window.__TEST__!.setTimeScale(1);
    window.__TEST__!.holdWave(900);
    window.__TEST__!.setStat(Math.round(r * 0.7));
  }, ridge.requires!);
  const passes = [...ridge.passes!].sort((a, b) => a - b);
  // The first two passes from the left (the rock with a belt under the carniz stands right of the axis).
  const x = (passes[0]! + passes[1]!) / 2;
  await page.evaluate(([z, xx]) => window.__TEST__!.teleport(z, xx), [ridge.z - 6, x] as const);
  await page.evaluate(() => window.__TEST__!.setCamera({ yaw: 0 }));
  await waitTicks(page, 5);
  await page.evaluate(() => window.__TEST__!.setCamera('auto'));
  await waitTicks(page, 20);
  const t0 = (await testState(page)).timeSec;
  // Up and to the side (screen right): along the carniz.
  const release = await stick(page, 40, -45);
  let seen: { sec: number; arrow: number | null; arrows: boolean; speed: number } | null = null;
  while (!seen) {
    await waitTicks(page, 6);
    const s = await testState(page);
    if (s.hint === 'hint.stuck') seen = { sec: s.timeSec - t0, arrow: s.hintArrow, arrows: s.arrows, speed: s.hero!.speed };
    if (s.timeSec - t0 > LIMIT + 3) break;
  }
  await shot1080(page, 'docs/evidence/sp/stuck_hint_phone_1920x1080_ru.png');
  await release();
  console.log(`stuck hint at the closed ridge on the phone: ${JSON.stringify(seen)}`);
  expect(seen, 'hint.stuck shown').not.toBeNull();
  expect(seen!.sec).toBeLessThanOrEqual(LIMIT);
  expect(seen!.arrow, 'its arrow to the belt').not.toBeNull();
});
