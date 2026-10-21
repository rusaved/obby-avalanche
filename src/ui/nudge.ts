// What: The answer of an inactive control to a tap: a short shake (class `nudge`, styles.css), restarted on every tap.
// Called by: ui/window.ts (every off button of a window), ui/hud.ts (the shoes button while short).
// Keep: Only a look, never a change of state; «not yet» is `.off` or `aria-disabled` — a native `disabled` button gets no tap.

/** MU round 5 (producer 21.10: everything in the interface answers a tap): shakes `e` once. */
export function nudge(e: HTMLElement): void {
  e.classList.remove('nudge');
  void e.offsetWidth;
  e.classList.add('nudge');
}

/** Marks a button «not yet»: it looks off and shakes on a tap instead of acting (window.ts stops its click). */
export function setOff(b: HTMLElement, off: boolean): void {
  if (off) b.setAttribute('aria-disabled', 'true');
  else b.removeAttribute('aria-disabled');
}
