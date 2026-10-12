import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import { nextSummit, pastScriptedWave, toFirstBase } from './base-route.ts';
import ru from '../content/avalanche/i18n/ru.json' with { type: 'json' };
import base from '../content/avalanche/pace/open/base.json' with { type: 'json' };

// FM-09 (docs/01-gdd.md 19.3; docs/01a-content.md 18.1–18.2): the base treadmill — after 2 summits «×6», a step on it
// gives × 6, its toast once; 2 bots run on it; «▶ Ad: +N Speed» standing on it after 60 s and the first wave, gone
// on a move.
const dict = ru as Record<string, string>;
const EVIDENCE = 'docs/evidence/fm';

test('after 2 summits: the sign «×6», a step on the belt × 6, the toast once, 2 bots on it, stat_now standing on it; screenshot', async ({ page, openGame }) => {
  test.setTimeout(300_000);
  await toFirstBase(page, openGame, async () => {
    await page.evaluate(() => window.__TEST__!.setPlaySec(70));
    await pastScriptedWave(page);
  });
  const toasts: string[] = [];
  const watchToast = async (): Promise<void> => {
    const text = await page.evaluate(() => document.querySelector('[data-role="toast"].shown')?.textContent ?? '');
    if (text && toasts[toasts.length - 1] !== text) toasts.push(text);
  };
  await nextSummit(page, 2);
  for (let k = 0; k < 8; k++) {
    await watchToast();
    await waitTicks(page, 15);
  }
  let s = await testState(page);
  expect(s.baseTread).toBe('×6');
  const want = dict['toast.baseTreadmill']!.replace('{n}', '6');
  expect(toasts.filter((x) => x.includes(want))).toHaveLength(1);
  // 2 bots run on the belts.
  const belts = Array.from({ length: base.treadmill.lanes }, (_, k) => base.treadmill.x + (k - (base.treadmill.lanes - 1) / 2) * base.treadmill.laneWidth);
  const onBelt = s.bots.filter((b) => b.mode === 'treadmill' && belts.some((x) => Math.abs(b.x - x) < 0.5) && Math.abs(b.z - base.treadmill.z) < base.treadmill.length / 2);
  expect(onBelt).toHaveLength(base.bots.count);

  // A step off the belt, then on the free lane of it: the gain × 6.
  const lane = belts[belts.length - 1]!;
  const gains = (): Promise<Array<{ amount: number; belt: boolean; world: number }>> =>
    page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'gain' && e['world'] === 0).map((e) => ({ amount: e['amount'] as number, belt: e['belt'] as boolean, world: e['world'] as number })));
  await page.evaluate((p) => window.__TEST__!.botPath(p), [[lane + 6, base.treadmill.z], [lane, base.treadmill.z]] as Array<[number, number]>);
  await page.waitForFunction(() => window.__TEST__!.botLeft() === 0, undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await waitTicks(page, 120);
  const g = await gains();
  const off = g.find((x) => !x.belt)!;
  const on = g.filter((x) => x.belt);
  expect(on.length).toBeGreaterThan(2);
  expect(on[on.length - 1]!.amount / off.amount).toBeCloseTo(6, 6);
  s = await testState(page);
  expect(s.onBelt).toBe(true);
  await shot1080(page, `${EVIDENCE}/base_treadmill_1920x1080_ru.png`, 5);

  // «▶ Ad: +N Speed» standing on it (60 s of play and the first wave behind), gone on a move.
  await page.waitForFunction(() => window.__TEST__!.state().adButtons.includes('stat_now'), undefined, { timeout: 30_000 });
  await page.evaluate((p) => window.__TEST__!.botPath(p), [[lane + 8, base.treadmill.z]] as Array<[number, number]>);
  await page.waitForFunction(() => !window.__TEST__!.state().adButtons.includes('stat_now'), undefined, { timeout: 10_000 });
});
