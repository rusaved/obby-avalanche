import { describe, expect, it } from 'vitest';
import { createHints, type HintFrame } from '../../src/meta/hints.ts';
import balance from '../../content/avalanche/balance.json' with { type: 'json' };
import type { BalanceJson } from '../../src/content/types.ts';

const timing = (balance as BalanceJson).hints;
const DT = 0.1;
const idle: HintFrame = {
  playSec: 0,
  moving: false,
  jumped: false,
  touch: false,
  nearLedge: false,
  shoesOffered: false,
  shoesBought: false,
  waveWarnId: 0,
  waveActive: false,
  goldOnGround: false,
  goldCarried: false,
  inShelter: false,
  caughtNow: false,
  treadmillCave: false,
  onBelt: false,
  nearClosedGate: false,
  stuckWay: false,
  onSummit: false,
  towardsPortal: false,
};

/** Runs `sec` of frames with `f` (play time advancing from `t0`), returns the hint at the end. */
function run(h: ReturnType<typeof createHints>, f: Partial<HintFrame>, sec: number, t0 = { t: 0 }): string | null {
  let id: string | null = null;
  for (let i = 0; i < Math.round(sec / DT); i++) {
    t0.t += DT;
    id = h.update({ ...idle, ...f, playSec: t0.t }, DT);
  }
  return id;
}

// M2-08: hint plaques (docs/01-gdd.md 6.5).
describe('hint plaques (M2-08)', () => {
  it('«Run uphill!» at the start, gone after 2 s of running, back after 15 s idle in the first 2 minutes, at most 3 times', () => {
    const counts: Record<string, number> = {};
    const h = createHints(timing, counts);
    const clock = { t: 0 };
    expect(run(h, {}, 0.1, clock)).toBe('hint.move');
    expect(run(h, { moving: true }, 1.5, clock)).toBe('hint.move');
    expect(run(h, { moving: true }, 0.6, clock)).toBeNull();
    expect(run(h, {}, timing.moveIdleSec - 1, clock)).toBeNull();
    expect(run(h, {}, 1.2, clock)).toBe('hint.move');
    run(h, { moving: true }, 3, clock);
    run(h, {}, timing.moveIdleSec + 0.2, clock);
    run(h, { moving: true }, 3, clock);
    expect(counts['hint.move']).toBe(3);
    expect(run(h, {}, timing.moveIdleSec + 1, clock)).toBeNull();
    // After moveRepeatUntilSec of play it never comes back (a new player whose counter is still 0).
    const late = createHints(timing, {});
    expect(run(late, {}, 1, { t: timing.moveRepeatUntilSec + 1 })).toBeNull();
  });

  it('one plaque at a time: «To the cave!» takes the place of «Run uphill!», goes in the cave, once per wave, at most 3 waves', () => {
    const counts: Record<string, number> = {};
    const h = createHints(timing, counts);
    const clock = { t: 0 };
    expect(run(h, {}, 0.2, clock)).toBe('hint.move');
    expect(run(h, { waveWarnId: 1, waveActive: true }, 0.2, clock)).toBe('wave.cave');
    expect(run(h, { waveWarnId: 1, waveActive: true, inShelter: true }, 0.2, clock)).toBeNull();
    expect(run(h, { waveWarnId: 1, waveActive: true }, 0.2, clock)).toBeNull();
    for (const id of [2, 3]) {
      expect(run(h, { waveWarnId: id, waveActive: true, moving: true }, 0.2, clock)).toBe('wave.cave');
      expect(run(h, { waveWarnId: 0, waveActive: false, moving: true }, 0.2, clock)).toBeNull();
    }
    expect(run(h, { waveWarnId: 4, waveActive: true, moving: true }, 0.2, clock)).toBeNull();
    expect(counts['wave.cave']).toBe(3);
  });

  it('«Caves keep you safe» 3 s after the first catch, once; treadmill until the belt; stuck after hints.stuckSec at a closed wall; jump until the jump', () => {
    const counts: Record<string, number> = { 'hint.move': 3 };
    const h = createHints(timing, counts);
    const clock = { t: 200 };
    expect(h.update({ ...idle, playSec: 200, caughtNow: true, moving: true }, DT)).toBe('hint.caught');
    expect(run(h, { moving: true }, timing.caughtSec - 0.3, clock)).toBe('hint.caught');
    expect(run(h, { moving: true }, 0.5, clock)).toBeNull();
    expect(h.update({ ...idle, playSec: 210, caughtNow: true, moving: true }, DT)).toBeNull();

    expect(run(h, { treadmillCave: true, moving: true }, 1, clock)).toBe('hint.treadmill');
    expect(run(h, { treadmillCave: true, onBelt: true, moving: true }, 0.2, clock)).toBeNull();
    expect(run(h, { treadmillCave: true, moving: true }, 1, clock)).toBeNull();

    expect(run(h, { nearClosedGate: true }, timing.stuckSec - 0.5, clock)).toBeNull();
    expect(run(h, { nearClosedGate: true }, 1, clock)).toBe('hint.stuck');
    // PR-12: it holds on the way down to the cave (past stuckDist of the gate too) and goes on entering it.
    expect(run(h, { stuckWay: true, moving: true }, 1, clock)).toBe('hint.stuck');
    expect(run(h, { stuckWay: true, moving: true, inShelter: true }, 0.2, clock)).toBeNull();
    expect(run(h, { nearClosedGate: true }, timing.stuckSec + 0.5, clock)).toBe('hint.stuck');
    expect(run(h, { moving: true }, 0.2, clock)).toBeNull();

    expect(run(h, { nearLedge: true, moving: true }, 0.5, clock)).toBe('hint.jumpPc');
    expect(h.update({ ...idle, playSec: 300, nearLedge: true, jumped: true }, DT)).toBeNull();
    expect(createHints(timing, {}).update({ ...idle, playSec: 300, nearLedge: true, touch: true, moving: true }, DT)).toBe('hint.jumpTouch');
  });

  it('shows survive a reload: the counts object is the one kept in the save', () => {
    const saved: Record<string, number> = {};
    run(createHints(timing, saved), { caughtNow: true, moving: true }, 0.2, { t: 300 });
    expect(saved['hint.caught']).toBe(1);
    const again = createHints(timing, JSON.parse(JSON.stringify(saved)) as Record<string, number>);
    expect(again.update({ ...idle, playSec: 400, caughtNow: true, moving: true }, DT)).toBeNull();
  });

  it('M2-12: the first golden gift says «Bring the golden gift to a cave!» instead of «To the cave!», once in a life', () => {
    const h = createHints(timing, {});
    const t = { t: 200 };
    const warn = { moving: true, waveWarnId: 5, waveActive: true, goldOnGround: true };
    expect(run(h, warn, 0.5, t)).toBe('hint.gold');
    // Taken: the hint goes, and «To the cave!» does not come up on this wave.
    expect(run(h, { ...warn, goldOnGround: false, goldCarried: true }, 0.5, t)).toBeNull();
    run(h, { moving: true }, 1, t);
    // The next wave with a gift: the golden hint is spent, «To the cave!» as usual.
    expect(run(h, { ...warn, waveWarnId: 9 }, 0.5, t)).toBe('wave.cave');
    expect(h.counts['hint.gold']).toBe(1);
  });
});
