import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMilestones } from '../../src/sim/milestones.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { createSim } from '../../src/sim/world.ts';
import tuning from '../../content/avalanche/tuning.json' with { type: 'json' };
import balance from '../../content/avalanche/balance.json' with { type: 'json' };
import worldsJson from '../../content/avalanche/worlds.json' with { type: 'json' };
import type { BalanceJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

const bal = balance as BalanceJson;
const list = bal.ui.statMilestones;
const root = resolve(__dirname, '../..');

// M2-13, Q-023: round numbers of Speed (docs/01-gdd.md 10.3–10.4).
describe('round numbers of Speed (M2-13)', () => {
  it('thresholds from balance.json: 1K, 10K … 1e30', () => {
    expect(list[0]).toBe(1e3);
    expect(list[list.length - 1]).toBe(1e30);
    expect(list.every((v, i) => i === 0 || Math.abs(v / list[i - 1]! - 10) < 1e-9)).toBe(true);
  });

  it('999 → 1 000 gives one event 1000; crossing 1 000 again in the same load gives none; one jump over 1K and 10K gives 10 000; after a rebirth they fire again', () => {
    const m = createMilestones(list, 999);
    expect(m.check(999)).toBeNull();
    expect(m.check(1000)).toBe(1000);
    expect(m.check(1000)).toBeNull();
    expect(m.check(950)).toBeNull();
    expect(m.check(1001)).toBeNull();
    const jump = createMilestones(list, 999);
    expect(jump.check(10_500)).toBe(10_000);
    expect(jump.check(10_600)).toBeNull();
    jump.reset(0);
    expect(jump.check(1200)).toBe(1000);
    // A tracker that starts above some values (new mountain, reload) never fires them.
    const late = createMilestones(list, 5000);
    expect(late.check(9999)).toBeNull();
    expect(late.check(10_000)).toBe(10_000);
  });

  it('in the simulation: a step from 999 to 1 000 emits statMilestone {value: 1000} once', () => {
    const world1 = (worldsJson as unknown as WorldsJson).worlds[0]!;
    const level = buildLevel(world1);
    const sim = createSim(level, tuning as TuningJson, { balance: bal, speedCurve: bal.speedCurve, stat: 999 });
    const got: number[] = [];
    sim.events.on('statMilestone', ({ value }) => got.push(value));
    for (let i = 0; i < 60 * 3; i++) sim.step({ moveX: 0, moveZ: 1, jump: false, jumpHeld: false }, 1 / 60);
    expect(sim.progress.stat).toBeGreaterThan(1001);
    expect(got).toEqual([1000]);
  });

  it('no analytics: statMilestone is not in the event catalog of docs/06 and its handler sends nothing', () => {
    const catalog = readFileSync(resolve(root, 'docs/06-analytics.md'), 'utf8');
    const names = Array.from(catalog.matchAll(/^\| \d+ \| [^|]+ \| `([a-zA-Z_0-9]+)`/gm)).map((m) => m[1]);
    expect(names.length).toBeGreaterThan(10);
    expect(names).not.toContain('statMilestone');
    const main = readFileSync(resolve(root, 'src/main.ts'), 'utf8');
    const at = main.indexOf("on('statMilestone'");
    expect(at).toBeGreaterThan(0);
    const handler = main.slice(at, main.indexOf('});', at));
    expect(handler).not.toMatch(/\btrack(Once)?\(/);
  });
});
