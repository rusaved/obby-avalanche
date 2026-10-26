// What: The background music (G-09): the loop files of assets/audio/music by name and the level the music gain heads to — off, paused (an ad, a hidden tab, a blur), ducked under an avalanche.
// Called by: audio/index.ts (the player on the common AudioContext); tests/audio/music.test.ts.
// Keep: Pure TS, no DOM and no AudioContext; no file in the folder — no tracks, the game is silent as before; the duck factor comes from the caller (tuning).

/** The music loops of the build: assets/audio/music/*.mp3|ogg by file name, sorted (the first one plays). */
export const MUSIC_TRACKS: readonly string[] = Object.entries(
  import.meta.glob('../../assets/audio/music/*.{mp3,ogg}', { query: '?url', import: 'default', eager: true }) as Record<string, string>,
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, url]) => url);

export interface MusicState {
  /** The «Music» switch of the pause. */
  on: boolean;
  /** Its own volume, 0–1. */
  volume: number;
  /** Any pause that silences the sounds: an ad, a hidden tab, a lost focus (a window alone keeps them). */
  paused: boolean;
  /** An avalanche warns or runs: the music steps aside for its rumble. */
  duck: boolean;
  /** The share of the volume left while ducked (0–1). */
  duckK: number;
}

/** The level of the music gain now: silence when off or paused, the duck share under an avalanche. */
export function musicLevel(s: MusicState): number {
  if (!s.on || s.paused) return 0;
  const v = Math.max(0, Math.min(1, s.volume));
  return s.duck ? v * Math.max(0, Math.min(1, s.duckK)) : v;
}
