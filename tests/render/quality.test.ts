import { describe, expect, it } from 'vitest';
import { createQuality, initialLevel, qualityParams } from '../../src/render/quality.ts';
import { createStorage } from '../../src/platform/storage.ts';
import { formatNumber } from '../../src/ui/format.ts';

function memStore() {
  const m = new Map<string, string>();
  const backend = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } as unknown as Storage;
  return createStorage('t', backend);
}

describe('quality (docs/02-tech.md 9.3)', () => {
  it('tables: phone never has shadow maps, desktop high caps DPR at 2', () => {
    for (const l of ['low', 'medium', 'high'] as const) expect(qualityParams(l, true).shadowMap).toBe(0);
    expect(qualityParams('high', false).dprCap).toBe(2);
    expect(qualityParams('medium', true).dprCap).toBe(1);
  });
  it('start level: desktop high, phone medium, weak device low', () => {
    expect(initialLevel(false, 8, 8)).toBe('high');
    expect(initialLevel(true, 8, 6)).toBe('medium');
    expect(initialLevel(true, 4, 6)).toBe('low');
    expect(initialLevel(false, 8, 3)).toBe('low');
  });
  it('auto downgrade: DPR first, then the level; never up; remembered', () => {
    const store = memStore();
    const q = createQuality({ mobile: false, devicePixelRatio: 2, store, hardwareConcurrency: 8 });
    expect(q.level).toBe('high');
    expect(q.dpr).toBe(2);
    expect(q.forceSlow(3)).toBe(true);
    expect(q.dpr).toBe(1.75);
    q.forceSlow(3);
    q.forceSlow(3);
    q.forceSlow(3);
    expect(q.dpr).toBe(1);
    expect(q.level).toBe('high');
    expect(q.forceSlow(3)).toBe(true);
    expect(q.level).toBe('medium');
    expect(store.get('quality')).toBe('medium');
    for (let i = 0; i < 10; i++) q.sample(16);
    expect(q.level).toBe('medium');
  });
  it('forced level and dpr are locked', () => {
    const q = createQuality({ mobile: true, devicePixelRatio: 3, store: memStore(), hardwareConcurrency: 8, forcedLevel: 'high', forcedDpr: 0.5 });
    expect(q.level).toBe('high');
    expect(q.dpr).toBe(0.5);
    expect(q.forceSlow(10)).toBe(false);
    expect(q.locked).toBe(true);
  });
});

describe('formatNumber (docs/01-gdd.md 10.4)', () => {
  it('suffixes', () => {
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(1200)).toBe('1.2K');
    expect(formatNumber(2000)).toBe('2K');
    expect(formatNumber(15000)).toBe('15K');
    expect(formatNumber(100000)).toBe('100K');
    expect(formatNumber(2.5e6)).toBe('2.5M');
    expect(formatNumber(12e9)).toBe('12B');
    expect(formatNumber(62.5e9)).toBe('62.5B');
    expect(formatNumber(1e12)).toBe('1T');
    expect(formatNumber(3e15)).toBe('3Qa');
  });
});
