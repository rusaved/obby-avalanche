import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { CLASSIC_PACE, choosePace, mergePatch, paceOfPath } from '../../src/content/pace.ts';
import { GATE_SIDE, generateWorlds, stretchFun, stringifyWorlds, zoneOfStretch } from '../../src/level/generate.ts';
import { PACK_FILES, validatePack, type PackFiles } from '../../src/level/validate.ts';
import { gateRequirement } from '../../src/sim/gates.ts';
import type { BalanceJson, Segment, TuningJson, WorldsJson, WorldsSpecJson } from '../../src/content/types.ts';

// PR-01, PR-02: the pace flag and the mountains of the fast pace (docs/01-gdd.md 16.1–16.3; docs/01a-content.md 15).
const root = resolve(__dirname, '../..');
const json = <T>(...p: string[]): T => JSON.parse(readFileSync(resolve(root, 'content', ...p), 'utf8')) as T;
const paceNames = (pack: string): string[] => {
  const dir = resolve(root, 'content', pack, 'pace');
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
};
function pacePack(pack: string, pace: string): PackFiles {
  const files: Partial<PackFiles> = {};
  for (const f of PACK_FILES) files[f] = json(pack, f);
  files['balance.json'] = mergePatch(files['balance.json'], json(pack, 'pace', pace, 'balance.json'));
  files['worlds.json'] = json(pack, 'pace', pace, 'worlds.json');
  files['worlds-spec.json'] = json(pack, 'pace', pace, 'worlds-spec.json');
  return files as PackFiles;
}
const num = (s: Segment, k: string): number => s[k] as number;

describe('pace flag (PR-01)', () => {
  it('merge of a patch: objects deep, arrays and values whole; inputs untouched', () => {
    const base = { a: 1, o: { x: 1, y: { p: 1, q: 2 } }, list: [1, 2, 3], keep: 'k' };
    const patch = { a: 2, o: { y: { q: 5 }, z: 3 }, list: [9] };
    const out = mergePatch(base, patch);
    expect(out).toEqual({ a: 2, o: { x: 1, y: { p: 1, q: 5 }, z: 3 }, list: [9], keep: 'k' });
    expect(base).toEqual({ a: 1, o: { x: 1, y: { p: 1, q: 2 } }, list: [1, 2, 3], keep: 'k' });
    (out.list as number[]).push(1);
    expect(patch.list).toEqual([9]);
    expect(mergePatch(base, undefined)).toBe(base);
  });

  it('the pace: ?pace= when the pack has it, else game.json, else classic; a pack without pace/ plays classic', () => {
    expect(choosePace('fast', ['fast'], null)).toBe('fast');
    expect(choosePace('fast', ['fast'], 'classic')).toBe(CLASSIC_PACE);
    expect(choosePace('fast', ['fast'], 'nope')).toBe('fast');
    expect(choosePace('classic', ['fast'], 'fast')).toBe('fast');
    expect(choosePace('fast', [], null)).toBe(CLASSIC_PACE);
    expect(choosePace(undefined, ['fast'], undefined)).toBe(CLASSIC_PACE);
    // _sample: no pace/ folder, no pace in game.json — classic whatever ?pace= says.
    expect(paceNames('_sample')).toEqual([]);
    expect((json<{ pace?: string }>('_sample', 'game.json')).pace).toBeUndefined();
    expect(choosePace(undefined, paceNames('_sample'), 'fast')).toBe(CLASSIC_PACE);
    expect(paceOfPath('/content/avalanche/pace/fast/worlds.json')).toBe('fast');
    expect(paceOfPath('../../content/avalanche/worlds.json')).toBeNull();
  });

  it('avalanche: game.json pace fast, the patch of 01a 15.4 over the shared balance', () => {
    expect(json<{ pace: string }>('avalanche', 'game.json').pace).toBe('fast');
    expect(paceNames('avalanche')).toEqual(['fast']);
    const shared = json<BalanceJson>('avalanche', 'balance.json');
    const fast = mergePatch(shared, json('avalanche', 'pace', 'fast', 'balance.json'));
    expect(fast.coins).toEqual({ ...shared.coins, gatePass: 1 });
    expect(fast.ftue).toEqual({ ...shared.ftue, scriptedWaveWall: 7 });
    expect(fast.rebirth.unlock).toBe('summitWorld10');
    expect(fast.rebirth.lateEase).toEqual({ ...shared.rebirth.lateEase, fromWall: 118 });
    // wallScale of the pace — the output of sim:balance --fit --pace=fast (01a 15.4), its own row of 10 tiers.
    expect(fast.rebirth.wallScale).toHaveLength(shared.rebirth.wallScale.length);
    expect(fast.sim).toEqual({ mountainMin: [1.2, 1.6, 2.0, 2.4, 2.8, 3.2, 3.6, 4.0, 4.4, 4.8], gateCurve: 1.3, keep: 1, roundDigits: 2 });
  });

  it('gen:worlds of every pace is deterministic and matches the committed worlds.json; validate:content passes it', () => {
    for (const pace of paceNames('avalanche')) {
      const files = pacePack('avalanche', pace);
      const input = { spec: files['worlds-spec.json'] as WorldsSpecJson, balance: files['balance.json'] as BalanceJson, tuning: files['tuning.json'] as TuningJson };
      const text = stringifyWorlds(generateWorlds(input));
      expect(stringifyWorlds(generateWorlds(input))).toBe(text);
      expect(readFileSync(resolve(root, 'content/avalanche/pace', pace, 'worlds.json'), 'utf8')).toBe(text);
      const res = validatePack(files, { paces: paceNames('avalanche') });
      expect(res.errors, pace).toEqual([]);
    }
    const unknown = pacePack('avalanche', 'fast');
    (unknown['game.json'] as { pace: string }).pace = 'turbo';
    expect(validatePack(unknown, { paces: ['fast'] }).errors.some((e) => e.startsWith('game.json: pace'))).toBe(true);
  });
});

describe('mountains of the fast pace (PR-02)', () => {
  const files = pacePack('avalanche', 'fast');
  const worlds = (files['worlds.json'] as WorldsJson).worlds;
  const spec = files['worlds-spec.json'] as WorldsSpecJson;

  it('10 mountains of 01a 15.1: gates 15…24 (195), stretches 44…62, length 40 + n·d + 60, look and eggs in pairs', () => {
    expect(worlds.map((w) => w.id)).toEqual(['slope', 'pines', 'pass', 'falls', 'canyon', 'crystal', 'blizzard', 'clouds', 'aurora', 'stars']);
    expect(worlds.map((w) => w.wallCount)).toEqual([15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
    expect(worlds.reduce((a, w) => a + w.wallCount, 0)).toBe(195);
    expect(worlds.map((w) => w.stretch)).toEqual([44, 46, 48, 50, 52, 54, 56, 58, 60, 62]);
    for (const w of worlds) expect(w.length).toBe(40 + w.wallCount * w.stretch + 60);
    expect(worlds.map((w) => w.look)).toEqual(['slope', 'slope', 'pass', 'pass', 'canyon', 'canyon', 'blizzard', 'blizzard', 'aurora', 'aurora']);
    expect(worlds.map((w) => w.egg)).toEqual(['snow', 'snow', 'frost', 'frost', 'ice', 'ice', 'blizzard', 'blizzard', 'aurora', 'aurora']);
    expect(worlds.every((w) => w.layout === 'gateSide')).toBe(true);
    const first = worlds.map((w) => w.threat.firstIntervalSec);
    expect(first[0]).toBe(30);
    expect(new Set(first.slice(1)).size).toBe(9);
    for (const s of first.slice(1)) expect(s >= 10 && s <= 12).toBe(true);
  });

  it('layout gateSide: the cave right beside every gate, sides by turn, the fun by turn (PR-04), rise 3, six zones ⌈6i/n⌉, egg stands', () => {
    let last = 0;
    for (const w of worlds) {
      const n = w.wallCount;
      const gates = w.segments.filter((s) => s.type === 'gate').sort((a, b) => a.z - b.z);
      const caves = w.segments.filter((s) => s.type === 'niche').sort((a, b) => a.z - b.z);
      expect(gates).toHaveLength(n);
      expect(caves).toHaveLength(n);
      expect(w.zones).toHaveLength(GATE_SIDE.zones);
      gates.forEach((g, gi) => {
        const i = gi + 1;
        const c = caves[gi]!;
        const exit = g.z - (c.z + num(c, 'length') / 2);
        expect(exit).toBeGreaterThanOrEqual(2);
        expect(exit).toBeLessThanOrEqual(6);
        expect(g.z - (c.z - num(c, 'length') / 2)).toBeLessThanOrEqual(16);
        expect(c['side']).toBe(i % 2 === 1 ? 'left' : 'right');
        expect(num(c, 'stretch')).toBe(i);
        expect(num(g, 'zone')).toBe(Math.ceil((6 * i) / n));
        expect(num(g, 'zone')).toBe(zoneOfStretch(i, n, 'gateSide'));
        expect(num(g, 'requires')).toBeGreaterThan(last);
        last = num(g, 'requires');
        const z0 = g.z - w.stretch;
        const gifts = w.segments.filter((s) => s.type === 'gift' && s.z > z0 && s.z < g.z);
        // Fun by turn (docs/01-gdd.md 16.4): i mod 3 = 1 — 4 gifts on the path, 2 — a trampoline and its gift up in the
        // air, 0 — an ice slide with 3 gifts on it; every gift on the axis, on the path, in 0–45% of the stretch.
        const fun = stretchFun(i);
        expect(fun).toBe((['slide', 'giftPath', 'jumpPad'] as const)[i % 3]);
        const pads = w.segments.filter((s) => s.type === 'jumpPad' && s.z > z0 && s.z < g.z);
        const slides = w.segments.filter((s) => s.type === 'slide' && s.z > z0 && s.z < g.z);
        expect(gifts).toHaveLength(fun === 'giftPath' ? 4 : fun === 'jumpPad' ? 1 : 3);
        expect(pads).toHaveLength(fun === 'jumpPad' ? 1 : 0);
        expect(slides).toHaveLength(fun === 'slide' ? 1 : 0);
        for (const x of gifts) {
          expect(x['path']).toBe(true);
          expect(x['x']).toBe(0);
          expect(x['height']).toBe(0);
          expect(x['y']).toBe(fun === 'jumpPad' ? num(g, 'y') - 3 + 14.947 : num(g, 'y') - 3);
          expect((x.z - z0) / w.stretch).toBeGreaterThanOrEqual(fun === 'giftPath' ? 0.1 : 0.05);
          expect((x.z - z0) / w.stretch).toBeLessThanOrEqual(0.45);
          expect(x['coins']).toBe(w.zones[num(g, 'zone') - 1]!.gift);
        }
        for (const p of pads) {
          expect([num(p, 'width'), num(p, 'length'), num(p, 'x')]).toEqual([4, 4, 0]);
          expect(p.z - 2 - z0).toBeCloseTo(GATE_SIDE.padRear, 6);
          expect(gifts[0]!['pad']).toBe(true);
          expect(gifts[0]!.z).toBeGreaterThan(p.z);
        }
        for (const p of slides) {
          expect([num(p, 'width'), num(p, 'length'), num(p, 'x')]).toEqual([4, 16, 0]);
          expect(p.z + 8).toBeLessThanOrEqual(z0 + 0.45 * w.stretch);
          for (const x of gifts) expect(Math.abs(x.z - p.z)).toBeLessThan(8);
        }
        const ramp = w.segments.find((s) => s.type === 'ramp' && s.z > z0 && s.z < g.z)!;
        expect(num(ramp, 'rise')).toBe(3);
        expect((ramp.z - z0) / w.stretch).toBeCloseTo(0.45, 3);
      });
      const stands = w.segments.filter((s) => s.type === 'eggStand').sort((a, b) => a.z - b.z);
      expect(stands).toHaveLength(2);
      expect(stands[0]!.z).toBeLessThan(40);
      const behind = gates[Math.ceil(n / 2) - 1]!.z;
      expect(stands[1]!.z).toBeGreaterThan(behind);
      expect(stands[1]!.z).toBeLessThan(behind + w.stretch * 0.2);
    }
    // For 12 walls ⌈6i/n⌉ is the classic ⌈i/2⌉.
    for (let i = 1; i <= 12; i++) expect(zoneOfStretch(i, 12, 'gateSide')).toBe(zoneOfStretch(i, 12, undefined));
  });

  it('treadmills of 01a 15.2 (geometric, rounded along the row) and zone gifts of 15.3; gate coins = gatePass 1 × zone gift', () => {
    const ends = worlds.map((w) => {
      const t = w.segments.filter((s) => s.type === 'niche').sort((a, b) => a.z - b.z).map((s) => num(s, 'treadmill'));
      return [t[0], t[t.length - 1]];
    });
    expect(ends).toEqual([[3, 10], [8, 20], [15, 40], [30, 80], [50, 150], [100, 300], [200, 600], [400, 1200], [800, 2500], [1500, 5000]]);
    expect(worlds[0]!.zones.map((z) => z.gift)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(worlds[9]!.zones.map((z) => z.gift)).toEqual([120e6, 250e6, 400e6, 600e6, 1.2e9, 2e9]);
    for (const w of worlds) {
      for (const g of w.segments.filter((s) => s.type === 'gate')) {
        expect((g['reward'] as { coins: number }).coins).toBe(w.zones[num(g, 'zone') - 1]!.gift);
      }
    }
    // Gate 1 of mountain 1 stays (balance.json sim.keep = 1); the others — sim:balance --fit --pace=fast (balance-fast.txt).
    expect(spec.mountains[0]!.walls[0]!.requires).toBe(10);
  });

  it('a broken cave (exit 8 units below the gate) fails validate:content', () => {
    const broken = JSON.parse(JSON.stringify(files)) as PackFiles;
    const w = (broken['worlds.json'] as WorldsJson).worlds[0]!;
    const cave = w.segments.find((s) => s.type === 'niche' && s['stretch'] === 3)!;
    cave.z -= 5;
    const res = validatePack(broken, { paces: ['fast'] });
    expect(res.errors.some((e) => e.includes('gate 3 — cave exit 8 units below the gate'))).toBe(true);
  });

  it('validate:content checks the trampolines by the tuning numbers: a gift within a plain jump, an arc past the gate (PR-04)', () => {
    const low = JSON.parse(JSON.stringify(files)) as PackFiles;
    const gift = (low['worlds.json'] as WorldsJson).worlds[0]!.segments.find((s) => s.type === 'gift' && s['pad'] === true)!;
    gift['y'] = num(gift, 'y') - 4;
    const errs = validatePack(low, { paces: ['fast'] }).errors;
    expect(errs.some((e) => e.includes('trampoline') && e.includes('within a plain jump'))).toBe(true);
    const far = JSON.parse(JSON.stringify(files)) as PackFiles;
    (far['tuning.json'] as TuningJson).fun.padForward = 40;
    expect(validatePack(far, { paces: ['fast'] }).errors.some((e) => e.includes('trampoline') && e.includes('past gate'))).toBe(true);
    expect(validatePack(files, { paces: ['fast'] }).errors).toEqual([]);
  });

  it('lateEase counts walls through the pace: wall 118 of 195 eases on tier 1, the defaults stay 12 a mountain and 60', () => {
    const fast = files['balance.json'] as BalanceJson;
    const walls = (index: number): { before: number; total: number } => ({
      before: worlds.filter((w) => w.index < index).reduce((a, w) => a + w.wallCount, 0),
      total: 195,
    });
    // Mountain 7 has walls 106…126 of the pace: its 12th is wall 117, its 13th — 118, the first eased one.
    expect(gateRequirement(1, 7, 12, 1, fast.rebirth, walls(7))).toBe(fast.rebirth.wallScale[1]);
    expect(gateRequirement(1, 7, 13, 1, fast.rebirth, walls(7))).toBeLessThan(fast.rebirth.wallScale[1]!);
    expect(gateRequirement(1, 10, 24, 1, fast.rebirth, walls(10))).toBeCloseTo(fast.rebirth.wallScale[1]! * fast.rebirth.lateEase.toFactor, 9);
    const classic = json<BalanceJson>('avalanche', 'balance.json');
    expect(gateRequirement(1, 5, 12, 1, classic.rebirth)).toBe(gateRequirement(1, 5, 12, 1, classic.rebirth, { before: 48, total: 60 }));
  });
});
