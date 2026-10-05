import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, testState, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';

const ru = JSON.parse(readFileSync(resolve(import.meta.dirname, '../content/avalanche/i18n/ru.json'), 'utf8')) as Record<string, string>;
const en = JSON.parse(readFileSync(resolve(import.meta.dirname, '../content/avalanche/i18n/en.json'), 'utf8')) as Record<string, string>;
const fill = (s: string, p: Record<string, string | number>): string => Object.entries(p).reduce((a, [k, v]) => a.split(`{${k}}`).join(String(v)), s);

type Box = { name: string; x: number; y: number; w: number; h: number };
const ELEMENTS: Record<string, string> = {
  stat: '[data-role="stat"]',
  coins: '[data-role="coins"].shown',
  mountain: '[data-role="mountain"]',
  goal: '[data-role="goal"]',
  pause: '[data-hud="pause"]',
  sound: '[data-hud="sound"]',
  shoes: '[data-hud="shoes"].shown',
  jump: '[data-hud="jump"]',
  banner: '[data-role="wave-banner"].shown',
  hint: '[data-role="hint"].shown',
};

/** Visible HUD boxes in field coordinates. */
async function boxes(page: Page): Promise<Box[]> {
  return page.evaluate((els) => {
    const field = document.getElementById('game')!.getBoundingClientRect();
    const out: Array<{ name: string; x: number; y: number; w: number; h: number }> = [];
    for (const [name, sel] of Object.entries(els)) {
      const node = document.querySelector(sel);
      if (!node) continue;
      const st = getComputedStyle(node);
      if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') continue;
      const r = node.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      out.push({ name, x: r.left - field.left, y: r.top - field.top, w: r.width, h: r.height });
    }
    return out;
  }, ELEMENTS);
}

function problems(list: Box[], W: number, H: number): string[] {
  const out: string[] = [];
  for (const b of list) {
    if (b.x < -1 || b.y < -1 || b.x + b.w > W + 1 || b.y + b.h > H + 1) out.push(`${b.name} outside the field`);
  }
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!;
      const b = list[j]!;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) out.push(`${a.name} overlaps ${b.name}`);
    }
  }
  return out;
}

const get = (list: Box[], name: string): Box => {
  const b = list.find((x) => x.name === name);
  expect(b, name).toBeTruthy();
  return b!;
};

const SIZES: Array<[number, number, 'mobile' | 'desktop']> = [
  [640, 360, 'mobile'],
  [844, 390, 'mobile'],
  [1920, 1080, 'desktop'],
];

// M2-09: core HUD in the places of docs/01-gdd.md 10.1, no overlaps, texts from i18n (docs/03 SCR-01).
test.describe('core HUD', () => {
  for (const [W, H, device] of SIZES) {
    test(`${W}x${H}: places of 10.1, no overlaps at the spawn and with a wave, coins, shoes and a hint; spawn screenshot`, async ({ page, openGame }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: W, height: H });
      await openGame(`mock_device=${device}`);
      await waitTicks(page, 10);
      let list = await boxes(page);
      expect(problems(list, W, H)).toEqual([]);
      const stat = get(list, 'stat');
      const mountain = get(list, 'mountain');
      const goal = get(list, 'goal');
      const pause = get(list, 'pause');
      const sound = get(list, 'sound');
      // 10.1: Speed top left, the bar top centre (≤ 40% W), the goal under it, pause and sound top right.
      expect(stat.x).toBeLessThan(W * 0.05);
      expect(stat.y).toBeLessThan(H * 0.05);
      expect(stat.w).toBeGreaterThanOrEqual(140);
      expect(stat.h).toBeGreaterThanOrEqual(36);
      expect(Math.abs(mountain.x + mountain.w / 2 - W / 2)).toBeLessThan(2);
      expect(mountain.w).toBeLessThanOrEqual(Math.min(W * 0.4, 520) + 1);
      expect(mountain.y).toBeLessThan(H * 0.05);
      expect(goal.y).toBeGreaterThanOrEqual(mountain.y + mountain.h - 1);
      expect(Math.abs(goal.x + goal.w / 2 - W / 2)).toBeLessThan(2);
      expect(pause.x + pause.w).toBeGreaterThan(W - 60);
      expect(sound.x + sound.w).toBeLessThanOrEqual(pause.x);
      expect(Math.min(pause.w, sound.w)).toBeGreaterThanOrEqual(H < 420 ? 44 : 48);
      // Texts from i18n: Speed 0 and «+1 per step», «Mountain 1 · 0/12», «Wall 20», «0/20», «Run uphill!».
      const texts = await page.evaluate(() => ({
        value: document.querySelector('.hud-stat-value')?.textContent,
        per: document.querySelector('.hud-stat-per')?.textContent,
        mountain: document.querySelector('.hud-mountain-label')?.textContent,
        goal: document.querySelector('.hud-goal-text')?.textContent,
        goalNum: document.querySelector('.hud-goal-num')?.textContent,
      }));
      expect(texts).toEqual({
        value: '0',
        per: fill(ru['hud.perStep']!, { n: 1 }),
        mountain: fill(ru['hud.mountain']!, { a: 1, b: 0, c: 12 }),
        goal: fill(ru['hud.goal.wall']!, { n: 20 }),
        goalNum: '0/20',
      });
      const s = await testState(page);
      expect(s.hint).toBe('hint.move');
      expect(s.hintsVisible).toBe(1);
      expect(s.hintText).toBe(ru['hint.move']);
      await page.screenshot({ path: `docs/evidence/M2/spawn_${W}x${H}_ru.png` });

      // Busy moment: walls 1–3 open and passed (coins and the shoes button), the wave warning with «To the cave!».
      await page.evaluate(() => window.__TEST__!.setStat(100));
      await page.evaluate(() => window.__TEST__!.botPath([[0, 330]]));
      await page.evaluate(() => window.__TEST__!.setTimeScale(3));
      await page.waitForFunction(() => window.__TEST__!.botLeft() === 0, undefined, { timeout: 60_000 });
      await page.evaluate(() => window.__TEST__!.setTimeScale(1));
      await page.evaluate(() => window.__TEST__!.triggerWave());
      await page.waitForFunction(() => window.__TEST__!.state().hint === 'wave.cave', undefined, { timeout: 30_000 });
      await waitTicks(page, 20);
      list = await boxes(page);
      const names = list.map((b) => b.name);
      for (const n of ['coins', 'shoes', 'banner', 'hint']) expect(names, n).toContain(n);
      expect(problems(list, W, H)).toEqual([]);
      const banner = get(list, 'banner');
      expect(Math.abs(banner.y - H * 0.25)).toBeLessThan(H * 0.05);
      expect(get(list, 'coins').y).toBeGreaterThan(stat.y + stat.h);
      expect((await testState(page)).hintsVisible).toBe(1);
      const after = await page.evaluate(() => ({
        mountain: document.querySelector('.hud-mountain-label')?.textContent,
        goal: document.querySelector('.hud-goal-text')?.textContent,
        blink: document.querySelectorAll('.hud-mcave.blink').length,
        wave: document.querySelector('.hud-mountain-wave.shown') !== null,
      }));
      expect(after.mountain).toBe(fill(ru['hud.mountain']!, { a: 1, b: 3, c: 12 }));
      expect(after.goal).toBe(fill(ru['hud.goal.wall']!, { n: '2K' }));
      expect(after.blink).toBe(1);
      expect(after.wave).toBe(true);
      if (W === 1920) await page.screenshot({ path: `docs/evidence/M2/hud_warn_${W}x${H}_ru.png` });
    });
  }

  test('en: texts from en.json, number format with a point («1.23K»), ru with a comma', async ({ page, openGame }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openGame('mock_lang=en');
    await page.evaluate(() => window.__TEST__!.setStat(1234));
    await waitTicks(page, 5);
    let texts = await page.evaluate(() => ({
      value: document.querySelector('.hud-stat-value')?.textContent,
      mountain: document.querySelector('.hud-mountain-label')?.textContent,
      goal: document.querySelector('.hud-goal-text')?.textContent,
    }));
    expect(texts.value).toBe('1.23K');
    expect(texts.mountain).toBe(fill(en['hud.mountain']!, { a: 1, b: 3, c: 12 }));
    expect(texts.goal).toBe(en['hud.goal.open']);
    await waitTicks(page, 130);
    expect(await page.evaluate(() => document.querySelector('.hud-goal-text')?.textContent)).toBe(fill(en['hud.goal.wall']!, { n: '2K' }));
    expect(await page.evaluate(() => document.querySelector('.hud-goal-num')?.textContent)).toBe('1.23K/2K');
    await openGame('mock_lang=ru');
    await page.evaluate(() => window.__TEST__!.setStat(1234));
    await waitTicks(page, 5);
    texts = await page.evaluate(() => ({ value: document.querySelector('.hud-stat-value')?.textContent, mountain: '', goal: '' }));
    expect(texts.value).toBe('1,23K');
  });
});
