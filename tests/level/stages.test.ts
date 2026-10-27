import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { levelThreshold } from '../../src/sim/levels.ts';

const read = (p: string): unknown => JSON.parse(readFileSync(new URL(`../../content/avalanche/${p}`, import.meta.url), 'utf8'));
type Seg = { type: string; z: number; kind?: string; requires?: number; level?: number; rock?: number };
type W = { id: string; segments: Seg[] };
const stages = (read('pace/stages/worlds.json') as { worlds: W[] }).worlds;
const open = (read('pace/open/worlds.json') as { worlds: W[] }).worlds;
const levels = (read('pace/stages/balance.json') as { levels: { first: number; growth: number } }).levels;

describe('stages pace: ridges ask for a level (docs/01-gdd.md 22.2)', () => {
  it('every ridge of mountains 1–10 requires the threshold of its level', () => {
    for (const w of stages)
      for (const s of w.segments.filter((x) => x.type === 'gate' && x.kind === 'ridge')) {
        expect(Number.isInteger(s.level), `${w.id} z ${s.z}`).toBe(true);
        expect(s.requires).toBe(Math.round(levelThreshold(s.level!, levels) * 1000) / 1000);
      }
  });
  it('the last stage asks for the giant number of the open mountain × gateK within ±9% (one value moved, the balance not recounted)', () => {
    const k = (read('pace/stages/worlds-spec.json') as { stages: { gateK?: number } }).stages.gateK ?? 1;
    stages.forEach((w, i) => {
      const max = (ws: W, kinds: string[]): number => Math.max(...ws.segments.filter((x) => x.type === 'gate' && kinds.includes(x.kind ?? '')).map((x) => x.requires!));
      expect(Math.abs(Math.log(max(w, ['ridge']) / (k * max(open[i]!, ['ridge', 'boss']))))).toBeLessThanOrEqual(Math.log(1.18) / 2 + 1e-9);
    });
  });
});

import { generateWorlds, stringifyWorlds } from '../../src/level/generate.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { mazeOf } from '../../src/level/stage-slope.ts';
import { validateStageWorld, validateStageWorlds, widthChanges } from '../../src/level/validate-stages.ts';
import type { TuningJson, World } from '../../src/content/types.ts';

const tuning = mergePatch(read('tuning.json'), read('pace/stages/tuning.json')) as unknown as TuningJson;
const balance = mergePatch(read('balance.json'), read('pace/stages/balance.json')) as { levels: { first: number; growth: number }; speedCurve: { base: number; k: number; max: number }; coins: { gatePass: number; chest: number } };
const full = (read('pace/stages/worlds.json') as { worlds: World[] }).worlds;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('stages pace: the mountain of stages (LV-03…LV-07, docs/01-gdd.md 22.4–22.8)', () => {
  it('gen:worlds is deterministic and matches the committed pace/stages/worlds.json; the validator passes it', () => {
    const spec = read('pace/stages/worlds-spec.json') as Parameters<typeof generateWorlds>[0]['spec'];
    const a = stringifyWorlds(generateWorlds({ spec, balance, tuning }));
    expect(stringifyWorlds(generateWorlds({ spec, balance, tuning }))).toBe(a);
    expect(a).toBe(readFileSync(new URL('../../content/avalanche/pace/stages/worlds.json', import.meta.url), 'utf8'));
    expect(validateStageWorlds({ schema: 1, generator: '', worlds: full }, balance.levels, tuning)).toEqual([]);
  }, 60_000);
  it('the first minute of mountain 1 is the open one byte for byte (up to ridge 1), plus the teleport pad of the camp', () => {
    const r1 = open[0]!.segments.find((s) => s.type === 'gate' && s.kind === 'ridge')!.z;
    // LV-11 (22.12): the camp of every mountain has the teleport pad — inert until a stage is passed.
    // D-01 (review D20): and the belt grotto of its finish on the axis under ridge 1 (stages.finishGrotto).
    const before = (w: W): string => JSON.stringify(w.segments.filter((s) => s.z < r1 && s.kind !== 'campTeleport' && !(s.type === 'niche' && s.rock === 0)));
    expect(before(stages[0]!)).toBe(before(open[0]!));
  });
  it('10–15 stages a mountain, 2–3 changes of width, no coins on the track past the first minute, trophies growing (SD-03), ±20% of the open coins', () => {
    full.forEach((w, i) => {
      const st = w.stages!;
      expect(st.length).toBeGreaterThanOrEqual(10);
      expect(st.length).toBeLessThanOrEqual(15);
      const ch = widthChanges(st);
      expect(ch).toBeGreaterThanOrEqual(2);
      expect(ch).toBeLessThanOrEqual(3);
      const intro = st[0]!.type === 'intro' ? st[0]!.end : 0;
      // D-01 (Q-Z-2 «A»): but the gifts the spec puts on the axis of its stages (stageGifts), as many as it asks.
      const sg = (read('pace/stages/worlds-spec.json') as { stages: { stageGifts?: { count: number[][] } } }).stages.stageGifts?.count[i] ?? [];
      const coins = w.segments.filter((s) => s.type === 'gift' && s.z >= intro && s['snowflake'] !== true && !(sg[(s['zone'] as number) - 1] ?? 0));
      expect(coins, `mountain ${i + 1}`).toEqual([]);
      for (const [k, n] of sg.entries()) expect(w.segments.filter((s) => s.type === 'gift' && s['zone'] === k + 1 && s.z >= intro && s['snowflake'] !== true).length).toBe(n);
      expect(w.segments.filter((s) => s['snowflake'] === true).length).toBeLessThanOrEqual(2);
      // SD-03 (23.3): the trophies grow stage by stage; their sum is the open coins over upgrade.trophyRate.
      const paid = st.filter((s) => s.trophies > 0);
      for (let k = 1; k < paid.length; k++) expect(paid[k]!.trophies).toBeGreaterThan(paid[k - 1]!.trophies);
      const rate = (read('pace/stages/balance.json') as { upgrade: { trophyRate?: number } }).upgrade.trophyRate ?? 1;
      const sum = paid.reduce((a, s) => a + s.trophies, 0) * rate;
      let openCoins = 0;
      for (const s of (open[i] as unknown as World).segments) {
        if (s.type === 'gift' || s.type === 'chestGrotto' || s.type === 'chest') openCoins += (s['coins'] as number) ?? 0;
        if (s.type === 'gate') openCoins += (s['reward'] as { coins?: number } | undefined)?.coins ?? 0;
      }
      expect(Math.abs(sum / openCoins - 1)).toBeLessThanOrEqual(0.2);
    });
  });
  it('the maze: deterministic, one real exit, 2–3 false; the validator names a broken one', () => {
    expect(JSON.stringify(mazeOf(5, 4, 2, 7))).toBe(JSON.stringify(mazeOf(5, 4, 2, 7)));
    const w = clone(full[1]!);
    const mz = w.stages!.find((s) => s.type === 'maze')!.maze!;
    mz.exits = mz.exits.filter((e) => e.real);
    expect(validateStageWorld(w, balance.levels, tuning, 0.05).some((e) => e.includes('false exits'))).toBe(true);
    const w2 = clone(full[1]!);
    w2.stages!.find((s) => s.type === 'maze')!.maze!.exits.forEach((e) => (e.real = true));
    expect(validateStageWorld(w2, balance.levels, tuning, 0.05).some((e) => e.includes('real exits'))).toBe(true);
  });
  it('the validator names a free strip, a wrong order, a bridge too wide, a lost trophy button and a field-wide avalanche', () => {
    const errs = (f: (w: World) => void): string[] => {
      const w = clone(full[2]!);
      f(w);
      return validateStageWorld(w, balance.levels, tuning, 0.05);
    };
    // A free strip: the pits of the cracks stage gone.
    const cracks = full[2]!.stages!.find((s) => s.type === 'cracks')!;
    expect(errs((w) => (w.segments = w.segments.filter((s) => !(s.type === 'pit' && s.z >= cracks.start && s.z < cracks.end)))).some((e) => e.includes('without its trial'))).toBe(true);
    // MT-06: mountain 3 has a wave — the giant in its first half.
    expect(errs((w) => ([w.stages![1]!.type, w.stages![9]!.type] = [w.stages![9]!.type, 'giant'])).some((e) => e.includes('the giant outside the first half'))).toBe(true);
    const plates = full[2]!.stages!.find((s) => s.width === 'bridge')!;
    expect(errs((w) => w.segments.forEach((s) => s.type === 'floor' && s.z > plates.start && s.z < plates.end && (s['x1'] as number) - (s['x0'] as number) <= 12 && ((s['x0'] = -20), (s['x1'] = 20)))).some((e) => e.includes('bridge'))).toBe(true);
    expect(errs((w) => (w.segments = w.segments.filter((s) => s.type !== 'trophyPad'))).some((e) => e.includes('trophy buttons'))).toBe(true);
    // SD-06: an avalanche on the giant's stage (he is its trial) is named.
    expect(errs((w) => (w.threat.zones = [[w.stages![1]!.z0, w.stages![1]!.end]])).some((e) => e.includes("on the giant's"))).toBe(true);
  });
  it('SD-12: the giant of mountains 1–10 is a trial of every run; one that meets once, runs at the hero or is slow two levels below is named', () => {
    expect(validateStageWorlds({ schema: 1, generator: '', worlds: full }, balance.levels, tuning, 0.05, balance.speedCurve)).toEqual([]);
    const errs = (f: (w: World) => void): string[] => {
      const w = clone(full[2]!);
      f(w);
      return validateStageWorld(w, balance.levels, tuning, 0.05, balance.speedCurve);
    };
    expect(errs((w) => delete w.bosses![0]!.rearm).some((e) => e.includes('meets one run only'))).toBe(true);
    expect(errs((w) => delete w.bosses![0]!.giants[0]!.lag).some((e) => e.includes('lag expected'))).toBe(true);
    expect(errs((w) => delete w.bosses![0]!.level).some((e) => e.includes('does not catch up'))).toBe(true);
  });
});

import { buildLevel } from '../../src/level/builder.ts';
import { floatingErrors } from '../../src/level/validate-stages.ts';
// SD-02 (docs/01-gdd.md 23.2): nothing hangs in the air on the built mountains; a plate lifted off the floor is caught.
describe('nothing hangs in the air (SD-02)', () => {
  it('mountains 1–10 of the stages pace: no box over the floor; a lifted plate is named', () => {
    for (const w of stages) expect(floatingErrors(buildLevel(w as unknown as World)), w.id).toEqual([]);
    const level = buildLevel(stages[0] as unknown as World);
    const y = level.floorAt(0, 1200);
    level.boxes.push({ min: [-5, y + 3, 1195], max: [5, y + 4, 1205], material: 'cave', solid: true, kind: 'plate' });
    expect(floatingErrors(level)).toHaveLength(1);
  });
});
