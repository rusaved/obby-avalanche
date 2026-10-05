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
  /** Trails and auras owned (for trophies, forever) and the one of each on (docs/01-gdd.md 7.3; src/meta/cosmetics.ts). */
  trails?: string[];
  trail?: string;
  auras?: string[];
  aura?: string;
  /** Skin on (skins.json id); absent or unknown — skins.json default (docs/01-gdd.md 7.4). */
  skin?: string;
  /** Skins and wings owned beyond the default ones, and the wings on (M3-04b; looks only, a rebirth keeps them). */
  skins?: string[];
  wings?: string[];
  wing?: string;
  /** Rebirth tier n (docs/01-gdd.md 7.5): the step × stepMult^n for ever; summits done on this tier («Mountain {a}/5», M3-06). */
  tier?: number;
  summits?: number;
  /** Progress of the climb (docs/01-gdd.md 7.10, M3-07): the stat and the best one, coins, the mountain, the farthest wall
   * passed on it (`frontierWall`, its number; 0 — none). After F5 the hero stands at the flag behind that wall (6.6). */
  stat?: number;
  bestStat?: number;
  coins?: number;
  world?: number;
  frontierWall?: number;
  /** Calendar (docs/01-gdd.md 7.6, M3-08): rewards claimed in all, server time of the last claim, start of the game day. */
  daily?: { n: number; last: number; dayStart: number };
  /** Seconds of play left of the ×2 step boost (stands on pause, survives F5 and the day change). */
  boostSec?: number;
  /** Ad views counted toward the egg of the current mountain (docs/01-gdd.md 9.1: ads.eggViews). */
  adEgg?: number;
  /** Quests of the day (7.7, M3-08b): the game day they belong to, the list with progress, claimed, the bonus claimed. */
  quests?: { day: number; list: Array<{ id: string; n: number; k: number; got: boolean }>; bonus: boolean };
  /** Time rewards of the day (7.8): the game day, seconds played on it, minutes claimed. */
  timeRw?: { day: number; sec: number; got: number[] };
  /** Lucky wheel (7.13): the game day of the last free spin. */
  wheel?: { day: number };
}

export const SAVE_VERSION = 2;

export const DEFAULT_SETTINGS: SaveSettings = { sound: true, music: true, autoRun: false, cameraSens: 1, quality: 'auto' };

export function createSave(now: number): SaveData {
  return {
    v: SAVE_VERSION,
    rev: 0,
    savedAt: now,
    sessions: 0,
    settings: { ...DEFAULT_SETTINGS },
  };
}

/**
 * Migrations vN → vN+1 (docs/02-tech.md 4.4), each with its unit test. v1 (M0–M3-06) had no climb progress: the stat,
 * coins, mountain and frontier start from zero, as the game did after F5 then.
 */
export const MIGRATIONS: Record<number, (s: Record<string, unknown>) => Record<string, unknown>> = {
  1: (s) => ({ ...s, v: 2, stat: 0, bestStat: 0, coins: 0, world: 1, frontierWall: 0 }),
};

/** Brings a save of any older version up to SAVE_VERSION; null when a step is missing. */
export function migrate(raw: Record<string, unknown>): Record<string, unknown> | null {
  let s = raw;
  while ((s['v'] as number) < SAVE_VERSION) {
    const step = MIGRATIONS[s['v'] as number];
    if (!step) return null;
    s = step(s);
  }
  return s;
}

const NUMBER_KEYS = ['sessions', 'wavesNormal', 'totalPlaySec', 'shoes', 'trophies', 'trophiesTotal', 'tier', 'summits', 'stat', 'bestStat', 'coins', 'world', 'frontierWall', 'boostSec', 'adEgg'] as const;
const ARRAY_KEYS = ['pets', 'petsOn', 'trails', 'auras', 'skins', 'wings'] as const;
const OBJECT_KEYS = ['flags', 'hints', 'daily', 'quests', 'timeRw', 'wheel'] as const;
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/**
 * Accepts anything that came back from storage and returns a SaveData or null (docs/03 SAV-05: broken → clean start,
 * never an exception). Old versions are migrated; a field of the wrong type is dropped (its default applies), so one
 * bad value does not cost the player the rest of the save.
 */
export function parseSave(raw: unknown): SaveData | null {
  if (!isObj(raw)) return null;
  if (typeof raw['v'] !== 'number' || !Number.isInteger(raw['v']) || raw['v'] < 1) return null;
  if (typeof raw['rev'] !== 'number' || !Number.isFinite(raw['rev'])) return null;
  const o = migrate(raw);
  if (!o) return null;
  if (typeof o['savedAt'] !== 'number' || !Number.isFinite(o['savedAt'])) o['savedAt'] = 0;
  for (const k of NUMBER_KEYS) if (k in o && (typeof o[k] !== 'number' || !Number.isFinite(o[k] as number) || (o[k] as number) < 0)) delete o[k];
  for (const k of ARRAY_KEYS) if (k in o && !Array.isArray(o[k])) delete o[k];
  for (const k of OBJECT_KEYS) if (k in o && !isObj(o[k])) delete o[k];
  if (typeof o['sessions'] !== 'number') o['sessions'] = 0;
  const st = isObj(o['settings']) ? o['settings'] : {};
  const settings = { ...DEFAULT_SETTINGS };
  for (const [k, def] of Object.entries(DEFAULT_SETTINGS) as Array<[keyof SaveSettings, unknown]>) {
    if (typeof st[k] === typeof def) (settings as Record<string, unknown>)[k] = st[k];
  }
  o['settings'] = settings;
  return o as unknown as SaveData;
}

/** Cloud or mirror (docs/02-tech.md 11.6): the bigger `rev` wins, on a tie the later `savedAt`. */
export function newerSave(a: SaveData | null, b: SaveData | null): SaveData | null {
  if (!a || !b) return a ?? b;
  if (a.rev !== b.rev) return a.rev > b.rev ? a : b;
  return a.savedAt >= b.savedAt ? a : b;
}
