// What: Where the hero goes next (docs/01-gdd.md 19.2, 19.4): one pure function from an event (entering the game, a summit, a portal of the base, the rebirth, «Stay») and the progress to a place — the base or a mountain (its camp or its farthest flag).
// Called by: main.ts (boot, the summit window, the base portals, the rebirth and the All mountains cleared window); tests/meta/base-flow.test.ts.
// Keep: Pure, no DOM and no save writes: the caller applies the place; base.json absent or enabled false — every event goes as before FM (6.6, 5.2).

/** A place to go: the base, or mountain `world` at its camp or at the flag behind its farthest open ridge (`resume`). */
export type Place = { kind: 'base' } | { kind: 'world'; world: number; resume: boolean; replay: boolean } | { kind: 'stay' };

export type FlowEvent =
  /** Entering the game (a load, F5, another day). */
  | { kind: 'boot' }
  /** The «Mountain k cleared» window closed («Next») after the first summit of k on this tier, or the summit of a
   * mountain already passed (`replay`). */
  | { kind: 'summit'; world: number; replay: boolean }
  /** The hero walked into the portal of mountain `world` on the base. */
  | { kind: 'portal'; world: number }
  /** The rebirth is done, or «Stay» in the All mountains cleared window. */
  | { kind: 'rebirth' }
  | { kind: 'stay' };

export interface FlowState {
  /** base.json of the pace exists and `enabled`. */
  base: boolean;
  /** base.json `startOnReturn`. */
  startOnReturn: boolean;
  /** The base is open: the first summit is done (the save flag). */
  baseOpen: boolean;
  /** Mountains of the pace and summits done on this tier (1…summits passed, summits + 1 — the own one). */
  worlds: number;
  summits: number;
  /** The mountain of the save and the farthest ridge passed on it (6.6). */
  saveWorld: number;
  frontier: number;
}

/** The own mountain: the next after the summits of the tier, none after the last (0). */
export function ownWorld(s: Pick<FlowState, 'worlds' | 'summits'>): number {
  return s.summits < s.worlds ? s.summits + 1 : 0;
}

export function nextPlace(e: FlowEvent, s: FlowState): Place {
  const own = ownWorld(s);
  switch (e.kind) {
    case 'boot':
      // After the first summit the game starts on the base (19.4); before it, or with no base — 6.6.
      if (s.base && s.startOnReturn && s.baseOpen) return { kind: 'base' };
      return { kind: 'world', world: s.saveWorld, resume: s.frontier > 0, replay: false };
    case 'summit':
      if (s.base) return { kind: 'base' };
      // Before FM: the portal of a summit leads to the next mountain's camp; past the last one — the summit stays.
      return e.world < s.worlds ? { kind: 'world', world: e.world + 1, resume: false, replay: false } : { kind: 'stay' };
    case 'portal':
      if (e.world === own) return { kind: 'world', world: own, resume: s.saveWorld === own && s.frontier > 0, replay: false };
      if (e.world >= 1 && e.world <= s.summits) return { kind: 'world', world: e.world, resume: false, replay: true };
      return { kind: 'stay' };
    case 'rebirth':
      return s.base ? { kind: 'base' } : { kind: 'world', world: 1, resume: false, replay: false };
    case 'stay':
      return s.base ? { kind: 'base' } : { kind: 'stay' };
  }
}
