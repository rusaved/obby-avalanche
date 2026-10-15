import { describe, expect, it } from 'vitest';
import { levelNeeded, levelOf, levelProgress, levelThreshold, nearestLevel } from '../../src/sim/levels.ts';

const L = { first: 50, growth: 1.18 };

describe('levels (docs/01-gdd.md 22.2)', () => {
  it('level 1 from zero, level 2 from the first threshold, each next ×growth', () => {
    expect(levelOf(0, L)).toBe(1);
    expect(levelOf(49.9, L)).toBe(1);
    expect(levelOf(50, L)).toBe(2);
    for (let n = 3; n < 60; n++) expect(levelThreshold(n, L) / levelThreshold(n - 1, L)).toBeCloseTo(1.18, 9);
  });
  it('levelOf(levelThreshold(n)) is n and just below is n − 1, n = 1…200', () => {
    for (let n = 1; n <= 200; n++) {
      expect(levelOf(levelThreshold(n, L), L)).toBe(n);
      if (n > 1) expect(levelOf(levelThreshold(n, L) * 0.999, L)).toBe(n - 1);
      expect(levelNeeded(levelThreshold(n, L), L)).toBe(n);
      expect(levelNeeded(Math.round(levelThreshold(n, L) * 1000) / 1000, L)).toBe(n);
    }
  });
  it('a ridge number becomes the nearest level within ±9%', () => {
    for (const r of [50, 520, 1500, 2200, 7100, 13000, 92000, 420000, 3.3e7, 9e11]) {
      const t = levelThreshold(nearestLevel(r, L), L);
      expect(Math.abs(Math.log(t / r))).toBeLessThanOrEqual(Math.log(1.18) / 2 + 1e-9);
    }
  });
  it('the bar: have/need inside the level', () => {
    const p = levelProgress(60, L);
    expect(p.level).toBe(3);
    expect(p.have).toBeCloseTo(1, 6);
    expect(p.need).toBeCloseTo(levelThreshold(4, L) - levelThreshold(3, L), 6);
    expect(levelProgress(0, L)).toMatchObject({ level: 1, have: 0, need: 50 });
  });
});
