// What: The footstep cadence (SD-14): at most `perSec` steps a second whatever the run speed, the variant of a list at random by its weights and never the same twice in a row, the pitch ± `pitch` semitones.
// Called by: app/footsteps-view.ts (on every sim `gain`); tests/audio/steps.test.ts.
// Keep: Pure TS, no DOM; the random source comes from the caller (Math.random in the game — a sound, never the sim); time in seconds of the caller's clock.

/**
 * Footsteps (SD-14, producer 16.10: «the horror starts when the hero runs fast … a rattle»): the sim gains every 4 units,
 * so at a run of 100 a step a gain is 25 a second. The cadence keeps one step per 1 / `perSec` at most — the gains in
 * between are silent; the variant of the list (a set's files, or the ice ones) by `weights`, the one just heard left
 * out; the pitch uniform within ± `pitch` semitones. One voice: the caller fades the step before when the next starts.
 */
export interface StepPick {
  /** Index in the list of the variants. */
  index: number;
  semitones: number;
}

export interface StepCadence {
  /** A step at `now` from list `key` of `count` variants: the one to play, or null — too soon after the last one. */
  next(now: number, key: string, count: number, weights?: readonly number[]): StepPick | null;
}

export function createStepCadence(perSec: number, pitch: number, random: () => number): StepCadence {
  const gap = 1 / Math.max(1e-6, perSec);
  let last = -Infinity;
  const prev = new Map<string, number>();
  return {
    next(now, key, count, weights) {
      if (count <= 0 || now - last < gap - 1e-9) return null;
      last = now;
      const before = prev.get(key) ?? -1;
      const w = (i: number): number => (count > 1 && i === before ? 0 : Math.max(0, weights?.[i] ?? 1));
      let total = 0;
      for (let i = 0; i < count; i++) total += w(i);
      let index = 0;
      if (total > 0) {
        let r = random() * total;
        for (let i = 0; i < count; i++) {
          if (w(i) <= 0) continue;
          index = i;
          r -= w(i);
          if (r < 0) break;
        }
      } else index = (before + 1) % count;
      prev.set(key, index);
      return { index, semitones: (random() * 2 - 1) * pitch };
    },
  };
}
