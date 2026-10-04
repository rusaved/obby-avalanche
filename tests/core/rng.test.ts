import { describe, expect, it } from 'vitest';
import { createRng, seedFrom } from '../../src/core/rng.ts';

describe('seeded rng (docs/02-tech.md 4.2)', () => {
  it('same seed → same sequence', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
    expect(new Set(seqA).size).toBeGreaterThan(45);
  });

  it('different seeds differ and values stay in [0, 1)', () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
    for (const x of [...seqA, ...seqB]) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('int, range, pick stay inside their bounds', () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const n = r.int(6);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(6);
      const f = r.range(2, 5);
      expect(f).toBeGreaterThanOrEqual(2);
      expect(f).toBeLessThan(5);
    }
    expect(['a', 'b']).toContain(r.pick(['a', 'b']));
  });

  it('seedFrom parses numbers and hashes strings deterministically', () => {
    expect(seedFrom('42')).toBe(42);
    expect(seedFrom(42)).toBe(42);
    expect(seedFrom('snow')).toBe(seedFrom('snow'));
    expect(seedFrom('snow')).not.toBe(seedFrom('ice'));
    expect(seedFrom(null, 123)).toBe(123);
  });
});
