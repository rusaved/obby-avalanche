// What: The answer of the interface to every press (FX-02): a button of the HUD or a window squeezes (class `press`) and taps (`uiTap`); one that cannot act now shakes, says `uiDeny` and shows its reason (data-why) in a bubble.
// Called by: main.ts (createPressFeedback on the #ui layer; hideWhy on a window change); ui/nudge.ts sends the `ui-nudge` event it answers.
// Keep: Only a look and a sound, never a change of state; capture listeners that never stop an event; the reason text comes from the button (data-why), none written here; the jump button and the stick stay silent.

import { nudge } from './nudge.ts';
import { setRich } from './icons.ts';

/** How long a pressed button stays squeezed (the CSS eases in and out of it). */
const PRESS_MS = 140;
/** How long the bubble of a reason stays. */
const WHY_MS = 1600;
/** A deny sound of the same button not again within this (the shake of pointerdown and of its click are one tap). */
const DENY_MS = 250;

const OFF = '.off, [aria-disabled="true"], :disabled';
/** Controls of the run itself: no tap sound on every jump. */
const QUIET = '.hud-jump, [data-press="quiet"]';

/** A reason already written by the button (its row's lock line): it flashes instead of a bubble (review FX: no twice). */
const NEAR_REASON = '.card-lock';
/** How long that line flashes. */
const FLASH_MS = 600;

export function createPressFeedback(root: HTMLElement, o: { sound: (name: 'uiTap' | 'uiDeny') => void }): { hideWhy(): void } {
  const why = document.createElement('div');
  why.className = 'fx-why';
  why.dataset['role'] = 'why';
  root.appendChild(why);
  let whyTimer: ReturnType<typeof setTimeout> | null = null;
  let denied: { b: Element; at: number } | null = null;

  let whyOf: Element | null = null;
  const hideWhy = (): void => {
    if (whyTimer) clearTimeout(whyTimer);
    whyTimer = null;
    whyOf = null;
    why.classList.remove('shown');
  };
  const showWhy = (b: HTMLElement, text: string): void => {
    setRich(why, text);
    whyOf = b;
    const r = b.getBoundingClientRect();
    const host = root.getBoundingClientRect();
    // Inside a window the bubble keeps to its panel (review FX: it went past the window's edge).
    const panel = b.closest('.win-panel')?.getBoundingClientRect();
    const lo = (panel ? panel.left - host.left : 0) + 8;
    const hi = (panel ? panel.right - host.left : host.width) - 8;
    why.classList.add('shown');
    why.style.maxWidth = `${Math.max(120, Math.min(260, hi - lo))}px`;
    const w = why.offsetWidth;
    const x = Math.max(lo, Math.min(hi - w, r.left - host.left + r.width / 2 - w / 2));
    const above = r.top - host.top - why.offsetHeight - 8;
    const y = above >= 8 ? above : r.bottom - host.top + 8;
    why.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    if (whyTimer) clearTimeout(whyTimer);
    whyTimer = setTimeout(hideWhy, WHY_MS);
  };

  root.addEventListener(
    'ui-nudge',
    (ev) => {
      const b = ev.target as HTMLElement;
      const now = performance.now();
      if (denied && denied.b === b && now - denied.at < DENY_MS) return;
      denied = { b, at: now };
      o.sound('uiDeny');
      const text = b.dataset['why'];
      if (text) return showWhy(b, text);
      const line = b.parentElement?.querySelector<HTMLElement>(NEAR_REASON);
      if (line) {
        line.classList.remove('fx-flash');
        void line.offsetWidth;
        line.classList.add('fx-flash');
        setTimeout(() => line.classList.remove('fx-flash'), FLASH_MS);
      }
    },
    true,
  );

  root.addEventListener(
    'pointerdown',
    (ev) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      const b = (ev.target as Element | null)?.closest?.('button, [role="button"]');
      if (whyOf && b !== whyOf) hideWhy();
      if (!(b instanceof HTMLElement) || !root.contains(b) || b.matches(QUIET)) return;
      if (b.matches(OFF)) {
        nudge(b);
        return;
      }
      b.classList.remove('press');
      void b.offsetWidth;
      b.classList.add('press');
      setTimeout(() => b.classList.remove('press'), PRESS_MS);
      // A button that turns its press down itself (the shoes while short) shakes inside this same event: no tap then.
      const at = performance.now();
      setTimeout(() => {
        if (!(denied && denied.b === b && denied.at >= at)) o.sound('uiTap');
      }, 0);
    },
    true,
  );
  return { hideWhy };
}
