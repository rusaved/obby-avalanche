import { describe, expect, it } from 'vitest';
import { nextPlace, type FlowState } from '../../src/meta/base-flow.ts';
import { createSave, parseSave } from '../../src/meta/save.ts';

// FM-07: where the hero goes next — the table of docs/01-gdd.md 19.2 and 19.4.
const S = (o: Partial<FlowState> = {}): FlowState => ({ base: true, startOnReturn: true, baseOpen: true, worlds: 10, summits: 0, saveWorld: 1, frontier: 0, ...o });

describe('base flow (FM-07)', () => {
  it('summits: the first, of the own, of a passed and of the last mountain — the base', () => {
    expect(nextPlace({ kind: 'summit', world: 1, replay: false }, S({ baseOpen: false }))).toEqual({ kind: 'base' });
    expect(nextPlace({ kind: 'summit', world: 4, replay: false }, S({ summits: 4, saveWorld: 4 }))).toEqual({ kind: 'base' });
    expect(nextPlace({ kind: 'summit', world: 1, replay: true }, S({ summits: 4 }))).toEqual({ kind: 'base' });
    expect(nextPlace({ kind: 'summit', world: 10, replay: false }, S({ summits: 10 }))).toEqual({ kind: 'base' });
  });

  it('portals: the own new — its camp; the own begun — its farthest flag; a passed — its camp, run again; a locked — nothing', () => {
    expect(nextPlace({ kind: 'portal', world: 2 }, S({ summits: 1, saveWorld: 1, frontier: 4 }))).toEqual({ kind: 'world', world: 2, resume: false, replay: false });
    expect(nextPlace({ kind: 'portal', world: 3 }, S({ summits: 2, saveWorld: 3, frontier: 2 }))).toEqual({ kind: 'world', world: 3, resume: true, replay: false });
    expect(nextPlace({ kind: 'portal', world: 1 }, S({ summits: 2, saveWorld: 3, frontier: 2 }))).toEqual({ kind: 'world', world: 1, resume: false, replay: true });
    expect(nextPlace({ kind: 'portal', world: 5 }, S({ summits: 2 }))).toEqual({ kind: 'stay' });
  });

  it('rebirth and «Stay» — the base; entering the game — the base after the first summit, before it the mountain of 6.6', () => {
    expect(nextPlace({ kind: 'rebirth' }, S({ summits: 0 }))).toEqual({ kind: 'base' });
    expect(nextPlace({ kind: 'stay' }, S({ summits: 10 }))).toEqual({ kind: 'base' });
    expect(nextPlace({ kind: 'boot' }, S({ summits: 2, saveWorld: 3, frontier: 2 }))).toEqual({ kind: 'base' });
    expect(nextPlace({ kind: 'boot' }, S({ baseOpen: false, saveWorld: 1, frontier: 2 }))).toEqual({ kind: 'world', world: 1, resume: true, replay: false });
    expect(nextPlace({ kind: 'boot' }, S({ startOnReturn: false, summits: 2, saveWorld: 3, frontier: 2 }))).toEqual({ kind: 'world', world: 3, resume: true, replay: false });
  });

  it('enabled false (no base): the summit — the next camp, the last one stays; rebirth — mountain 1; boot — 6.6', () => {
    const off = (o: Partial<FlowState> = {}): FlowState => S({ base: false, ...o });
    expect(nextPlace({ kind: 'summit', world: 1, replay: false }, off())).toEqual({ kind: 'world', world: 2, resume: false, replay: false });
    expect(nextPlace({ kind: 'summit', world: 10, replay: false }, off({ summits: 10 }))).toEqual({ kind: 'stay' });
    expect(nextPlace({ kind: 'rebirth' }, off())).toEqual({ kind: 'world', world: 1, resume: false, replay: false });
    expect(nextPlace({ kind: 'stay' }, off())).toEqual({ kind: 'stay' });
    expect(nextPlace({ kind: 'boot' }, off({ summits: 3, saveWorld: 4, frontier: 1 }))).toEqual({ kind: 'world', world: 4, resume: true, replay: false });
  });

  it('an old save without the base flag loads and enters the game as 6.6', () => {
    const old = { ...createSave(0), world: 3, frontierWall: 2 } as Record<string, unknown>;
    delete old['flags'];
    const s = parseSave(structuredClone(old))!;
    expect(s).not.toBeNull();
    expect(s.flags?.['baseOpen']).toBeUndefined();
    expect(nextPlace({ kind: 'boot' }, S({ baseOpen: s.flags?.['baseOpen'] ?? false, summits: 2, saveWorld: s.world ?? 1, frontier: s.frontierWall ?? 0 }))).toEqual({ kind: 'world', world: 3, resume: true, replay: false });
  });
});
