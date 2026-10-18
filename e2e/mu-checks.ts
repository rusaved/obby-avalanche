import type { Page } from '@playwright/test';

// MU checks of docs/07-mobile-ui.md shared by the touch-mu-*.spec.ts files (tokens, layout, slot, windows).

export const MU_VIEW = { width: 812, height: 375 };
/** The visible frame of a phone under the browser panels (docs/07-mobile-ui.md «Поля кадра»). */
export const VISIBLE_H = 330;

export type Box = { id: string; x: number; y: number; w: number; h: number };

/** Font symbols and emoji the interface never shows (MU-01): the snowflake, the cup, the pause bars, arrows, the
 * triangle of play, the cross and every pictograph. */
export async function forbiddenSymbols(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad = /[❄‖↑▾▶✕➤←→↓]|\p{Extended_Pictographic}/u;
    const out: string[] = [];
    const walker = document.createTreeWalker(document.getElementById('ui')!, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent ?? '';
      if (!bad.test(text)) continue;
      const host = n.parentElement!;
      const r = host.getBoundingClientRect();
      const s = getComputedStyle(host);
      if (r.width === 0 || s.visibility === 'hidden' || s.display === 'none') continue;
      out.push(`${host.className}: ${text}`);
    }
    return out;
  });
}

/** Visible boxes of the HUD (buttons, plaques, the slot, the strip, the bar) in page px. */
export async function hudBoxes(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    const sel: Array<[string, string]> = [
      ['counters', '.hud-left'],
      ['strip', '.hud-mountain'],
      ['pause', '[data-hud="pause"]'],
      ['sound', '[data-hud="sound"]'],
      ['gift', '[data-hud="gift"]'],
      ['speed', '.hud-level .hud-stat'],
      ['bar', '.hud-level-bar'],
      ['shoes', '[data-hud="shoes"]'],
      ['jump', '[data-hud="jump"]'],
      ['slot', '[data-role="hint"], [data-role="need"], [data-role="tutor"], [data-role="wave-banner"], [data-role="ads"], [data-role="toast"]'],
    ];
    const out: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
    const visible = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05;
    };
    for (const [id, q] of sel) {
      for (const el of Array.from(document.querySelectorAll(q))) {
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        out.push({ id, x: r.left, y: r.top, w: r.width, h: r.height });
      }
    }
    document.querySelectorAll('.hud-menu-btn').forEach((el, i) => {
      if (!visible(el)) return;
      const r = el.getBoundingClientRect();
      out.push({ id: `tile${i}`, x: r.left, y: r.top, w: r.width, h: r.height });
    });
    return out;
  });
}

/** Pairs of boxes closer than `gap` px (or overlapping). */
export function tooClose(boxes: Box[], gap: number): string[] {
  const bad: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
      const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
      if (Math.max(dx, dy) < gap - 0.5) bad.push(`${a.id}–${b.id} ${Math.round(Math.max(dx, dy))}px`);
    }
  }
  return bad;
}

/** Rule 4 and 5 of docs/07-mobile-ui.md over the visible interface: tap zones under 44 px, text under `minText` px,
 * buttons whose text has contrast under 4.5:1 against their own solid fill (or the window panel under a see-through
 * one). */
export async function ruleProblems(page: Page, minText: number): Promise<string[]> {
  return page.evaluate((min) => {
    const out: string[] = [];
    const rgb = (c: string): [number, number, number, number] => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return [0, 0, 0, 0];
      const p = m[1]!.split(',').map((x) => Number.parseFloat(x));
      return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
    };
    const lum = ([r, g, b]: number[]): number => {
      const f = (v: number): number => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    const visible = (e: Element): boolean => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05;
    };
    const ui = document.getElementById('ui')!;
    const win = document.querySelector('[data-role="window"].open');
    const scope: Element = win ?? ui;
    const panel = win ? rgb(getComputedStyle(win.querySelector('.win-panel')!).backgroundColor) : null;
    for (const b of Array.from(scope.querySelectorAll('button'))) {
      if (!visible(b) || (b as HTMLButtonElement).disabled) continue;
      if (!win && !b.closest('.hud')) continue;
      const r = b.getBoundingClientRect();
      const name = (b as HTMLElement).dataset['hud'] ?? b.className;
      if (Math.min(r.width, r.height) < 43.5) out.push(`tap ${name} ${Math.round(r.width)}×${Math.round(r.height)}`);
      const s = getComputedStyle(b);
      let bg = rgb(s.backgroundColor);
      if (bg[3] < 1 && panel) bg = [0, 1, 2].map((i) => bg[i]! * bg[3] + panel[i]! * (1 - bg[3])).concat(1) as [number, number, number, number];
      const text = (b.textContent ?? '').trim();
      if (text && bg[3] >= 0.99) {
        const a = lum(rgb(s.color));
        const c = lum(bg);
        const ratio = (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05);
        if (ratio < 4.5) out.push(`contrast ${name} ${ratio.toFixed(2)}`);
      }
    }
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const host = n.parentElement!;
      if (!(n.textContent ?? '').trim() || !visible(host) || host.closest('.bot-labels, .build-label')) continue;
      const px = Number.parseFloat(getComputedStyle(host).fontSize);
      if (px < min - 0.01) out.push(`text ${px}px «${(n.textContent ?? '').trim().slice(0, 24)}»`);
    }
    return out;
  }, minText);
}

/** OS text scaling of a phone (MU-10, rule 6): every font of the interface × k as inline style. */
export async function scaleText(page: Page, k: number): Promise<void> {
  await page.evaluate((f) => {
    // From each element's own size once (the window frame stays between windows: never scaled twice).
    for (const e of Array.from(document.querySelectorAll('#ui *')) as HTMLElement[]) {
      if (e.dataset['fs0']) continue;
      const px = Number.parseFloat(getComputedStyle(e).fontSize);
      e.dataset['fs0'] = String(px);
      if (px > 0) e.style.fontSize = `${px * f}px`;
    }
  }, k);
}

/** Text cut by its box (rule 6): an element with hidden overflow narrower than its content. */
export async function cutText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const scope = document.querySelector('[data-role="window"].open') ?? document.querySelector('.hud')!;
    for (const e of Array.from(scope.querySelectorAll('*'))) {
      const s = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      if (r.width === 0 || s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) continue;
      if (e.classList.contains('win-body')) continue;
      const clip = s.overflowX === 'hidden' || s.textOverflow === 'ellipsis';
      if (clip && e.scrollWidth > e.clientWidth + 1 && (e.textContent ?? '').trim()) out.push(`${(e as HTMLElement).className}: ${(e.textContent ?? '').trim().slice(0, 30)}`);
    }
    return out;
  });
}
