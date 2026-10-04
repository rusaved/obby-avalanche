import { afterEach, describe, expect, it } from 'vitest';
import { formatNumber, setNumberLocale } from '../../src/ui/format.ts';

// M2-09: number format (docs/01-gdd.md 10.4): up to 999 whole, then 3 significant digits and a suffix; separator by language.
describe('number format (M2-09)', () => {
  afterEach(() => setNumberLocale('en'));
  it('999, 1.2K, 12K, 120K, 1.5M; ru uses a comma, en a point', () => {
    setNumberLocale('en');
    expect([999, 1234, 12_340, 123_400, 1_500_000, 2000].map((n) => formatNumber(n))).toEqual(['999', '1.2K', '12.3K', '123K', '1.5M', '2K']);
    setNumberLocale('ru');
    expect(formatNumber(1234)).toBe('1,2K');
    expect(formatNumber(1000)).toBe('1K');
  });
});
