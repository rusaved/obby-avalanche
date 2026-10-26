// What: The background music (G-09, Z-09): the files of assets/audio/music by role (mountain and base loops, the fanfare of a summit) and the level the music gain heads to — off, paused (an ad, a hidden tab, a blur), ducked under an avalanche or a fanfare.
// Called by: audio/index.ts (the player on the common AudioContext); tests/audio/music.test.ts.
// Keep: Pure TS, no DOM and no AudioContext; no file in the folder — no tracks, the game is silent as before; the duck factor comes from the caller (tuning).

const FILES = Object.entries(import.meta.glob('../../assets/audio/music/*.{mp3,ogg}', { query: '?url', import: 'default', eager: true }) as Record<string, string>).sort(([a], [b]) => a.localeCompare(b));

/** The music files of the build: assets/audio/music/*.mp3|ogg by file name, sorted. */
export const MUSIC_TRACKS: readonly string[] = FILES.map(([, url]) => url);

/** Z-09: the roles of the music — a loop on the slope, a loop in the camp of the base, a fanfare once a summit. */
export type MusicRole = 'mountain' | 'base' | 'fanfare';

/** The file of a role among `files` (path → url): `<role>.mp3|ogg`; a loop role without its own file takes the first
 * file that is no role's (a single loop of G-09 plays everywhere); the fanfare only its own. Null — silence. */
export function musicTrack(role: MusicRole, files: ReadonlyArray<readonly [string, string]> = FILES): string | null {
  const name = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.(mp3|ogg)$/, '');
  const own = files.find(([p]) => name(p) === role);
  if (own) return own[1];
  if (role === 'fanfare') return null;
  const roles = new Set<string>(['mountain', 'base', 'fanfare']);
  return files.find(([p]) => !roles.has(name(p)))?.[1] ?? null;
}

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
  /** Z-09: a fanfare plays over the loop, which steps aside to `fanfareK` of its level. */
  fanfare?: boolean;
  fanfareK?: number;
}

/** The level of the music gain now: silence when off or paused, the duck share under an avalanche. */
export function musicLevel(s: MusicState): number {
  if (!s.on || s.paused) return 0;
  const v = Math.max(0, Math.min(1, s.volume));
  const ducked = s.duck ? v * Math.max(0, Math.min(1, s.duckK)) : v;
  return s.fanfare ? ducked * Math.max(0, Math.min(1, s.fanfareK ?? 1)) : ducked;
}
