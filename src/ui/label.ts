/** Milestone label in the corner of the producer link (docs/05, section 2). Absent in release builds. */
export function mountLabel(text: string, host: HTMLElement): HTMLElement {
  const el = document.createElement('div');
  el.className = 'build-label';
  el.dataset['role'] = 'build-label';
  el.textContent = text;
  host.appendChild(el);
  return el;
}
