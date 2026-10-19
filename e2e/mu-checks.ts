import type { Page } from '@playwright/test';

// MU checks of docs/07-mobile-ui.md shared by the touch-mu-*.spec.ts files (tokens, layout, slot, windows).

export const MU_VIEW = { width: 812, height: 375 };
/** The visible frame (docs/07-mobile-ui.md «Поля кадра»). MU round 3: the game is laid out in the visible part of the
 * window (visualViewport), no bottom band under browser panels — the whole 375 of MU_VIEW is visible. */
export const VISIBLE_H = MU_VIEW.height;

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
    // Round of fixes MU (reviews: nested texts grew ×1.3 at every level, a window opened later grew again): undo the last
    // scaling, read every size, then write each ×f — every text exactly f of its own size, however often it is called.
    const els = Array.from(document.querySelectorAll('#ui *')) as HTMLElement[];
    for (const e of els) if (e.dataset['fsk'] !== undefined) e.style.fontSize = e.dataset['fsInline'] ?? '';
    const sizes = els.map((e) => Number.parseFloat(getComputedStyle(e).fontSize));
    els.forEach((e, i) => {
      if (e.dataset['fsk'] === undefined) e.dataset['fsInline'] = e.style.fontSize;
      e.dataset['fsk'] = String(f);
      if (sizes[i]! > 0) e.style.fontSize = `${sizes[i]! * f}px`;
    });
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
      // Round of fixes MU (review): a text seen running out of its card or row counts too, not only a clipped one.
      const own = Array.from(e.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim());
      const box = own ? e.parentElement?.closest('.card, .win-row, .mu-row, .tp-item, .records-row, .qs-row') : null;
      if (box && box !== e) {
        const b = box.getBoundingClientRect();
        if (r.left < b.left - 1 || r.right > b.right + 1) out.push(`out of its box ${(e as HTMLElement).className}: ${(e.textContent ?? '').trim().slice(0, 30)}`);
      }
    }
    return out;
  });
}

/**
 * Round of fixes MU (docs/07-mobile-ui.md, rule 19; staff 19.10): the world labels drawn now — bot names, «Stage reward»
 * over a pad, the portal plaques of the base, the ridge signs (their world box projected) — that come within `gap` px of a
 * HUD box. Empty — all clear.
 */
export async function labelsOverHud(page: Page, gap = 8): Promise<string[]> {
  const hud = await hudBoxes(page);
  const labels = await page.evaluate(() => {
    const out: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
    const ui = document.getElementById('ui')!.getBoundingClientRect();
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-role="bot-label"], [data-role="pad-label"].shown, [data-role="portal-label"].shown'))) {
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || Number(s.opacity) < 0.05 || s.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0) out.push({ id: `${el.dataset['role']} «${el.textContent}»`, x: r.left, y: r.top, w: r.width, h: r.height });
    }
    const t = window.__TEST__!;
    t.state().gatesOpen.forEach((_, i) => {
      const b = t.signBox(i);
      if (b.hidden) return;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let k = 0; k < 8; k++) {
        const p = t.project(b.center[0] + ((k & 1 ? 1 : -1) * b.size[0]) / 2, b.center[1] + ((k & 2 ? 1 : -1) * b.size[1]) / 2, b.center[2] + ((k & 4 ? 1 : -1) * b.size[2]) / 2);
        if (!p.ahead) return;
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
      // Off the screen altogether — not drawn where anyone sees it.
      if (x1 < 0 || y1 < 0 || x0 > ui.width || y0 > ui.height) return;
      out.push({ id: `sign ${i}`, x: x0 + ui.left, y: y0 + ui.top, w: x1 - x0, h: y1 - y0 });
    });
    return out;
  });
  const bad: string[] = [];
  for (const l of labels)
    for (const b of hud)
      if (l.x < b.x + b.w + gap && b.x < l.x + l.w + gap && l.y < b.y + b.h + gap && b.y < l.y + l.h + gap) bad.push(`${l.id} at (${Math.round(l.x)}, ${Math.round(l.y)}) by ${b.id}`);
  return bad;
}
