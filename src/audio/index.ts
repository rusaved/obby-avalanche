/**
 * Sound (docs/02-tech.md 10), minimal for M2: one AudioContext started by the first gesture of the player
 * (pointerdown, keydown), master → sfx gain, ZzFX buffers built once from sfx.json on our context, any pause
 * reason suspends the context at once; a sound can play some semitones higher and later (a rising note, a chime).
 * Music, separate volumes and the rest of the events — M5-04.
 */
import type { SfxJson } from '../content/types.ts';

/** Not more than this many equal sounds inside SAME_WINDOW_MS (docs/02-tech.md 10). */
const SAME_MAX = 3;
const SAME_WINDOW_MS = 100;

interface ZzfxModule {
  ZZFX: { sampleRate: number; audioContext: AudioContext; buildSamples(...params: number[]): number[] };
}

export interface GameAudio {
  /** `semitones` above the sound as made (a rising note, docs/01-gdd.md 16.4, 16.5); `delaySec` — later (a chime of notes). */
  play(name: string, semitones?: number, delaySec?: number): void;
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
      ctx = new AudioContext();
      sfxGain = ctx.createGain();
      sfxGain.connect(ctx.destination);
      // ZzFX makes its own context on import: close it, build our buffers with its sample generator.
      const mod = (await import('zzfx')) as unknown as ZzfxModule;
      void mod.ZZFX.audioContext.close().catch(() => undefined);
      for (const [name, params] of Object.entries(opts.sfx)) {
        const samples = mod.ZZFX.buildSamples(...params);
        const buf = ctx.createBuffer(1, Math.max(1, samples.length), mod.ZZFX.sampleRate);
        buf.getChannelData(0).set(samples);
        buffers.set(name, buf);
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

  return {
    get running() {
      return ctx?.state === 'running';
    },
    played,
    setEnabled(on) {
      enabled = on;
    },
    play(name, semitones = 0, delaySec = 0) {
      const buf = buffers.get(name);
      if (!ctx || !sfxGain || !buf || !enabled || opts.paused()) return;
      const now = performance.now();
      const times = (recent.get(name) ?? []).filter((t) => now - t < SAME_WINDOW_MS);
      if (times.length >= SAME_MAX) return;
      times.push(now);
      recent.set(name, times);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      if (semitones !== 0) src.playbackRate.value = Math.pow(2, semitones / 12);
      src.connect(sfxGain);
      src.start(ctx.currentTime + Math.max(0, delaySec));
      played.push(name);
      if (played.length > 200) played.splice(0, played.length - 200);
    },
  };
}
