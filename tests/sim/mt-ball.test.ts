import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLevel } from '../../src/level/builder.ts';
import { createEvents, type EventEvents, type EventsContext } from '../../src/sim/events.ts';
import type { GameJson, WorldsJson } from '../../src/content/types.ts';

// MT-02: the stage of balls of the canyon (mountain 5) — balls roll down at the hero one after another, a hit is a
// tumble, never a failure; no random event on the other stages.
const root = resolve(__dirname, '../..');
const read = <T>(f: string): T => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8')) as T;
const cfg = read<GameJson>('game.json').events!;
const worlds = read<WorldsJson>('pace/stages/worlds.json');
const DT = 1 / 60;

/** A straight run up the body of stage `n` at v(N) on lane x; the events it met. */
function runUp(wi: number, n: number, x = 0): Array<{ name: keyof EventEvents; p: unknown }> {
  const w = worlds.worlds[wi]!;
  const level = buildLevel(w);
  const st = w.stages!.find((s) => s.n === n)!;
  const log: Array<{ name: keyof EventEvents; p: unknown }> = [];
  const ev = createEvents(level, cfg, 7, level.gates.map(() => true), (name, p) => log.push({ name, p }));
  for (let z = st.start; z < st.end; z += st.speed * DT * 0.5) {
    const ctx: EventsContext = { tick: 0, hero: { x, y: level.floorAt(x, z), z, sheltered: false }, run: st.speed, phase: 'idle', bots: [] };
    ev.step(DT, ctx);
  }
  return log;
}

describe('MT-02: the stage of balls', () => {
  it('mountain 5 opens with a stage of balls; a slow run up it meets several balls, each from the top of the body', () => {
    const w = worlds.worlds[4]!;
    const st = w.stages!.find((s) => s.type === 'ball')!;
    expect(st.n).toBe(1);
    const log = runUp(4, st.n);
    const starts = log.filter((e) => e.name === 'eventStart' && (e.p as EventEvents['eventStart']).id === 'snowball');
    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(log.some((e) => e.name === 'snowballHit'), 'a straight run is hit').toBe(true);
  });
  it('no ball on a stage of another trial (one trial a stage), no avalanche on the stage of balls', () => {
    const w = worlds.worlds[4]!;
    const other = w.stages!.find((s) => s.type === 'cracks')!;
    expect(runUp(4, other.n).some((e) => e.name === 'eventStart')).toBe(false);
    const st = w.stages!.find((s) => s.type === 'ball')!;
    expect((w.threat.zones ?? []).some((z) => z[0] >= st.z0 - 1e-6 && z[1] <= st.end + 1e-6)).toBe(false);
  });
});
