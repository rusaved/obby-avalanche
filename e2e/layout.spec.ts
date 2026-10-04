import { test, expect, testState } from './fixtures.ts';

// Layouts and browser bans (docs/02-tech.md 6.4, docs/03 SCR-01…SCR-04, SCR-07). Runs in the mobile project;
// desktop sizes open with mock_device=desktop.
const DESKTOP_SIZES: Array<[number, number]> = [
  [1280, 1024],
  [1920, 1080],
  [2560, 1080],
  [3840, 2160],
  [1536, 864],
  [600, 1300],
];
const MOBILE_SIZES: Array<[number, number]> = [
  [640, 360],
  [844, 390],
];

async function hudInsideField(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const canvas = document.getElementById('game')!.getBoundingClientRect();
    const problems: string[] = [];
    for (const el of Array.from(document.querySelectorAll('[data-hud], [data-role="keys-hint"], [data-role="build-label"]'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
      if (r.left < canvas.left - 1 || r.right > canvas.right + 1 || r.top < canvas.top - 1 || r.bottom > canvas.bottom + 1) {
        problems.push(`${(el as HTMLElement).dataset['hud'] ?? (el as HTMLElement).dataset['role']} outside canvas`);
      }
      if (r.left < -1 || r.top < -1 || r.right > window.innerWidth + 1 || r.bottom > window.innerHeight + 1) problems.push(`${(el as HTMLElement).dataset['hud']} outside window`);
    }
    return problems;
  });
}

test.describe('layout', () => {
  test('SCR-02 desktop sizes: canvas ≤ 2:1, touches the window edges, margins in sky.bottom, HUD inside', async ({ page, openGame }) => {
    for (const [w, h] of DESKTOP_SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await openGame('mock_device=desktop');
      const field = (await testState(page)).field;
      expect(Math.max(field.width, field.height), `${w}x${h}`).toBeLessThanOrEqual(2 * Math.min(field.width, field.height) + 1);
      expect(field.width === w || field.height === h, `${w}x${h} touches an edge`).toBe(true);
      const rect = await page.evaluate(() => {
        const r = document.getElementById('game')!.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      });
      expect(rect.width).toBe(field.width);
      expect(rect.height).toBe(field.height);
      if (w === 2560 && h === 1080) {
        expect(field.left).toBe(200);
        const bg = await page.evaluate(() => getComputedStyle(document.getElementById('app')!).backgroundColor);
        expect(bg.replace(/\s/g, '')).toBe('rgb(232,246,255)');
      }
      expect(await hudInsideField(page), `${w}x${h}`).toEqual([]);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      if (w === 1920 || w === 640) await page.screenshot({ path: `docs/evidence/M1/layout_${w}x${h}_ru.png` });
    }
  });

  test('SCR-01 phone sizes: the whole screen, HUD inside, jump button under the right column', async ({ page, openGame }) => {
    for (const [w, h] of MOBILE_SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await openGame();
      const field = (await testState(page)).field;
      expect(field).toEqual({ width: w, height: h, left: 0, top: 0 });
      expect(await hudInsideField(page), `${w}x${h}`).toEqual([]);
      const jump = await page.locator('[data-hud="jump"]').boundingBox();
      const pause = await page.locator('[data-hud="pause"]').boundingBox();
      expect(jump!.y).toBeGreaterThan(pause!.y + pause!.height);
      expect(Math.min(jump!.width, jump!.height)).toBeGreaterThanOrEqual(0.18 * Math.min(w, h) - 1);
      await page.screenshot({ path: `docs/evidence/M1/layout_${w}x${h}_ru.png` });
    }
  });

  test('SCR-07 resize and rotation keep the game state', async ({ page, openGame }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await openGame();
    await page.evaluate(() => window.__TEST__!.teleport(300));
    await page.waitForTimeout(200);
    const z0 = (await testState(page)).hero!.z;
    const ticks0 = (await testState(page)).ticks;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(300);
    const s = await testState(page);
    expect(Math.abs(s.hero!.z - z0)).toBeLessThan(1);
    expect(s.ticks).toBeGreaterThan(ticks0);
    expect(s.pauseReasons).toEqual([]);
    expect(await hudInsideField(page)).toEqual([]);
  });

  test('SCR-04 right click and long tap open no context menu, no text selection', async ({ page, openGame }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await openGame();
    const prevented = await page.evaluate(() => {
      const canvas = document.getElementById('game')!;
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      const hud = document.querySelector('[data-role="hud"]')!;
      const ev2 = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      return { canvas: !canvas.dispatchEvent(ev), hud: !hud.dispatchEvent(ev2), select: getComputedStyle(document.body).userSelect };
    });
    expect(prevented.canvas).toBe(true);
    expect(prevented.hud).toBe(true);
    expect(prevented.select).toBe('none');
    await page.mouse.click(400, 200, { button: 'right' });
    await page.waitForTimeout(100);
    expect((await testState(page)).menuOpen).toBe(false);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 500, y: 200, id: 9 }] });
    await page.waitForTimeout(900);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: 500, y: 200, id: 9 }] });
    await page.waitForTimeout(100);
    expect((await testState(page)).menuOpen).toBe(false);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});
