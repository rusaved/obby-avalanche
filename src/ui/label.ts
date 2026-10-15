// What: mountLabel() puts the milestone build label into the corner of the producer link.
// Called by: main.ts, only when the vite define __BUILD_LABEL__ is non-empty and the address has ?debug=1 (SD-08).
// Keep: Must be absent in release builds (e2e/smoke-release.spec.ts expects no build-label); the data-role build-label is used by e2e and scripts/evidence-shots.mjs.

/** Milestone label in the corner of the producer link (docs/05, section 2). Absent in release builds. */
export function mountLabel(text: string, host: HTMLElement): HTMLElement {
  const el = document.createElement('div');
  el.className = 'build-label';
  el.dataset['role'] = 'build-label';
  el.textContent = text;
  host.appendChild(el);
  return el;
}
