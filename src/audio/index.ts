// What: Sound layer: one AudioContext started by the first gesture, ZzFX buffers built once from sfx.json, audio files of assets/audio (sfx.json files, footsteps) fetched after it, play() with pitch shift and delay, one voice of steps, pause suspends it.
// Called by: main.ts (createAudio); app/handles.ts, app/fun-view.ts and app/footsteps-view.ts (GameAudio type).
// Keep: Sounds come only from content sfx.json; nothing plays or loads before a gesture (no bytes before ready()), nothing while paused; max 3 equal sounds per 100 ms; zzfx stays a lazy import.

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
/** SD-14: a step fades out over this many seconds when the next one starts (one voice, no click). */
const STEP_FADE_SEC = 0.04;
/** SD-14: silence of a file below this level is cut off its start and end (−50 dB): a step is heard at once. */
const SILENT = 0.003;

/** The audio files of assets/audio, by their path under it (`steps/ice/1.mp3`): URLs of the build, fetched on demand. */
const FILES: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob('../../assets/audio/**/*.mp3', { query: '?url', import: 'default', eager: true }) as Record<string, string>).map(([k, url]) => [k.replace(/^.*\/assets\/audio\//, ''), url]),
);

/** FX-06: the interface sounds (`ui…` of sfx.json) share one ceiling of `perSec` a second; true — this one may play. */
export function createRateCap(perSec: number): (now: number) => boolean {
  const times: number[] = [];
  return (now) => {
    while (times.length > 0 && now - times[0]! >= 1000) times.shift();
    if (times.length >= perSec) return false;
    times.push(now);
    return true;
  };
}

/** The bits of an AudioContext the step voice uses (a fake one in tests). */
export interface VoiceContext {
  readonly currentTime: number;
  createBufferSource(): AudioBufferSourceNode;
  createGain(): GainNode;
}

/** SD-14 (producer 16.10: no steps over each other): one voice — a step still sounding fades out over STEP_FADE_SEC as
 * the next one starts; `play` starts the audible part [from, to] of `buf`. */
export function createStepVoice(ctx: VoiceContext, out: AudioNode): (buf: AudioBuffer, from: number, to: number, semitones: number, volume: number) => void {
  let voice: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  return (buf, from, to, semitones, volume) => {
    const t = ctx.currentTime;
    if (voice) {
      const g = voice.gain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + STEP_FADE_SEC);
      try {
        voice.src.stop(t + STEP_FADE_SEC);
      } catch {
        // Already stopped: nothing to fade.
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (semitones !== 0) src.playbackRate.value = Math.pow(2, semitones / 12);
    const gain = ctx.createGain();
    gain.gain.value = Math.min(1, volume);
    src.connect(gain).connect(out);
    src.start(t, from, to - from);
    const v = { src, gain };
    src.onended = () => {
      if (voice === v) voice = null;
    };
    voice = v;
  };
}

/** SD-14: the part of a decoded file louder than SILENT (seconds from its start), a little air kept at its end. */
export function audibleRange(channels: readonly Float32Array[], rate: number): [number, number] {
  let first = Infinity;
  let last = -1;
  for (const ch of channels)
    for (let i = 0; i < ch.length; i++)
      if (Math.abs(ch[i]!) > SILENT) {
        if (i < first) first = i;
        if (i > last) last = i;
      }
  if (last < 0) return [0, 0];
  const len = Math.max(...channels.map((c) => c.length));
  return [Math.max(0, first - 0.005 * rate) / rate, Math.min(len, last + 0.02 * rate) / rate];
}

interface ZzfxModule {
  ZZFX: { sampleRate: number; audioContext: AudioContext; buildSamples(...params: number[]): number[] };
}

export interface GameAudio {
  /** `semitones` above the sound as made (a rising note, docs/01-gdd.md 16.4, 16.5); `delaySec` — later (a chime of notes). */
  play(name: string, semitones?: number, delaySec?: number): void;
  /** A footstep (LV-09, SD-14): audio file `file` (under assets/audio), at `volume` (0–1) of the effects; one voice — the
   * step before fades out; not listed in `played`. True — it started (false: not loaded yet, off, paused). */
  playStep(file: string, semitones: number, volume: number): boolean;
  /** SD-14: fetch these audio files now (after the first gesture; at once if it was): a set chosen, the window of sets. */
  load(files: readonly string[]): void;
  /** Re-reads `paused()` now (the pause predicate changed without a pause transition: the footsteps window). */
  sync(): void;
  setEnabled(on: boolean): void;
  /** MU-07 (w3-pause): the volume of every sound, 0–1 (the «Sounds» slider). */
  setVolume(v: number): void;
  /** The context runs (after the first gesture and while nothing pauses the game). */
  readonly running: boolean;
  /** M5-02 (docs/01-gdd.md 4.8): a looped sound `name` at `level` (0–1 of the effects, eased), `semitones` higher; 0 — it
   * fades out and stops. One loop per name (the avalanche rumble). */
  hum(name: string, level: number, semitones?: number): void;
  /** The level each loop is heading to now (e2e). */
  readonly hums: Record<string, number>;
  /** Names of the sounds actually started (e2e). */
  readonly played: string[];
  /** SD-14: audio files decoded so far (e2e waits for them before a preview). */
  readonly loaded: number;
}

export function createAudio(opts: {
  sfx: SfxJson;
  enabled: boolean;
  paused: () => boolean;
  onPauseChange: (fn: (paused: boolean) => void) => void;
  gestureTarget: EventTarget;
  /** FX-06 (tuning.json fx.uiSoundPerSec): the ceiling of the interface sounds a second; absent — none beyond SAME_MAX. */
  uiPerSec?: number | undefined;
}): GameAudio {
  const uiCap = opts.uiPerSec ? createRateCap(opts.uiPerSec) : null;
  let ctx: AudioContext | null = null;
  let sfxGain: GainNode | null = null;
  let enabled = opts.enabled;
  const buffers = new Map<string, AudioBuffer>();
  /** SD-14: decoded audio files by path, with their audible part. */
  const clips = new Map<string, { buf: AudioBuffer; from: number; to: number }>();
  const asked = new Set<string>();
  let stepVoice: ReturnType<typeof createStepVoice> | null = null;
  const recent = new Map<string, number[]>();
  const played: string[] = [];
  const fileOf = (name: string): string | undefined => opts.sfx.files?.[name];
  const fetchClip = (c: AudioContext, file: string): void => {
    const url = FILES[file];
    if (!url || clips.has(file)) return;
    void fetch(url)
      .then((r) => r.arrayBuffer())
      .then((data) => c.decodeAudioData(data))
      .then((buf) => {
        const [from, to] = audibleRange(Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i)), buf.sampleRate);
        clips.set(file, { buf, from, to: Math.max(from + 0.01, to) });
      })
      .catch(() => asked.delete(file));
  };
  const load = (files: readonly string[]): void => {
    for (const f of files) {
      if (asked.has(f)) continue;
      asked.add(f);
      if (ctx) fetchClip(ctx, f);
    }
  };

  const apply = (): void => {
    if (!ctx) return;
    const want = !opts.paused();
    if (want && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    if (!want && ctx.state === 'running') void ctx.suspend().catch(() => undefined);
  };

  /** MU-07: the volume of the «Sounds» slider (0–1) on the effects gain. */
  let volume = 1;
  const start = async (): Promise<void> => {
    if (ctx) return;
    try {
      const c = new AudioContext();
      ctx = c;
      sfxGain = c.createGain();
      sfxGain.gain.value = volume;
      sfxGain.connect(c.destination);
      stepVoice = createStepVoice(c, sfxGain);
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
      // SD-14: the files of the events and the ones asked for before the gesture, now.
      load(Object.values(opts.sfx.files ?? {}));
      for (const f of asked) fetchClip(c, f);
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
    // SD-14: an event with an audio file plays the file (its audible part).
    const file = fileOf(name);
    const clip = file ? clips.get(file) : undefined;
    const buf = clip?.buf ?? (file ? undefined : buffers.get(name));
    if (!ctx || !sfxGain || !buf || !enabled || opts.paused() || !(volume > 0)) return false;
    const now = performance.now();
    const times = (recent.get(name) ?? []).filter((t) => now - t < SAME_WINDOW_MS);
    if (times.length >= SAME_MAX) return false;
    if (uiCap && name.startsWith('ui') && !uiCap(now)) return false;
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
    if (clip) src.start(ctx.currentTime + Math.max(0, delaySec), clip.from, clip.to - clip.from);
    else src.start(ctx.currentTime + Math.max(0, delaySec));
    return true;
  };

  /** M5-02: the looped sounds by name — their source, gain and the level they head to. */
  const loops = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();
  const hums: Record<string, number> = {};
  const HUM_EASE_SEC = 0.25;
  const HUM_FADE_SEC = 1;

  return {
    hums,
    hum(name, level, semitones = 0) {
      const want = enabled ? Math.max(0, Math.min(1, level)) : 0;
      hums[name] = want;
      const c = ctx;
      if (!c || !sfxGain) return;
      let loop = loops.get(name);
      if (!loop && want > 0) {
        const buf = buffers.get(name);
        if (!buf) return;
        const src = c.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const gain = c.createGain();
        gain.gain.value = 0;
        src.connect(gain).connect(sfxGain);
        src.start();
        loop = { src, gain };
        loops.set(name, loop);
      }
      if (!loop) return;
      loop.src.playbackRate.value = Math.pow(2, semitones / 12);
      const g = loop.gain.gain;
      // Up quickly, down over HUM_FADE_SEC (docs/01-gdd.md 4.8: the rumble dies away over 1 s).
      g.setTargetAtTime(want, c.currentTime, (want >= g.value ? HUM_EASE_SEC : HUM_FADE_SEC) / 3);
      if (want <= 0 && g.value < 0.01) {
        try {
          loop.src.stop();
        } catch {
          // Already stopped.
        }
        loop.src.disconnect();
        loops.delete(name);
      }
    },
    get running() {
      return ctx?.state === 'running';
    },
    played,
    setEnabled(on) {
      enabled = on;
    },
    setVolume(v) {
      volume = Math.min(1, Math.max(0, v));
      if (sfxGain) sfxGain.gain.value = volume;
    },
    sync: apply,
    load,
    get loaded() {
      return clips.size;
    },
    playStep(file, semitones, volume) {
      const clip = clips.get(file);
      if (!stepVoice || !clip || !enabled || opts.paused() || !(volume > 0)) return false;
      stepVoice(clip.buf, clip.from, clip.to, semitones, volume);
      return true;
    },
    play(name, semitones = 0, delaySec = 0) {
      if (!fire(name, semitones, delaySec, 1)) return;
      played.push(name);
      if (played.length > 200) played.splice(0, played.length - 200);
    },
  };
}
