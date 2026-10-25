import { describe, expect, it } from 'vitest';
import { jumpPower } from '../../src/sim/effects/jumpPower.ts';
import { statCurves, takeoffSpeed } from '../../src/sim/effects/index.ts';
import { validateReachability } from '../../src/level/validate.ts';
import balance from '../../content/_sample/balance.json' with { type: 'json' };
import tuning from '../../content/_sample/tuning.json' with { type: 'json' };
import worlds from '../../content/_sample/worlds.json' with { type: 'json' };
import game from '../../content/_sample/game.json' with { type: 'json' };
import type { Curve, TuningJson, WorldsJson } from '../../src/content/types.ts';

const jump = (balance as { jumpCurve: Curve }).jumpCurve;

// M5-09 (docs/01a-content.md 14.2, 14.3): game 2 — the stat drives the jump, not the run.
describe('stat effect jumpPower', () => {
  it('control values of 14.2 (±2%)', () => {
    for (const [stat, v] of [[0, 50], [10, 63.0], [30, 68.6], [100, 75.1], [9999, 100], [1e9, 100]] as const) expect(Math.abs(jumpPower(stat, jump) - v) / v, `stat ${stat}`).toBeLessThan(0.02);
  });

  it('the pack of game 2 runs at the base speed, jumps by the stat', () => {
    expect(game.stat.effect).toBe('jumpPower');
    const c = statCurves('jumpPower', { base: 16, k: 0.3, max: 40 }, jump);
    expect(c.speed).toEqual({ base: 16, k: 0, max: 16 });
    expect(takeoffSpeed(c, 30, 48)).toBeCloseTo(jumpPower(30, jump));
    // Game 1 keeps its run curve and the jump of the tuning.
    const one = statCurves('moveSpeed', { base: 16, k: 0.3, max: 40 }, undefined);
    expect(one.jump).toBeNull();
    expect(takeoffSpeed(one, 30, 48)).toBe(48);
  });

  it('the 9-unit ledge of stretch 3 is reached with the jump of the stat past wall 2, never with the plain jump', () => {
    const w = worlds as unknown as WorldsJson;
    const t = tuning as unknown as TuningJson;
    expect(validateReachability(w, t, (s) => jumpPower(s, jump))).toEqual([]);
    expect(validateReachability(w, t).some((e) => e.includes('ledge'))).toBe(true);
  });
});
