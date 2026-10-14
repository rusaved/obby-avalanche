import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { freshGifts, keepGift, keptGifts } from '../../src/meta/kept-gifts.ts';
import { parseSave, type SaveData } from '../../src/meta/save.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { createSim } from '../../src/sim/world.ts';
import type { BalanceJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

// RL-08: gifts are not there all the time (docs/01-gdd.md 21.8): taken — taken until a new entry or the rebirth.
const root = resolve(__dirname, '../..');
const read = <T>(f: string): T => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8')) as T;
const balance = mergePatch(read<BalanceJson>('balance.json'), read('pace/open/balance.json'));
const tuning = mergePatch(read<TuningJson>('tuning.json'), read('pace/open/tuning.json'));
const w1 = read<WorldsJson>('pace/open/worlds.json').worlds[0]!;
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
const DT = 1 / 60;
const blank = (): SaveData => parseSave({ v: 2, rev: 1, savedAt: 0 })!;

describe('kept gifts (RL-08)', () => {
  it('the open pace keeps gifts: respawn «never»', () => {
    expect(balance.gifts?.respawn).toBe('never');
  });

  it('a taken gift is kept in the save for its mountain, survives a reload (parseSave), drops on another mountain and on a new entry', () => {
    const save = blank();
    keepGift(save, 1, 5);
    keepGift(save, 1, 9);
    keepGift(save, 1, 5);
    const back = parseSave(JSON.parse(JSON.stringify({ ...save, v: 2, rev: 2, savedAt: 1 })))!;
    expect(keptGifts(back, 1, 100)).toEqual([5, 9]);
    expect(keptGifts(back, 2, 100)).toEqual([]);
    // Indices past the gifts of the mountain (other data) are dropped.
    expect(keptGifts(back, 1, 8)).toEqual([5]);
    keepGift(back, 2, 3);
    expect(keptGifts(back, 1, 100)).toEqual([]);
    expect(keptGifts(back, 2, 100)).toEqual([3]);
    freshGifts(back, 2);
    expect(keptGifts(back, 2, 100)).toEqual([]);
    // A broken field is dropped, not an exception.
    expect(parseSave({ v: 2, rev: 1, savedAt: 0, gifts: 'x' })!.gifts).toBeUndefined();
  });

  it('in the sim: a gift taken before a fall (the roll back to the flag) and before an avalanche stays taken', () => {
    const level = buildLevel(w1);
    const s = createSim(level, tuning, {
      balance,
      speedCurve: curve,
      stat: 5000,
      record: null,
      threat: { threat: { ...w1.threat }, balance, avalanche: tuning.avalanche, scriptedPending: false, normalWavesDone: 10 },
    });
    const g = s.gifts.findIndex((x) => x.path && x.z > 400);
    const gift = s.gifts[g]!;
    s.teleport(gift.x, level.floorAt(gift.x, gift.z - 3) + 0.05, gift.z - 3);
    for (let i = 0; i < 20 && !gift.taken; i++) s.step({ moveX: 0, moveZ: 1, jump: false, jumpHeld: false }, DT);
    expect(gift.taken).toBe(true);
    s.teleport(0, level.killY - 1, gift.z + 10);
    s.step({ moveX: 0, moveZ: 0, jump: false, jumpHeld: false }, DT);
    for (let i = 0; i < 200 && s.caught; i++) s.step({ moveX: 0, moveZ: 0, jump: false, jumpHeld: false }, DT);
    expect(gift.taken).toBe(true);
    s.threat!.trigger();
    for (let i = 0; i < 60 * 60 && s.threat!.state.phase !== 'gone'; i++) s.step({ moveX: 0, moveZ: 0, jump: false, jumpHeld: false }, DT);
    expect(s.threat!.state.phase).toBe('gone');
    expect(gift.taken).toBe(true);
  });
});
