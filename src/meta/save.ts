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
  /** Play seconds without pauses over all sessions (docs/01-gdd.md 6.1: the «3 and 5 minutes» rules survive F5). */
  totalPlaySec?: number;
  /** How many times each hint plaque showed (docs/01-gdd.md 6.5). */
  hints?: Record<string, number>;
  /** Pets of the player by id, duplicates allowed, up to balance.pets.inventory (docs/01-gdd.md 7.2). */
  pets?: string[];
  /** Indices in `pets` of the pets on (up to balance.pets.slots); absent — the best ones are on (saves before M3-03). */
  petsOn?: number[];
  /** Shoe level: index in balance.upgrade.tiers, 0 = the starting pair; back to 0 on a rebirth (docs/01-gdd.md 7.1). */
  shoes?: number;
  /** Trophies to spend (trails, auras) and trophies earned over all time — the leaderboard score (docs/01-gdd.md 7.9). */
  trophies?: number;
  trophiesTotal?: number;
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
