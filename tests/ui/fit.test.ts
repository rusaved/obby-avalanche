import { describe, expect, it } from 'vitest';
import { fitField } from '../../src/ui/fit.ts';

describe('fitField (docs/02-tech.md 6.4)', () => {
  it('desktop: 2560×1080 → 2160×1080 centred, 600×1300 → 600×1200, 1920×1080 untouched', () => {
    expect(fitField(2560, 1080, 'desktop')).toEqual({ width: 2160, height: 1080, left: 200, top: 0 });
    expect(fitField(600, 1300, 'desktop')).toEqual({ width: 600, height: 1200, left: 0, top: 50 });
    expect(fitField(1920, 1080, 'desktop')).toEqual({ width: 1920, height: 1080, left: 0, top: 0 });
  });
  it('mobile: the whole window', () => {
    expect(fitField(844, 390, 'mobile')).toEqual({ width: 844, height: 390, left: 0, top: 0 });
    expect(fitField(2560, 1080, 'tablet')).toEqual({ width: 2560, height: 1080, left: 0, top: 0 });
  });
  it('long side never exceeds twice the short side and the field touches an edge', () => {
    for (const [w, h] of [[1280, 1024], [3840, 2160], [1536, 864], [5000, 1000], [300, 3000]]) {
      const f = fitField(w!, h!, 'desktop');
      expect(Math.max(f.width, f.height)).toBeLessThanOrEqual(2 * Math.min(f.width, f.height) + 1);
      expect(f.width === w || f.height === h).toBe(true);
    }
  });
});
