/**
 * Round numbers of the stat (docs/01-gdd.md 10.3–10.4; producer decision 04.10, QUESTIONS Q-023): the first time the
 * stat crosses a value of `balance.ui.statMilestones` in this load the plaque flashes. A step that jumps over several
 * values gives one flash with the biggest of them; values already below the stat when the tracker starts (a new
 * mountain, a reload) never fire; after a rebirth (`reset`) they fire again. Thresholds come only from the data.
 * Pure TS.
 */
export interface Milestones {
  /** Returns the biggest value newly crossed by `stat`, or null. */
  check(stat: number): number | null;
  /** After a rebirth: the stat starts again from `stat`, values above it fire again. */
  reset(stat: number): void;
}

export function createMilestones(values: readonly number[], stat: number): Milestones {
  const list = [...values].sort((a, b) => a - b);
  /** Count of values already reached. */
  let reached = 0;
  const skip = (s: number): void => {
    reached = 0;
    while (reached < list.length && (list[reached] as number) <= s) reached++;
  };
  skip(stat);
  return {
    check(s) {
      let hit: number | null = null;
      while (reached < list.length && (list[reached] as number) <= s) {
        hit = list[reached] as number;
        reached++;
      }
      return hit;
    },
    reset: skip,
  };
}
