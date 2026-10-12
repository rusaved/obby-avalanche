import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, shot1080, waitTicks } from './fixtures.ts';
import theme from '../content/avalanche/theme.json' with { type: 'json' };

// FM-04 (docs/01-gdd.md 19.8; docs/01a-content.md 18.6): the toast, the hint and the avalanche banner read on their
// plaques over white snow and over the blizzard fog of mountain 7 (contrast ≥ 4.5:1 by the computed styles); «+N» is
// 1.5× its old size (22 px over the hero, 18 px by the plaque); the shelter arrow on the warning 2× (40 px); on 640×360
// the toast and the hint stay off the Speed plaque and the buttons (SCR-01).
const EVIDENCE = 'docs/evidence/fm';
const SNOW = '#FFFFFF';
const FOG = (theme as unknown as { events: { blizzard: { fog: string } } }).events.blizzard.fog;

type Rgba = [number, number, number, number];
const parse = (css: string): Rgba => {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`not a colour: ${css}`);
  const p = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
  return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
};
const hex = (h: string): Rgba => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 1];
const over = (top: Rgba, under: Rgba): Rgba => [0, 1, 2].map((i) => top[i]! * top[3] + under[i]! * (1 - top[3])).concat(1) as Rgba;
const lum = (c: Rgba): number => {
  const ch = c.slice(0, 3).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
};
const contrast = (a: Rgba, b: Rgba): number => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
};

/** Text colour and plaque background of the first shown element of `selector`. */
async function styles(page: Page, selector: string): Promise<{ color: string; bg: string }> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)!;
    const s = getComputedStyle(el);
    return { color: s.color, bg: s.backgroundColor };
  }, selector);
}

function checkContrast(name: string, st: { color: string; bg: string }): string[] {
  const text = parse(st.color);
  const plate = parse(st.bg);
  return [SNOW, FOG].map((under) => {
    const c = contrast(text, over(plate, hex(under)));
    expect(c, `${name} over ${under}: ${st.color} on ${st.bg}`).toBeGreaterThanOrEqual(4.5);
    return `${name} над ${under}: ${c.toFixed(2)}:1`;
  });
}

test('the toast, the hint and the avalanche banner on their plaques: contrast ≥ 4.5:1 over snow and blizzard fog; «+N» ×1.5; the arrow ×2; screenshot', async ({ page, openGame }) => {
  test.setTimeout(150_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high');
  await waitTicks(page, 30);
  // The first hint of the first minute is up from the start.
  await page.waitForSelector('[data-role="hint"].shown', { timeout: 30_000 });
  const lines = checkContrast('подсказка', await styles(page, '[data-role="hint"].shown'));
  await page.evaluate(() => window.__TEST__!.showToast('Беговые: ×2', 30));
  await page.waitForSelector('[data-role="toast"].shown');
  lines.push(...checkContrast('тост', await styles(page, '[data-role="toast"].shown')));
  await shot1080(page, `${EVIDENCE}/toast_plate_1920x1080_ru.png`, 10);
  const gains = await page.evaluate(() => ({
    hero: parseFloat(getComputedStyle(document.querySelector('.hud-gain')!).fontSize),
    plaque: parseFloat(getComputedStyle(document.querySelector('.hud-stat-gain')!).fontSize),
  }));
  expect(gains.hero).toBeGreaterThanOrEqual(22 * 1.5);
  expect(gains.plaque).toBeGreaterThanOrEqual(18 * 1.5);
  // The warning of a plain wave up the slope: the banner and the arrow to the shelter.
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  await page.evaluate(() => window.__TEST__!.teleport(150, 0));
  await waitTicks(page, 20);
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'warn', undefined, { timeout: 30_000 });
  await page.waitForSelector('[data-role="wave-banner"].shown');
  lines.push(...checkContrast('баннер лавины', await styles(page, '[data-role="wave-banner"].shown')));
  await page.waitForSelector('[data-role="cave-arrow"].shown', { timeout: 15_000 });
  const arrow = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-role="cave-arrow"]')!).fontSize));
  expect(arrow).toBeGreaterThanOrEqual(40 * 2);
  console.log(`readability: ${lines.join('; ')}; +N ${gains.hero}/${gains.plaque} px, arrow ${arrow} px`);
});

test('640×360: the toast and the hint stay off the Speed plaque and the buttons (SCR-01)', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 640, height: 360 });
  await openGame('pace=open&mock_device=mobile');
  await waitTicks(page, 30);
  await page.waitForSelector('[data-role="hint"].shown', { timeout: 30_000 });
  for (const text of ['Беговые: ×2', 'Уф, успел! +15']) {
    await page.evaluate((t) => window.__TEST__!.showToast(t, 30), text);
    await page.waitForSelector('[data-role="toast"].shown');
    await waitTicks(page, 20);
    const hits = await page.evaluate(() => {
      const meet = (a: DOMRect, b: DOMRect): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const out: string[] = [];
      const msgs = ['[data-role="toast"].shown', '[data-role="hint"].shown'].map((s) => document.querySelector(s)).filter((e): e is Element => !!e && getComputedStyle(e).visibility !== 'hidden');
      for (const el of Array.from(document.querySelectorAll('[data-hud]'))) {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        if (r.width === 0 || st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') continue;
        for (const m of msgs) if (meet(m.getBoundingClientRect(), r)) out.push(`${(m as HTMLElement).dataset['role']} × ${(el as HTMLElement).dataset['hud']}`);
      }
      return out;
    });
    expect(hits, text).toEqual([]);
  }
});
