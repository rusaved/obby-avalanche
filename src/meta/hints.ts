/**
 * Hint plaques (docs/01-gdd.md 6.5): which one-line hint is up near the hero. One at a time; a hint with a higher
 * priority takes the place of a lower one. How many times each hint was shown lives in the save, so «once in the
 * life of the player» survives F5. Timings come from balance.json → hints. Pure TS, no DOM: the UI only draws it.
 */
import type { HintsTiming } from '../content/types.ts';

export type HintId =
  | 'hint.gold'
  | 'wave.cave'
  | 'hint.caught'
  | 'hint.stuck'
  | 'hint.treadmill'
  | 'hint.shoes'
  | 'hint.jumpPc'
  | 'hint.jumpTouch'
  | 'hint.portal'
  | 'hint.move';

/** What the game sees this frame (filled by the app layer from the simulation and the HUD). */
export interface HintFrame {
  /** Total play time of the player (save.totalPlaySec). */
  playSec: number;
  /** The hero moves on his own legs (speed above a walk) or runs on a belt. */
  moving: boolean;
  jumped: boolean;
  touch: boolean;
  /** The hero is near the first ledge with a gift (docs/01-gdd.md 6.2, 12–20 s). */
  nearLedge: boolean;
  /** The shoes button is on screen, and the player bought a pair. */
  shoesOffered: boolean;
  shoesBought: boolean;
  /** Id of the avalanche on its warning (0 when none), and whether that wave is still coming (warn or run, not resolved). */
  waveWarnId: number;
  waveActive: boolean;
  /** The golden gift of this wave lies on the slope / the hero carries it (docs/01-gdd.md 4.9). */
  goldOnGround: boolean;
  goldCarried: boolean;
  inShelter: boolean;
  /** The hero was caught by an avalanche this frame. */
  caughtNow: boolean;
  /** The hero is in the cave of the scripted wave after it passed, and he stands on its belt. */
  treadmillCave: boolean;
  onBelt: boolean;
  /** Standing below a closed gate outside a cave. */
  nearClosedGate: boolean;
  /** On the way from the gate of hint.stuck down to the cave below it, that gate still closed (docs/01-gdd.md 6.5:
   * the plaque goes on entering the cave, not on the first step; PR-12). */
  stuckWay: boolean;
  /** On the summit, and whether he moves towards the portal. */
  onSummit: boolean;
  towardsPortal: boolean;
}

interface Rule {
  id: HintId;
  max: (t: HintsTiming) => number;
  /** Should it show now (called only while the hint has shows left). */
  show: (f: HintFrame, s: HintsState) => boolean;
  /** Should it go away (elapsed — seconds since it showed). */
  hide: (f: HintFrame, elapsed: number, s: HintsState) => boolean;
}

interface HintsState {
  t: HintsTiming;
  counts: Record<string, number>;
  idleSec: number;
  movedSec: number;
  stuckSec: number;
  portalIdleSec: number;
  lastWaveId: number;
  caughtPending: boolean;
}

/** Order = priority: the first rule wins when two want the plaque. */
const RULES: Rule[] = [
  {
    // The first golden gift in the player's life: instead of «To the cave!» on its warning (docs/01-gdd.md 4.9, 6.5).
    id: 'hint.gold',
    max: () => 1,
    show: (f) => f.waveWarnId > 0 && f.goldOnGround,
    hide: (f) => f.goldCarried || !f.goldOnGround || !f.waveActive,
  },
  {
    id: 'wave.cave',
    max: (t) => t.waveCaveMax,
    show: (f, s) => f.waveWarnId > 0 && f.waveWarnId !== s.lastWaveId && !f.inShelter,
    hide: (f) => f.inShelter || !f.waveActive,
  },
  {
    id: 'hint.caught',
    max: () => 1,
    show: (_, s) => s.caughtPending,
    hide: (_, e, s) => e >= s.t.caughtSec,
  },
  {
    id: 'hint.stuck',
    max: (t) => t.stuckMax,
    show: (_, s) => s.stuckSec >= s.t.stuckSec,
    hide: (f) => f.inShelter || !(f.nearClosedGate || f.stuckWay),
  },
  {
    id: 'hint.treadmill',
    max: () => 1,
    show: (f) => f.treadmillCave && !f.onBelt,
    hide: (f) => f.onBelt || !f.treadmillCave,
  },
  {
    id: 'hint.shoes',
    max: () => 1,
    show: (f) => f.shoesOffered && !f.shoesBought,
    hide: (f, e, s) => f.shoesBought || e >= s.t.shoesSec,
  },
  {
    id: 'hint.jumpPc',
    max: () => 1,
    show: (f) => f.nearLedge && !f.touch,
    hide: (f) => f.jumped || !f.nearLedge,
  },
  {
    id: 'hint.jumpTouch',
    max: () => 1,
    show: (f) => f.nearLedge && f.touch,
    hide: (f) => f.jumped || !f.nearLedge,
  },
  {
    id: 'hint.portal',
    max: (t) => t.portalMax,
    show: (f, s) => f.onSummit && s.portalIdleSec >= s.t.portalIdleSec,
    hide: (f) => !f.onSummit || f.towardsPortal,
  },
  {
    id: 'hint.move',
    max: (t) => t.moveMax,
    // At the very start, and again after moveIdleSec without moving during the first moveRepeatUntilSec of play.
    show: (f, s) =>
      s.movedSec === 0 && f.playSec < s.t.moveRepeatUntilSec && (((s.counts['hint.move'] ?? 0) === 0 && f.playSec < 1) || s.idleSec >= s.t.moveIdleSec),
    hide: (_, __, s) => s.movedSec >= s.t.moveDoneSec,
  },
];

export interface Hints {
  /** The hint on screen now, or null. */
  readonly current: HintId | null;
  /** Shows per hint id (kept in the save). */
  readonly counts: Record<string, number>;
  update(f: HintFrame, dt: number): HintId | null;
}

/** `counts` is the live object from the save: the controller increments it when a hint shows. */
export function createHints(timing: HintsTiming, counts: Record<string, number>): Hints {
  const s: HintsState = { t: timing, counts, idleSec: 0, movedSec: 0, stuckSec: 0, portalIdleSec: 0, lastWaveId: 0, caughtPending: false };
  let current: Rule | null = null;
  let elapsed = 0;
  const left = (r: Rule): boolean => (counts[r.id] ?? 0) < r.max(timing);
  const hints: Hints = {
    get current() {
      return current?.id ?? null;
    },
    counts,
    update(f, dt) {
      // Timers of the frame.
      if (f.moving) {
        s.idleSec = 0;
        s.movedSec += dt;
      } else {
        s.idleSec += dt;
        if (current?.id !== 'hint.move') s.movedSec = 0;
      }
      s.stuckSec = f.nearClosedGate && !f.moving && !f.inShelter ? s.stuckSec + dt : 0;
      s.portalIdleSec = f.onSummit && !f.towardsPortal ? s.portalIdleSec + dt : 0;
      const caughtRule = RULES.find((r) => r.id === 'hint.caught')!;
      if (f.caughtNow && left(caughtRule)) s.caughtPending = true;

      if (current) {
        elapsed += dt;
        if (current.hide(f, elapsed, s)) {
          if (current.id === 'hint.caught') s.caughtPending = false;
          if (current.id === 'hint.stuck') s.stuckSec = 0;
          current = null;
        }
      }
      for (const r of RULES) {
        if (current && RULES.indexOf(current) <= RULES.indexOf(r)) break;
        if (!left(r) || !r.show(f, s)) continue;
        if (current?.id === 'hint.caught') s.caughtPending = false;
        current = r;
        elapsed = 0;
        counts[r.id] = (counts[r.id] ?? 0) + 1;
        if (r.id === 'wave.cave' || r.id === 'hint.gold') s.lastWaveId = f.waveWarnId;
        if (r.id === 'hint.move') s.movedSec = 0;
        break;
      }
      // A wave that came and went without its hint (the hero was already in a cave) is not hinted later.
      if (f.waveWarnId > 0 && f.inShelter) s.lastWaveId = f.waveWarnId;
      return current?.id ?? null;
    },
  };
  return hints;
}
