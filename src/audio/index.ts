// What: Sound layer: one AudioContext started by the first gesture, ZzFX buffers built once from sfx.json (footstep sets too), play() with pitch shift and delay, pause suspends it.
// Called by: main.ts (createAudio); app/handles.ts, app/fun-view.ts and app/footsteps-view.ts (GameAudio type).
// Keep: Sounds come only from content sfx.json; nothing plays before a gesture or while paused; max 3 equal sounds per 100 ms; zzfx stays a lazy import.

/**
 * Sound (docs/02-tech.md 10), minimal for M2: one AudioContext started by the first gesture of the player
 * (pointerdown, keydown), master → sfx gain, ZzFX buffers built once from sfx.json on our context, any pause
 * reason suspends the context at once; a sound can play some semitones higher and later (a rising note, a chime).
 * Music, separate volumes and the rest of the events — M5-04.
 */
import type { SfxJson } from '../content/types.ts';

/** Buffer name of the step of footstep set `id` on `surface` (LV-09). */
export const stepSound = (id: string, surface: 'snow' | 'ice'): string => `footsteps.${id}.${surface}`;

/** Not more than this many equal sounds inside SAME_WINDOW_MS (docs/02-tech.md 10). */
const SAME_MAX = 3;
const SAME_WINDOW_MS = 100;

interface ZzfxModule {
  ZZFX: { sampleRate: number; audioContext: AudioContext; buildSamples(...params: number[]): number[] };
}

export interface GameAudio {
  /** `semitones` above the sound as made (a rising note, docs/01-gdd.md 16.4, 16.5); `delaySec` — later (a chime of notes). */
  play(name: string, semitones?: number, delaySec?: number): void;
  /** A footstep (LV-09): `name` of stepSound, at `volume` (0–1) of the effects; not listed in `played`. True — it started. */
  playStep(name: string, semitones: number, volume: number): boolean;
  /** Re-reads `paused()` now (the pause predicate changed without a pause transition: the footsteps window). */
  sync(): void;
  setEnabled(on: boolean): void;
  /** The context runs (after the first gesture and while nothing pauses the game). */
  readonly running: boolean;
  /** Names of the sounds actually started (e2e). */
  readonly played: string[];
}

export function createAudio(opts: {
  sfx: SfxJson;
  enabled: boolean;
  paused: () => boolean;
  onPauseChange: (fn: (paused: boolean) => void) => void;
  gestureTarget: EventTarget;
}): GameAudio {
  let ctx: AudioContext | null = null;
  let sfxGain: GainNode | null = null;
  let enabled = opts.enabled;
  const buffers = new Map<string, AudioBuffer>();
  const recent = new Map<string, number[]>();
  const played: string[] = [];

  const apply = (): void => {
    if (!ctx) return;
    const want = !opts.paused();
    if (want && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    if (!want && ctx.state === 'running') void ctx.suspend().catch(() => undefined);
  };

  const start = async (): Promise<void> => {
    if (ctx) return;
    try {
      const c = new AudioContext();
      ctx = c;
      sfxGain = c.createGain();
      sfxGain.connect(c.destination);
      // ZzFX makes its own context on import: close it, build our buffers with its sample generator.
      const mod = (await import('zzfx')) as unknown as ZzfxModule;
      void mod.ZZFX.audioContext.close().catch(() => undefined);
      const build = (name: string, params: number[]): void => {
        const samples = mod.ZZFX.buildSamples(...params);
        const buf = c.createBuffer(1, Math.max(1, samples.length), mod.ZZFX.sampleRate);
        buf.getChannelData(0).set(samples);
        buffers.set(name, buf);
      };
      for (const [name, params] of Object.entries(opts.sfx)) if (Array.isArray(params)) build(name, params);
      for (const set of opts.sfx.footsteps?.sets ?? []) {
        build(stepSound(set.id, 'snow'), set.snow);
        build(stepSound(set.id, 'ice'), set.ice);
      }
      apply();
    } catch {
      ctx = null;
    }
  };

  const onGesture = (): void => {
    opts.gestureTarget.removeEventListener('pointerdown', onGesture, true);
    opts.gestureTarget.removeEventListener('keydown', onGesture, true);
    void start();
  };
  opts.gestureTarget.addEventListener('pointerdown', onGesture, true);
  opts.gestureTarget.addEventListener('keydown', onGesture, true);
  opts.onPauseChange(() => apply());

  /** Starts sound `name` (`volume` < 1 — through a gain of its own); false — not now (no buffer, off, paused, too many). */
  const fire = (name: string, semitones: number, delaySec: number, volume: number): boolean => {
    const buf = buffers.get(name);
    if (!ctx || !sfxGain || !buf || !enabled || opts.paused() || !(volume > 0)) return false;
    const now = performance.now();
    const times = (recent.get(name) ?? []).filter((t) => now - t < SAME_WINDOW_MS);
    if (times.length >= SAME_MAX) return false;
    times.push(now);
    recent.set(name, times);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (semitones !== 0) src.playbackRate.value = Math.pow(2, semitones / 12);
    if (volume < 1) {
      const g = ctx.createGain();
      g.gain.value = volume;
      src.connect(g).connect(sfxGain);
    } else src.connect(sfxGain);
    src.start(ctx.currentTime + Math.max(0, delaySec));
    return true;
  };

  return {
    get running() {
      return ctx?.state === 'running';
    },
    played,
    setEnabled(on) {
      enabled = on;
    },
    sync: apply,
    playStep(name, semitones, volume) {
      return fire(name, semitones, 0, Math.min(1, volume));
    },
    play(name, semitones = 0, delaySec = 0) {
      if (!fire(name, semitones, delaySec, 1)) return;
      played.push(name);
      if (played.length > 200) played.splice(0, played.length - 200);
    },
  };
}
