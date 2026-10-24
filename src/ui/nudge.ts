// What: The answer of an inactive control to a tap: a short shake (class `nudge`, styles.css), restarted on every tap.
// Called by: ui/window.ts (every off button of a window), ui/hud.ts (the shoes button while short), ui/press-feedback.ts.
// Keep: Only a look, never a change of state; «not yet» is `.off` or `aria-disabled` — a native `disabled` button gets no tap.

/** The shake of pointerdown and the one of its click are one tap (FX-02): the second does not restart it. */
const SAME_TAP_MS = 200;

/** MU round 5 (producer 21.10: everything in the interface answers a tap): shakes `e` once; FX-02: tells the
 * `ui-nudge` event (its sound and reason, press-feedback.ts). */
export function nudge(e: HTMLElement): void {
  const now = performance.now();
  const at = e.dataset['nudgeAt'];
  const last = at === undefined ? -Infinity : Number(at);
  if (now - last < SAME_TAP_MS) return;
  e.dataset['nudgeAt'] = String(Math.round(now));
  e.dispatchEvent(new CustomEvent('ui-nudge', { bubbles: true }));
  e.classList.remove('nudge');
  void e.offsetWidth;
  e.classList.add('nudge');
}

/** Marks a button «not yet»: it looks off and shakes on a tap instead of acting (window.ts stops its click). */
export function setOff(b: HTMLElement, off: boolean): void {
  if (off) b.setAttribute('aria-disabled', 'true');
  else b.removeAttribute('aria-disabled');
}
