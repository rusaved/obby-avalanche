import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLevel } from '../../src/level/builder.ts';
import { createEvents, type EventEvents, type EventsContext } from '../../src/sim/events.ts';
import type { GameEvents, GameJson, WorldsJson } from '../../src/content/types.ts';
import type { LevelData } from '../../src/level/types.ts';

// RL-07: the blizzard from mountain 2, one for sure a mountain on section 2 or 3 (docs/01-gdd.md 21.7).
const root = resolve(__dirname, '../..');
const read = <T>(f: string): T => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8')) as T;
const cfg = read<GameJson>('game.json').events!;
const worlds = read<WorldsJson>('pace/open/worlds.json');
const DT = 1 / 60;
/** Only the guaranteed one: no chance for either event. */
const sure: GameEvents = { ...cfg, snowball: { ...cfg.snowball!, chance: 0 }, blizzard: { ...cfg.blizzard!, chance: 0 } };

/** Up the sections of the level one by one, `sec` seconds in each, the phase `phase(k)`; the blizzard starts by section. */
function climb(level: LevelData, seed: number, c: GameEvents = sure, phase = (_k: number, _t: number): string => 'idle', sec = 20): number[] {
  const log: Array<{ name: keyof EventEvents; p: unknown }> = [];
  const ev = createEvents(level, c, seed, level.gates.map(() => true), (name, p) => log.push({ name, p }));
  for (const [i, s] of level.sections.entries()) {
    const z = s.z0 + 30;
    for (let t = 0; t < sec; t += DT) {
      const ctx: EventsContext = { tick: 0, hero: { x: 0, y: level.floorAt(0, z), z, sheltered: false }, run: 40, phase: phase(i + 1, t), bots: [] };
      ev.step(DT, ctx);
    }
  }
  return log.filter((e) => e.name === 'eventStart' && (e.p as EventEvents['eventStart']).id === 'blizzard').map((e) => (e.p as EventEvents['eventStart']).section);
}

describe('the blizzard from mountain 2 (RL-07)', () => {
  it('game.json: blizzard from mountain 2, guaranteed on section 2 or 3', () => {
    expect(cfg.blizzard!.fromWorld).toBe(2);
    expect(cfg.blizzard!.guaranteed).toEqual([2, 3]);
  });

  it('mountains 2–10: exactly one sure blizzard, on section 2 or 3, both by seed; mountain 1 — none', () => {
    const seen = new Set<number>();
    for (const w of worlds.worlds) {
      const level = buildLevel(w);
      for (const seed of [1, 2, 3, 4, 5]) {
        const starts = climb(level, seed);
        if (w.index === 1) expect(starts).toEqual([]);
        else {
          expect(starts.length, `${w.id} seed ${seed}`).toBe(1);
          expect([2, 3]).toContain(starts[0]);
          seen.add(starts[0]!);
        }
      }
    }
    expect([...seen].sort()).toEqual([2, 3]);
  });

  it('a siren on entering its section: the blizzard waits for the quiet and comes on that section', () => {
    const level = buildLevel(worlds.worlds[1]!);
    const plain = climb(level, 3);
    const k = plain[0]!;
    const late = climb(level, 3, sure, (s, t) => (s === k && t < 10 ? 'warn' : 'idle'));
    expect(late).toEqual([k]);
  });

  it('with the chance of the data more blizzards may come, the sure one is always there', () => {
    for (const seed of [11, 12, 13]) expect(climb(buildLevel(worlds.worlds[3]!), seed, cfg).length).toBeGreaterThanOrEqual(1);
  });
});
