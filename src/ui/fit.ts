/**
 * fitField (docs/02-tech.md 6.4, docs/03 SCR-02): the canvas rectangle inside the window.
 * Desktop: touches the window on at least one axis and never stretches past 2:1; the rest is margin in
 * sky.bottom colour. Phone and tablet: the whole window.
 */
export interface FieldRect {
  width: number;
  height: number;
  left: number;
  top: number;
}

export function fitField(w: number, h: number, device: 'desktop' | 'mobile' | 'tablet' | 'tv'): FieldRect {
  w = Math.max(1, Math.floor(w));
  h = Math.max(1, Math.floor(h));
  if (device !== 'desktop') return { width: w, height: h, left: 0, top: 0 };
  let width = w;
  let height = h;
  if (w > 2 * h) width = 2 * h;
  else if (h > 2 * w) height = 2 * w;
  return { width, height, left: Math.floor((w - width) / 2), top: Math.floor((h - height) / 2) };
}
