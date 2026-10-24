import { describe, expect, it } from 'vitest';
import { createRateCap } from '../../src/audio/index.ts';

// FX-06: the interface sounds share one ceiling a second (tuning.json fx.uiSoundPerSec).
describe('interface sound ceiling (FX-06)', () => {
  it('not more than perSec inside any second, free again once the oldest is a second old', () => {
    const cap = createRateCap(8);
    const ok = Array.from({ length: 12 }, (_, i) => cap(i * 10));
    expect(ok.filter(Boolean).length).toBe(8);
    expect(ok.slice(8).some(Boolean)).toBe(false);
    expect(cap(990)).toBe(false);
    expect(cap(1000)).toBe(true);
    expect(cap(1005)).toBe(false);
    expect(cap(1010)).toBe(true);
  });
  it('a steady 5 a second under a ceiling of 8 always plays', () => {
    const cap = createRateCap(8);
    for (let i = 0; i < 50; i++) expect(cap(i * 200)).toBe(true);
  });
});
