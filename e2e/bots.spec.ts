import { readFileSync } from 'node:fs';
import { test, expect, testState, waitTicks } from './fixtures.ts';

const ru = JSON.parse(readFileSync('content/avalanche/i18n/ru.json', 'utf8')) as Record<string, string>;
const KEYS = Array.from({ length: 24 }, (_, i) => `bot.n${String(i + 1).padStart(2, '0')}`);

// M2-10, GDD-15: bots on the track (docs/01-gdd.md 4.7, 7.12; Q-011). quality=high: 6 bots (low — 3).
test('6 bots with character names, unique on the mountain; no names in shots, promo or with showNames: false', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame('quality=high&seed=5');
  await waitTicks(page, 30);
  let s = await testState(page);
  expect(s.bots).toHaveLength(6);
  const names = s.bots.map((b) => b.name);
  expect(new Set(names).size).toBe(6);
  for (const n of names) expect(KEYS).toContain(n);
  const shown = s.bots.filter((b) => b.labelShown);
  expect(shown.length).toBeGreaterThan(0);
  for (const b of shown) {
    expect(b.label).toBe(ru[b.name]);
    expect(b.label).not.toMatch(/\d/);
  }
  expect(s.botLabels).toBe(shown.length);
  await page.screenshot({ path: 'docs/evidence/M2/bots_1920x1080_ru.png' });

  for (const mode of ['shots', 'promo'] as const) {
    await page.evaluate((m) => window.__TEST__!.setHudMode(m), mode);
    await waitTicks(page, 5);
    s = await testState(page);
    expect(s.hudMode).toBe(mode);
    expect(s.botLabels, mode).toBe(0);
    expect(s.bots.every((b) => !b.labelShown)).toBe(true);
  }
  await page.evaluate(() => window.__TEST__!.setHudMode('normal'));
  await waitTicks(page, 5);
  expect((await testState(page)).botLabels).toBeGreaterThan(0);

  await page.evaluate(() => window.__TEST__!.botsShowNames(false));
  await waitTicks(page, 5);
  s = await testState(page);
  expect(s.botLabels).toBe(0);
  expect(s.bots).toHaveLength(6);
  const texts = await page.locator('[data-role="bot-label"]').evaluateAll((els) => els.filter((e) => Number((e as HTMLElement).style.opacity || 0) > 0).length);
  expect(texts).toBe(0);
});

test('photo studio: bots without names', async ({ page, openGame }) => {
  await openGame('quality=high&seed=5&studio=1');
  await waitTicks(page, 30);
  const s = await testState(page);
  expect(s.bots).toHaveLength(6);
  expect(s.botLabels).toBe(0);
});

test('quality low: 3 bots', async ({ page, openGame }) => {
  await openGame('quality=low&seed=5');
  await waitTicks(page, 10);
  expect((await testState(page)).bots).toHaveLength(3);
});

test('5 minutes of play: on warn ≥ 90% of the bots run to caves; no bot ever above a wall closed for the hero', async ({ page, openGame }) => {
  test.setTimeout(300_000);
  await openGame('quality=high&seed=5');
  // The hero runs up the middle; the stat grows the way play grows it, walls open one by one (no teleport past a wall).
  await page.evaluate(() => window.__TEST__!.botPath([[0, 1100]]));
  await page.evaluate(() => window.__TEST__!.setTimeScale(20));
  let warnChecked = 0;
  let lastWave = -1;
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const s = await testState(page);
    if (s.playSec >= 300) break;
    const next = s.gatesOpen.indexOf(false);
    if (next >= 0 && next < 7 && s.stat < 20 * 2 ** next && s.playSec > 20 * (next + 1)) await page.evaluate((n) => window.__TEST__!.setStat(n), 20 * 2 ** next);
    // A snapshot early in a normal warning: bots on the slope that are already running to (or sitting in) a cave.
    if (s.wave?.phase === 'warn' && !s.wave.scripted && s.wave.normalWaves !== lastWave && s.wave.timer < s.wave.warnSec - 0.5) {
      lastWave = s.wave.normalWaves;
      // On the slope (not the camp, the summit or a snowball); the summit of mountain 1 starts at z 1120.
      const slope = s.bots.filter((b) => ['up', 'wait', 'hide', 'treadmill'].includes(b.mode) && b.z > 40 && b.z < 1120);
      const toCaves = slope.filter((b) => b.mode === 'hide' && b.cave >= 0);
      if (slope.length > 0) {
        warnChecked++;
        // One dawdler in ten decisions: at most one per wave of six bots.
        expect(slope.length - toCaves.length, `wave ${lastWave}`).toBeLessThanOrEqual(1);
      }
    }
  }
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  const s = await testState(page);
  expect(s.playSec).toBeGreaterThanOrEqual(300);
  expect(warnChecked).toBeGreaterThan(2);
  const st = s.botStats;
  expect(st.hid + st.dawdled).toBeGreaterThan(10);
  expect(st.hid / (st.hid + st.dawdled)).toBeGreaterThanOrEqual(0.9);
  expect(await page.evaluate(() => window.__TEST__!.botsOverClosedMax())).toBeLessThan(0);
});
