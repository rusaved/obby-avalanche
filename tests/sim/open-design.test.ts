import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HeroInput } from '../../src/sim/controller.ts';
import { createSim } from '../../src/sim/world.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { OPEN_SLOPE } from '../../src/level/open-slope.ts';
import { validateOpenFun } from '../../src/level/validate-open.ts';
import { moveSpeed } from '../../src/sim/effects/moveSpeed.ts';
import { createHints, type HintFrame } from '../../src/meta/hints.ts';
import type { BalanceJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

// PS-08: level design of the sections (docs/01-gdd.md 17.7; docs/01a-content.md 16.5).
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const balance = mergePatch(read('balance.json') as BalanceJson, read('pace/open/balance.json'));
const tuning = mergePatch(read('tuning.json') as TuningJson, read('pace/open/tuning.json'));
const worlds = read('pace/open/worlds.json') as WorldsJson;
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
const DT = 1 / 60;
const RUN: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };
const STAND: HeroInput = { moveX: 0, moveZ: 0, jump: false, jumpHeld: false };
const w2 = worlds.worlds[1]!;
const level2 = buildLevel(w2);

describe('sections of the open slope (PS-08)', () => {
  it('every fork has its bold lane: a slide, a crevasse with the trampoline over it; from mountain 2 a cliff with a ledge; one chest grotto a mountain', () => {
    for (const w of worlds.worlds) {
      // A fork with a tunnel or a hump (RG, docs/01-gdd.md 18.3) has that element for its lane; the parts of elements carry `shape`.
      const special = new Set(w.segments.filter((s) => s.type === 'tunnel' || s.type === 'hump').map((s) => s['section']));
      const forks = w.segments.filter((s) => s.type === 'fork' && !special.has(s['section'])).length;
      const count = (t: string): number => w.segments.filter((s) => s.type === t && s['shape'] === undefined).length;
      expect(count('slide'), w.id).toBe(forks);
      expect(count('gap'), w.id).toBe(forks);
      // SP-07 (docs/01-gdd.md 20.7): mountain 1 has no trampoline — its crevasse is a dip to run through.
      expect(count('jumpPad'), w.id).toBe(w.index >= 2 ? forks : 0);
      expect(count('cliff'), w.id).toBe(w.index >= 2 ? forks : 0);
      expect(count('chestGrotto'), w.id).toBe(1);
    }
  });

  it('a fall into the crevasse is no fall: no respawn, the hero walks out up its slope', () => {
    const gap = w2.segments.find((s) => s.type === 'gap')!;
    const x = ((gap['x0'] as number) + (gap['x1'] as number)) / 2;
    const s = createSim(level2, tuning, { balance, speedCurve: curve });
    const respawns: number[] = [];
    s.events.on('respawn', ({ z }) => respawns.push(z));
    // Dropped right over its bottom.
    s.teleport(x, (gap['y'] as number) + 1, gap.z + 1);
    for (let i = 0; i < 60; i++) s.step(STAND, DT);
    expect(s.hero.pos.y).toBeCloseTo((gap['y'] as number) - OPEN_SLOPE.crevasse.depth, 1);
    for (let i = 0; i < 120; i++) s.step(RUN, DT);
    expect(respawns).toEqual([]);
    expect(s.hero.pos.z).toBeGreaterThan(gap.z + (gap['length'] as number) + 3);
    expect(s.hero.pos.y).toBeCloseTo(gap['y'] as number, 1);
  });

  it('the chest of the grotto gives 10 × the gift of its section and is back after the avalanche is gone', () => {
    const cg = w2.segments.find((s) => s.type === 'chestGrotto')!;
    const zone = w2.zones.find((z) => z.k === cg['zone'])!;
    expect(cg['coins']).toBe(OPEN_SLOPE.chest.gifts * zone.gift);
    const s = createSim(level2, tuning, { balance, speedCurve: curve });
    const i = s.gifts.findIndex((g) => g.coins === cg['coins'] && Math.abs(g.z - cg.z) < 1e-6);
    expect(i).toBeGreaterThanOrEqual(0);
    const chest = s.gifts[i]!;
    let paid = 0;
    s.events.on('giftTake', ({ index, coins }) => index === i && (paid = coins));
    s.teleport(chest.x, chest.y, chest.z);
    s.step(STAND, DT);
    expect(paid).toBe(cg['coins']);
    expect(chest.taken).toBe(true);
    s.events.emit('waveGone', { tick: s.tick });
    expect(chest.taken).toBe(false);
  });

  it('a ledge on top of the cliff shelters the hero: the front passes under him', () => {
    const ledge = level2.niches.findIndex((n) => n.kind === 'ledge');
    expect(ledge).toBeGreaterThanOrEqual(0);
    const n = level2.niches[ledge]!;
    const s = createSim(level2, tuning, { balance, speedCurve: curve });
    s.teleport((n.box.min[0] + n.box.max[0]) / 2, n.y, n.z);
    s.step(STAND, DT);
    expect(s.shelterIndex()).toBe(ledge);
  });

  it('validate:content checks the trampoline arcs of the open slope: a throw past the ridge is named', () => {
    const speedAt = (st: number): number => moveSpeed(st, curve);
    expect(validateOpenFun(worlds, tuning, speedAt)).toEqual([]);
    const far = JSON.parse(JSON.stringify(tuning)) as TuningJson;
    far.fun.padForward = 400;
    expect(validateOpenFun(worlds, far, speedAt).some((e) => e.includes('past the ridge'))).toBe(true);
  });

  it('«Two ways: pick one» never while running; once, after standing 2 s at a fork', () => {
    const counts: Record<string, number> = {};
    const hints = createHints(balance.hints, counts);
    const frame = (moving: boolean, atFork: boolean): HintFrame => ({
      playSec: 200,
      moving,
      jumped: false,
      touch: false,
      nearLedge: false,
      shoesOffered: false,
      shoesBought: true,
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
      atFork,
    });
    for (let i = 0; i < 600; i++) expect(hints.update(frame(true, true), DT)).not.toBe('hint.fork');
    for (let i = 0; i < 100; i++) expect(hints.update(frame(false, true), DT)).not.toBe('hint.fork');
    let shown = false;
    for (let i = 0; i < 40; i++) if (hints.update(frame(false, true), DT) === 'hint.fork') shown = true;
    expect(shown).toBe(true);
    // Off it goes with the first step, and never again.
    for (let i = 0; i < 10; i++) hints.update(frame(true, true), DT);
    for (let i = 0; i < 400; i++) expect(hints.update(frame(false, true), DT)).not.toBe('hint.fork');
    expect(counts['hint.fork']).toBe(1);
  });
});
