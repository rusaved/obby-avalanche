import { describe, expect, it } from 'vitest';
import { addSpendableTrophies, addTrophies } from '../../src/meta/trophies.ts';

// M4-07 (docs/01-gdd.md 9.3): the trophies of the starter pack go to the trophies to spend, never to the all-time
// counter of the records (trophiesTotal); a summit adds to both.
describe('starter pack trophies (M4-07)', () => {
  it('add to the spendable trophies only', () => {
    const save = { trophies: 3, trophiesTotal: 7 };
    addSpendableTrophies(save, 10);
    expect(save).toEqual({ trophies: 13, trophiesTotal: 7 });
    addTrophies(save, 2);
    expect(save).toEqual({ trophies: 15, trophiesTotal: 9 });
  });
});
