import { test, expect, testState, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';

const goldEvents = (page: Page): Promise<string[]> =>
  page.evaluate(() => window.__TEST__!.analytics().filter((e) => e.name.startsWith('gold_')).map((e) => e.name));
const waveEnds = (page: Page): Promise<number> => page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'waveEnd').length);

/** Forces the next wave and waits for its warning. */
async function warn(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'warn', undefined, { timeout: 30_000 });
}
async function waitWaveEnd(page: Page, n: number): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setTimeScale(3));
  await page.waitForFunction((k) => window.__TEST__!.simEvents.filter((e) => e.name === 'waveEnd').length >= k, n, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
}
async function walk(page: Page, points: Array<[number, number]>): Promise<void> {
  await page.evaluate((p) => window.__TEST__!.botPath(p), points);
  await page.waitForFunction(() => window.__TEST__!.botLeft() === 0, undefined, { timeout: 30_000 });
}

// M2-12: the golden gift of the warning (docs/01-gdd.md 4.9; docs/06-analytics.md: gold_take, gold_saved, gold_lost).
test('2nd normal wave: a golden gift, carried into the cave → gold_take, gold_saved; caught with it → gold_lost; screenshot gold_carry', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame('seed=5');
  // The scripted first wave passes while the hero waits in the camp (it does not count, docs/01-gdd.md 4.9).
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await waitWaveEnd(page, 1);
  // Into cave 1 (left side, z 103): walls stay closed, the hero walks there.
  const mouth: [number, number] = [-11, 103];
  const inCave: [number, number] = [-16, 103];
  await walk(page, [[0, 100], mouth, inCave]);

  // The 1st normal wave: no gift.
  await warn(page);
  expect((await testState(page)).bonus).toBeNull();
  await waitWaveEnd(page, 2);
  expect((await testState(page)).bonus).toBeNull();

  // The 2nd normal wave: a golden gift between cave 1 and wall 1, «Bring the golden gift to a cave!».
  await warn(page);
  let s = await testState(page);
  expect(s.bonus).not.toBeNull();
  const b = s.bonus!;
  expect(b.carried).toBe(false);
  expect(b.z - 103).toBeGreaterThanOrEqual(20);
  expect(b.z - 103).toBeLessThanOrEqual(50);
  // Not past a wall closed for the hero (walls of mountain 1 at 130, 220, 310…; the belt may have opened wall 1).
  expect(b.z).toBeLessThan(130 + 90 * s.gatesOpen.indexOf(false));
  expect(s.hint).toBe('hint.gold');
  // Playtest M2: the plaque blinked ~20 times; now it stays on until the gift is in the hands (at most that one hide).
  await page.evaluate(() => {
    const node = document.querySelector('[data-role="hint"]')!;
    const w = window as unknown as { __hintOff: number };
    w.__hintOff = 0;
    let was = node.classList.contains('shown');
    new MutationObserver(() => {
      const now = node.classList.contains('shown');
      if (was && !now) w.__hintOff++;
      was = now;
    }).observe(node, { attributes: true, attributeFilter: ['class'] });
  });
  const coins0 = s.coins;
  await walk(page, [mouth, [b.x, b.z]]);
  await page.waitForFunction(() => window.__TEST__!.state().bonus?.carried === true, undefined, { timeout: 10_000 });
  expect(await page.evaluate(() => (window as unknown as { __hintOff: number }).__hintOff)).toBeLessThanOrEqual(1);
  // Running back with the gift over the head: the screenshot of the carry.
  await page.evaluate((p) => window.__TEST__!.botPath(p), [mouth, inCave]);
  await waitTicks(page, 20);
  expect((await testState(page)).bonus?.carried).toBe(true);
  await page.screenshot({ path: 'docs/evidence/M2/gold_carry_1920x1080_ru.png' });
  await page.waitForFunction(() => window.__TEST__!.botLeft() === 0, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(2));
  await page.waitForFunction(() => window.__TEST__!.analytics().some((e) => e.name === 'gold_saved'), undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  expect(await goldEvents(page)).toEqual(['gold_take', 'gold_saved']);
  const surv = await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'waveSurvived').at(-1)!);
  expect(Number(surv['gold'])).toBeGreaterThan(0);
  s = await testState(page);
  expect(s.bonus).toBeNull();
  expect(s.coins - coins0).toBe(Number(surv['coins']));
  // Only names in the buffer, no extra params (Metrika gets params({ goldGift }) instead of goals).
  const gold = await page.evaluate(() => window.__TEST__!.analytics().filter((e) => e.name.startsWith('gold_')));
  expect(gold.every((e) => e.params === undefined)).toBe(true);
  await waitWaveEnd(page, (await waveEnds(page)) + 1);

  // The 3rd normal wave: taken, and the hero stays on the slope — snowed in, the gift pops.
  await warn(page);
  s = await testState(page);
  expect(s.bonus).not.toBeNull();
  expect(s.hint).not.toBe('hint.gold');
  await walk(page, [mouth, [s.bonus!.x, s.bonus!.z]]);
  await page.waitForFunction(() => window.__TEST__!.state().bonus?.carried === true, undefined, { timeout: 10_000 });
  await waitTicks(page, 30);
  const before = await testState(page);
  await page.evaluate(() => window.__TEST__!.setTimeScale(2));
  await page.waitForFunction(() => window.__TEST__!.analytics().some((e) => e.name === 'gold_lost'), undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  expect(await goldEvents(page)).toEqual(['gold_take', 'gold_saved', 'gold_take', 'gold_lost']);
  s = await testState(page);
  expect(s.bonus).toBeNull();
  expect(s.stat).toBe(before.stat);
  expect(s.coins).toBe(before.coins);
  expect(s.gatesOpen).toEqual(before.gatesOpen);
});
