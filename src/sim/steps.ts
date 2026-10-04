/**
 * Steps and the stat (docs/01-gdd.md 3.3, 8.1; docs/02-tech.md 5.3): every `balance.stepLength` units of path on the
 * ground (relative to the support: on a treadmill the belt counts) give `gainPerStep × multipliers × treadmill(p)`.
 * No steps in the air; a teleport or respawn never counts as path. Pure TS, no DOM.
 */
import type { BalanceJson } from '../content/types.ts';

export interface StepGain {
  amount: number;
  steps: number;
  stat: number;
  treadmill: number;
}

export interface StepTracker {
  stat: number;
  steps: number;
  /** Product of the meta multipliers (shoes, pets, trail, aura, boost, vip): 1 until the meta arrives (M3). */
  gainMult: number;
  /** Path since the last step. */
  carry: number;
  /** Adds ground path `dist` under treadmill multiplier `treadmill` (1 = plain ground); returns one gain per step taken. */
  advance(dist: number, treadmill: number): StepGain[];
  /** Forgets the partial path (teleport, respawn, leaving the ground). */
  resetCarry(): void;
}

export function createStepTracker(balance: Pick<BalanceJson, 'stepLength' | 'gainPerStep'>, stat = 0): StepTracker {
  const tracker: StepTracker = {
    stat,
    steps: 0,
    gainMult: 1,
    carry: 0,
    advance(dist, treadmill) {
      const gains: StepGain[] = [];
      if (!(dist > 0)) return gains;
      tracker.carry += dist;
      while (tracker.carry >= balance.stepLength) {
        tracker.carry -= balance.stepLength;
        tracker.steps++;
        const amount = balance.gainPerStep * tracker.gainMult * treadmill;
        tracker.stat += amount;
        gains.push({ amount, steps: tracker.steps, stat: tracker.stat, treadmill });
      }
      return gains;
    },
    resetCarry() {
      tracker.carry = 0;
    },
  };
  return tracker;
}
