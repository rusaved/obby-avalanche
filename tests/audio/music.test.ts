import { describe, expect, it } from 'vitest';
import { musicLevel, musicTrack } from '../../src/audio/music.ts';

// G-09 (producer 26.10, Q-M5-1 B): the music — its own volume and switch, silence while an ad plays or the tab is hidden
// (the pause of the sounds), quieter under an avalanche.
const base = { on: true, volume: 0.8, paused: false, duck: false, duckK: 0.5 };

describe('G-09 · music level', () => {
  it('plays at its own volume', () => expect(musicLevel(base)).toBeCloseTo(0.8, 6));
  it('silent when switched off', () => expect(musicLevel({ ...base, on: false })).toBe(0));
  it('silent while paused (an ad, a hidden tab, a lost focus)', () => expect(musicLevel({ ...base, paused: true })).toBe(0));
  it('quieter under an avalanche', () => expect(musicLevel({ ...base, duck: true })).toBeCloseTo(0.4, 6));
  it('the volume clamped to 0–1', () => {
    expect(musicLevel({ ...base, volume: 3 })).toBe(1);
    expect(musicLevel({ ...base, volume: -1 })).toBe(0);
  });
});

// Z-09 (producer 26.10, «Lavina 19 · Winter look»): the music by roles — a loop on the slope, a loop at the base, a
// fanfare once a summit, the loop quieter under it; without the files — silence (the staff brings them in a branch).
describe('Z-09 · music roles', () => {
  const all = [['a/base.mp3', 'B'], ['a/fanfare.mp3', 'F'], ['a/mountain.mp3', 'M']] as const;
  it('each role plays its own file', () => {
    expect(musicTrack('mountain', all)).toBe('M');
    expect(musicTrack('base', all)).toBe('B');
    expect(musicTrack('fanfare', all)).toBe('F');
  });
  it('a single loop of G-09 plays on the slope and at the base; no fanfare of its own — none', () => {
    const one = [['a/loop-1.mp3', 'L']] as const;
    expect(musicTrack('mountain', one)).toBe('L');
    expect(musicTrack('base', one)).toBe('L');
    expect(musicTrack('fanfare', one)).toBeNull();
  });
  it('no files — silence for every role', () => {
    for (const r of ['mountain', 'base', 'fanfare'] as const) expect(musicTrack(r, [])).toBeNull();
  });
  it('the loop steps aside under a fanfare', () => expect(musicLevel({ ...base, fanfare: true, fanfareK: 0.25 })).toBeCloseTo(0.2, 6));
});
