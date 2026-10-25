// What: Plays the cues of sfx.json (a sound as notes) on the sim events named in sfx.json events, and on request by name (shoes, rebirth, a ridge).
// Called by: main.ts (createSfxEvents: wire on every new sim, cue() from the meta handlers); tests/audio/sfx-events.test.ts.
// Keep: Which sound plays on which event lives only in sfx.json (cues, events); reads the sim, never changes it; no DOM.

/**
 * The sound of the events of the game (docs/01-gdd.md 4.8, 10.3; M5-03, M5-04): sfx.json `cues` are named sounds played
 * as notes a gap apart (a chime, a fanfare, «bum-bum-bum» of a rolling ball), `events` give the cues of each simulation
 * event. A cue with `when` plays only for an event carrying those fields (a step on a belt), with `perSec` — not more
 * often (the hum of a belt). The meta of the game (shoes bought, a rebirth, a ridge) plays a cue by its name.
 */
import type { SfxCue, SfxJson } from '../content/types.ts';
import type { Emitter } from '../core/events.ts';
import { createRateCap } from '../audio/index.ts';

/** The bit of the sound layer a cue needs. */
export interface CuePlayer {
  play(name: string, semitones?: number, delaySec?: number): void;
}

export interface SfxEvents {
  /** Subscribes the cues of sfx.json events on this sim's events (a new sim — wire again). */
  wire(events: Emitter<Record<string, unknown>>): void;
  /** Plays cue `name` now (`semitones` higher); unknown — nothing. */
  cue(name: string, semitones?: number): void;
  /** Cues played so far (e2e, tests). */
  readonly played: string[];
}

/** Does the event carry the fields of `when`. */
function matches(cue: SfxCue, payload: unknown): boolean {
  if (!cue.when) return true;
  const p = (payload ?? {}) as Record<string, unknown>;
  return Object.entries(cue.when).every(([k, val]) => p[k] === val);
}

export function createSfxEvents(sfx: SfxJson, audio: () => CuePlayer | null, now: () => number = () => performance.now()): SfxEvents {
  const cues = sfx.cues ?? {};
  const caps = new Map<string, (t: number) => boolean>();
  for (const [id, c] of Object.entries(cues)) if (c.perSec) caps.set(id, createRateCap(c.perSec));
  const played: string[] = [];
  const play = (id: string, semitones = 0, payload?: unknown): void => {
    const c = cues[id];
    if (!c || !matches(c, payload)) return;
    const cap = caps.get(id);
    if (cap && !cap(now())) return;
    const a = audio();
    played.push(id);
    if (played.length > 200) played.splice(0, played.length - 200);
    if (!a) return;
    const notes = c.notes ?? [0];
    notes.forEach((n, k) => a.play(c.sfx, n + semitones, (c.delay ?? 0) + k * (c.gap ?? 0)));
  };
  return {
    played,
    wire(events) {
      for (const [event, list] of Object.entries(sfx.events ?? {})) events.on(event, (payload) => list.forEach((id) => play(id, 0, payload)));
    },
    cue(name, semitones = 0) {
      play(name, semitones);
    },
  };
}
