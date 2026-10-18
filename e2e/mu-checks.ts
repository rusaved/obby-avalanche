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
