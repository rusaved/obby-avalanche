import type { SaveData } from '../meta/save.ts';

export type Lang = 'ru' | 'en';
export type DeviceType = 'desktop' | 'mobile' | 'tablet' | 'tv';

export interface LeaderEntry {
  rank: number;
  score: number;
  name: string;
  isPlayer: boolean;
}

/** Platform facade (docs/02-tech.md 11.1). YandexPlatform wraps ysdk; NullPlatform runs outside Yandex. */
export interface Platform {
  readonly kind: 'yandex' | 'null';
  init(): Promise<void>;
  readonly lang: Lang;
  readonly device: DeviceType;
  /** LoadingAPI.ready — strictly once; later calls are ignored. */
  ready(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  onPause(cb: () => void): void;
  onResume(cb: () => void): void;
  showInterstitial(placement: string): Promise<{ shown: boolean }>;
  showRewarded(placement: string): Promise<{ rewarded: boolean; error?: string }>;
  loadSave(): Promise<SaveData | null>;
  markDirty(data: SaveData, opts?: { flush?: boolean }): void;
  flushNow(): Promise<void>;
  submitScore(score: number): Promise<void>;
  topScores(n: number): Promise<LeaderEntry[] | null>;
  maybeRequestReview(trigger: string): Promise<void>;
  serverTime(): number;
  getFlags(defaults: Record<string, string>): Promise<Record<string, string>>;
}

export interface PlatformOptions {
  /** Pack id: prefix of every localStorage key (docs/02-tech.md 4.4). */
  packId: string;
  /** Leaderboard name in the Yandex console; empty → leaderboard calls are no-ops. */
  leaderboardName: string;
  track: (name: string, params?: Record<string, unknown>) => void;
}

/** ysdk.environment.i18n.lang → interface language (docs/02-tech.md 11.2, step 4). */
export function mapLang(code: string | undefined | null): Lang {
  const c = (code || '').toLowerCase().slice(0, 2);
  return c === 'ru' || c === 'be' || c === 'kk' || c === 'uk' || c === 'uz' ? 'ru' : 'en';
}
