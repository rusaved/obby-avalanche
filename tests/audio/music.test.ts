import { describe, expect, it } from 'vitest';
import { musicLevel } from '../../src/audio/music.ts';

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
