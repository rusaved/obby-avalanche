import { test, expect, testState } from './fixtures.ts';
import type { TestState } from '../src/test-api/index.ts';

type Played = Array<{ name: string; playSec: number; params?: Record<string, unknown> }>;

// M2-08, GDD-01: the first minute on a fresh save (docs/01-gdd.md 6.2, 6.5). Limits are play time (save.totalPlaySec).
test('first minute: bot walks walls 1–3 straight, scripted wave in cave 4, belt ×7, free egg, wall 4 — GDD-01 limits', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame();
  let s: TestState = await testState(page);
  expect(s.playSec).toBeLessThan(2);
  expect(s.hint).toBe('hint.move');
  expect(s.hintText).toBe('Беги вверх!');
  expect(s.egg).toMatchObject({ phase: 'idle' });

  const cave = { entry: [13, 370] as [number, number], belt: [19, 373] as [number, number] };
  // Straight up the track; one step aside for the first green gift: 30 coins buy the first shoes (6.2, 22–32 s).
  await page.evaluate(() => window.__TEST__!.botPath([[-4, 229], [0, 300], [0, 345]]));
  await page.evaluate(() => window.__TEST__!.setTimeScale(3));
  let stage = 'up';
  let warnSeen = false;
  let handSeen = false;
  let maxHints = 0;
  const played = (): Promise<Played> => page.evaluate(() => window.__TEST__!.analyticsPlay());
  for (let i = 0; i < 4000; i++) {
    s = await testState(page);
    maxHints = Math.max(maxHints, s.hintsVisible);
    if (s.shoesButton.can) await page.locator('[data-hud="shoes"]').click();
    if (stage === 'up' && s.wave?.phase === 'warn') {
      stage = 'cave';
      expect(s.wave.scripted).toBe(true);
      expect(s.wave.shelter).toBe(3);
      expect(s.hint).toBe('wave.cave');
      expect(s.arrows).toBe(true);
      await page.evaluate(() => window.__TEST__!.setTimeScale(1));
      await page.screenshot({ path: 'docs/evidence/M2/ftue_warn_1920x1080_ru.png' });
      warnSeen = true;
      await page.evaluate((p) => window.__TEST__!.botPath(p), [cave.entry, cave.belt]);
      await page.evaluate(() => window.__TEST__!.setTimeScale(3));
    }
    const names = (await played()).map((e) => e.name);
    if (stage === 'cave' && names.includes('first_wave_survived')) {
      stage = 'egg';
      expect(s.hand).toBe(true);
      handSeen = true;
      await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z]]), [s.egg!.x, s.egg!.z] as [number, number]);
    }
    if (stage === 'egg' && names.includes('egg_1')) {
      stage = 'belt';
      await page.evaluate((p) => window.__TEST__!.botPath([p]), cave.belt);
    }
    if (names.includes('gate_4') || s.playSec > 100) break;
  }
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  s = await testState(page);
  const ev = await played();
  const first = (name: string): number => ev.find((e) => e.name === name)?.playSec ?? Infinity;
  expect(warnSeen && handSeen).toBe(true);
  expect(first('gate_1')).toBeLessThanOrEqual(15);
  expect(first('gate_3')).toBeLessThanOrEqual(40);
  expect(ev.filter((e) => e.name === 'first_wave_survived').map((e) => e.params)).toEqual([{ inShelter: true }]);
  expect(first('first_wave_survived')).toBeLessThanOrEqual(55);
  expect(first('treadmill_first')).toBeLessThanOrEqual(70);
  expect(first('egg_1')).toBeLessThanOrEqual(70);
  expect(first('gate_4')).toBeLessThanOrEqual(90);
  expect(first('shoes_1')).toBeLessThan(first('gate_3'));
  // The scripted wave never catches; the bot never stands at a closed wall; one plaque at a time.
  expect(await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'waveCaught').length)).toBe(0);
  expect(await page.evaluate(() => window.__TEST__!.gateStandMax())).toBeLessThanOrEqual(0.5);
  expect(maxHints).toBeLessThanOrEqual(1);
  expect(s.pets).toEqual(['bunny']);
  expect(s.gainMult).toBeCloseTo(2 * 1.2, 5);
  expect(s.egg).toMatchObject({ phase: 'done' });
});

// Scripted wave outside a cave (docs/01-gdd.md 4.6): snow up to the waist, the hint, no ball, first_wave_survived {inShelter: false}.
test('scripted wave never catches outside a cave: dusted, «Hide in a cave» toast, no snowball', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await openGame();
  await page.evaluate(() => window.__TEST__!.teleport(60));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.evaluate(() => window.__TEST__!.setTimeScale(3));
  await page.waitForFunction(() => window.__TEST__!.analytics().some((e) => e.name === 'first_wave_survived'), undefined, { timeout: 90_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  const ev = (await page.evaluate(() => window.__TEST__!.analytics())).filter((e) => e.name === 'first_wave_survived');
  expect(ev.map((e) => e.params)).toEqual([{ inShelter: false }]);
  const names = await page.evaluate(() => window.__TEST__!.simEvents.map((e) => e.name));
  expect(names).toContain('waveDusted');
  expect(names).not.toContain('waveCaught');
  expect((await testState(page)).caught).toBeNull();
});
