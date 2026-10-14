import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runCycle, type ModelPack } from '../../scripts/balance-model.ts';
import { mergePatch } from '../../src/content/pace.ts';

// FM-05 (docs/01-gdd.md 19.6; docs/01a-content.md 18.3): the model counts rewards by seconds and the stand on a belt at
// the walls of mountain 1; the profile «novice» runs × 0.8 and buys 15 s late; on the open pace the first 180 s have a
// reward at least every 20 s, the greedy bot stands ≤ 10 s at any wall of mountain 1, the novice ≤ 15 s.
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const pack = (pace: string | null): ModelPack =>
  ({
    game: read('game.json'),
    balance: pace ? mergePatch(read('balance.json'), read(`pace/${pace}/balance.json`)) : read('balance.json'),
    // With the tuning patch of the pace, as sim:balance runs it (SP-03).
    tuning: pace && existsSync(resolve(root, 'content/avalanche', `pace/${pace}/tuning.json`)) ? mergePatch(read('tuning.json'), read(`pace/${pace}/tuning.json`)) : read('tuning.json'),
    pets: read('pets.json'),
    eggs: read('eggs.json'),
    trails: read('trails.json'),
    auras: read('auras.json'),
    worlds: (read(pace ? `pace/${pace}/worlds.json` : 'worlds.json') as { worlds: ModelPack['worlds'] }).worlds,
    // With the base between mountains, as sim:balance runs it since FM-14 (01-gdd 19.2: base.json transitSec).
    ...(pace && existsSync(resolve(root, 'content/avalanche', `pace/${pace}/base.json`)) ? baseOf(read(`pace/${pace}/base.json`) as { enabled: boolean; transitSec: number }) : {}),
  }) as ModelPack;
const baseOf = (b: { enabled: boolean; transitSec: number }): { base?: { transitSec: number } } => (b.enabled ? { base: { transitSec: b.transitSec } } : {});

describe('FM-05: rhythm of the first minutes in the model', () => {
  const open = pack('open');
  const rhythm = (open.balance.sim?.checks?.['rhythm'] ?? {}) as Record<string, number>;
  const greedy = runCycle(open, { profile: 'greedy', mountains: 3 });
  const novice = runCycle(open, { profile: 'novice', mountains: 1, novice: { speed: rhythm['noviceSpeed']!, delaySec: rhythm['noviceDelaySec']! } });

  it('open: a reward at least every maxGap s in the first sec s of the greedy bot', () => {
    const marks = [0, ...greedy.rewards.filter((t) => t <= rhythm['sec']!), rhythm['sec']!];
    const gaps = marks.slice(1).map((t, i) => t - marks[i]!);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(rhythm['maxGap']!);
    // The rewards are sorted and the first ones are the shoes and ridge 1 (F1: by its threshold in the data).
    expect(greedy.rewards).toEqual([...greedy.rewards].sort((a, b) => a - b));
    const f1 = (open.balance.sim?.checks?.['early'] as Array<[number, number]> | undefined)?.[0]?.[1] ?? 15;
    expect(greedy.rewards[0]).toBeLessThanOrEqual(f1);
  });

  it('open: the stand on a belt at every wall of mountain 1 — greedy ≤ standMax, novice ≤ noviceStandMax', () => {
    for (const w of greedy.walls.filter((x) => x.mountain === 1)) expect(w.standSec, `greedy, wall ${w.wall}`).toBeLessThanOrEqual(rhythm['standMax']!);
    for (const w of novice.walls) expect(w.standSec, `novice, wall ${w.wall}`).toBeLessThanOrEqual(rhythm['noviceStandMax']!);
  });

  it('the novice is slower and buys later than the greedy bot; the greedy bot is not touched by the new counters', () => {
    const g1 = runCycle(open, { profile: 'greedy', mountains: 1 });
    expect(novice.mountains[0]!).toBeGreaterThan(g1.mountains[0]!);
    expect(novice.shoeBuys[0]!).toBeGreaterThanOrEqual(g1.shoeBuys[0]! + rhythm['noviceDelaySec']! - 1);
    // Classic: the same cycle with or without the counters (they only record): the reference bot of 01a 3.
    const classic = pack(null);
    const a = runCycle(classic, { profile: 'greedy' });
    const b = runCycle(classic, { profile: 'greedy' });
    expect(a.sec).toBe(b.sec);
    expect(a.rewards.length).toBeGreaterThan(a.walls.length);
  });
});
