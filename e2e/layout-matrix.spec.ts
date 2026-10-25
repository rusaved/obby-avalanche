import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, testState, waitTicks } from './fixtures.ts';

// M6-02 (docs/03-yandex-compliance.md 7.1.4; SCR-01, SCR-02, SCR-03, ADS-07): the full matrix of sizes on the release pace
// — PC, a 16:9 window squeezed by 20%, a PC with the sticky banner on the right, a phone in landscape (and with the banner
// below), a tablet. In each: the HUD inside the field and the window, no two HUD elements over each other, no page scroll,
// the pause window inside the window; a screenshot. The banner: the game shrinks and grows back on resize (ADS-07).
const DIR = 'docs/evidence/compliance/layout';
type Size = { w: number; h: number; device: 'desktop' | 'mobile' | 'tablet'; tag: string };
const PC: Size[] = [
  [1280, 1024], [1366, 768], [1600, 900], [1920, 1080], [2560, 1080], [2560, 1440], [3840, 2160], [600, 1300],
].map(([w, h]) => ({ w: w!, h: h!, device: 'desktop' as const, tag: 'pc' }));
const SQUEEZED: Size[] = [
  { w: 1229, h: 864, device: 'desktop', tag: 'squeezed' },
  { w: 1536, h: 691, device: 'desktop', tag: 'squeezed' },
];
const STICKY: Size[] = [
  { w: 1600, h: 1080, device: 'desktop', tag: 'sticky-right' },
  { w: 844, h: 340, device: 'mobile', tag: 'sticky-bottom' },
];
const PHONE: Size[] = [[640, 360], [667, 375], [844, 390], [932, 430]].map(([w, h]) => ({ w: w!, h: h!, device: 'mobile' as const, tag: 'phone' }));
const TABLET: Size[] = [
  { w: 1024, h: 768, device: 'tablet', tag: 'tablet' },
  { w: 1180, h: 820, device: 'tablet', tag: 'tablet' },
];

/** Problems of the layout: HUD outside the field or window, HUD elements over each other, a page that scrolls. */
function problems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const field = document.getElementById('game')!.getBoundingClientRect();
    const name = (e: Element): string => (e as HTMLElement).dataset['hud'] ?? (e as HTMLElement).dataset['role'] ?? e.className;
    const shown = (e: Element): boolean => {
      const r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      for (let x: Element | null = e; x; x = x.parentElement) {
        const st = getComputedStyle(x);
        if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
      }
      return true;
    };
    const els = Array.from(document.querySelectorAll('[data-hud], [data-role="keys-hint"], [data-role="build-label"]')).filter(shown);
    for (const e of els) {
      const r = e.getBoundingClientRect();
      if (r.left < field.left - 1 || r.right > field.right + 1 || r.top < field.top - 1 || r.bottom > field.bottom + 1) out.push(`${name(e)} outside the field`);
      if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out.push(`${name(e)} outside the window`);
    }
    for (let i = 0; i < els.length; i++)
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i]!;
        const b = els[j]!;
        if (a.contains(b) || b.contains(a)) continue;
        const p = a.getBoundingClientRect();
        const q = b.getBoundingClientRect();
        const ix = Math.min(p.right, q.right) - Math.max(p.left, q.left);
        const iy = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
        if (ix > 2 && iy > 2) out.push(`${name(a)} over ${name(b)} (${ix.toFixed(0)}×${iy.toFixed(0)})`);
      }
    const doc = document.scrollingElement!;
    if (doc.scrollHeight > innerHeight + 1 || doc.scrollWidth > innerWidth + 1) out.push(`the page scrolls (${doc.scrollWidth}×${doc.scrollHeight})`);
    if (scrollY !== 0 || scrollX !== 0) out.push('the page is scrolled');
    return out;
  });
}

/** The pause window inside the window: its panel's box. */
function windowInside(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const p = document.querySelector('[data-role="window"] .win-panel');
    if (!p) return ['no pause window'];
    const r = p.getBoundingClientRect();
    return r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1 ? [`the window ${r.left.toFixed(0)},${r.top.toFixed(0)}–${r.right.toFixed(0)},${r.bottom.toFixed(0)} outside`] : [];
  });
}

/** A size of the matrix in a running game of its device: the window resized (as the browser does), then the checks. */
async function check(page: Page, s: Size): Promise<void> {
  await page.setViewportSize({ width: s.w, height: s.h });
  await page.waitForTimeout(300);
  await waitTicks(page, 3);
  const field = (await testState(page)).field;
  const at = `${s.tag} ${s.w}x${s.h}`;
  if (s.device === 'desktop') {
    // SCR-02: the long side ≤ 2 short ones, the canvas touches the window on one axis at least.
    expect(Math.max(field.width, field.height), at).toBeLessThanOrEqual(2 * Math.min(field.width, field.height) + 1);
    expect(field.width === s.w || field.height === s.h, `${at} touches an edge`).toBe(true);
  } else expect(field, at).toEqual({ width: s.w, height: s.h, left: 0, top: 0 });
  expect(await problems(page), at).toEqual([]);
  await page.screenshot({ path: `${DIR}/${s.tag}_${s.w}x${s.h}.png` });
  await page.evaluate(() => window.__TEST__!.openMenu(true));
  await page.waitForTimeout(300);
  expect(await windowInside(page), `${at} pause`).toEqual([]);
  await page.screenshot({ path: `${DIR}/${s.tag}_${s.w}x${s.h}_pause.png` });
  await page.evaluate(() => window.__TEST__!.openMenu(false));
  await page.waitForTimeout(200);
}

/** The game of a device opened once at the first size of its list. */
async function open(page: Page, openGame: (q?: string) => Promise<void>, s: Size): Promise<void> {
  await page.setViewportSize({ width: s.w, height: s.h });
  await openGame(`pace=stages&mock_device=${s.device}`);
  await page.evaluate(() => window.__TEST__!.holdWave(900));
  await waitTicks(page, 10);
}

test.describe('M6-02 matrix of sizes', () => {
  test.beforeAll(() => void mkdirSync(DIR, { recursive: true }));

  for (const [name, list, touch] of [
    ['SCR-01 SCR-02 SCR-03: PC', PC, false],
    ['SCR-01 SCR-02 SCR-03: a 16:9 window squeezed by 20%, a PC with the sticky banner on the right (ADS-07)', [...SQUEEZED, STICKY[0]!], false],
    ['SCR-01 SCR-03: phone in landscape, with the sticky banner below (ADS-07)', [...PHONE, STICKY[1]!], true],
    ['SCR-01 SCR-03: tablet', TABLET, true],
  ] as const)
    test.describe(() => {
      // A PC is a mouse, not a touch screen: upright (600×1300) it plays on with margins; a touch screen upright asks to turn.
      if (!touch) test.use({ hasTouch: false, isMobile: false });
      test(name, async ({ page, openGame }) => {
        test.setTimeout(300_000);
        await open(page, openGame, list[0]!);
        for (const s of list) await check(page, s);
      });
    });

  test('ADS-07: the sticky banner shrinks the game and it grows back on resize, nothing cut', async ({ page, openGame }) => {
    test.setTimeout(300_000);
    // The banner shown and hidden in a running game: the field follows the window both ways, the HUD stays inside.
    for (const [full, banner, device] of [[[1920, 1080], [1600, 1080], 'desktop'], [[844, 390], [844, 340], 'mobile']] as const) {
      await page.setViewportSize({ width: full[0], height: full[1] });
      await openGame(`pace=stages&mock_device=${device}`);
      for (const [w, h] of [banner, full, banner]) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(300);
        const f = (await testState(page)).field;
        expect(f.left + f.width, `${device} ${w}x${h}`).toBeLessThanOrEqual(w + 1);
        expect(f.top + f.height, `${device} ${w}x${h}`).toBeLessThanOrEqual(h + 1);
        expect(f.width === w || f.height === h, `${device} ${w}x${h} fills an axis`).toBe(true);
        expect(await problems(page), `${device} ${w}x${h}`).toEqual([]);
      }
    }
  });
});
