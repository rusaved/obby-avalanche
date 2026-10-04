/**
 * SaveData (docs/02-tech.md 4.4): everything that survives a reload. Plain JSON, `v` is the schema
 * version, `rev` the write counter, `savedAt` the platform server time. Grows at M3 (meta).
 */
export interface SaveSettings {
  sound: boolean;
  music: boolean;
  autoRun: boolean;
  cameraSens: number;
  quality: 'auto' | 'low' | 'medium' | 'high';
}

export interface SaveData {
  v: number;
  rev: number;
  savedAt: number;
  sessions: number;
  settings: SaveSettings;
  /** «Already sent» flags of player-once funnel events and one-time moments (docs/06 section 2: kind `player`). */
  flags?: Record<string, boolean>;
  /** Normal avalanches the player has had (newbie warning bonus, docs/01-gdd.md 4.1). */
  wavesNormal?: number;
}

export const SAVE_VERSION = 1;

export function createSave(now: number): SaveData {
  return {
    v: SAVE_VERSION,
    rev: 0,
    savedAt: now,
    sessions: 0,
    settings: { sound: true, music: true, autoRun: false, cameraSens: 1, quality: 'auto' },
  };
}

/** Accepts anything that came back from storage and returns a SaveData or null (broken → clean start). */
export function parseSave(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<SaveData>;
  if (typeof o.v !== 'number' || typeof o.rev !== 'number') return null;
  return o as SaveData;
}
