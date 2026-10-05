import type { SaveData } from '../meta/save.ts';
import { parseSave } from '../meta/save.ts';
import { createStorage, type KeyValueStore } from './storage.ts';
import { mirrorKey } from './pace-save.ts';
import { mapLang, type DeviceType, type Lang, type LeaderEntry, type Platform, type PlatformOptions } from './types.ts';

/**
 * NullPlatform (docs/02-tech.md 11.1): no SDK at all (page opened outside Yandex) or init failed twice.
 * Local save, no ads (their buttons stay hidden), language from the browser, never throws.
 */
export class NullPlatform implements Platform {
  readonly kind = 'null' as const;
  lang: Lang = 'en';
  device: DeviceType = 'desktop';
  private readonly store: KeyValueStore;
  private readyDone = false;
  private gameplay = false;

  constructor(private readonly opts: PlatformOptions) {
    this.store = createStorage(opts.packId);
  }

  async init(): Promise<void> {
    this.lang = mapLang(typeof navigator !== 'undefined' ? navigator.language : 'en');
    this.device = detectDevice();
  }

  ready(): void {
    if (this.readyDone) return;
    this.readyDone = true;
  }

  gameplayStart(): void {
    this.gameplay = true;
  }

  gameplayStop(): void {
    this.gameplay = false;
  }

  onPause(): void {
    /* no platform pause events outside Yandex */
  }

  onResume(): void {
    /* no platform resume events outside Yandex */
  }

  async showInterstitial(): Promise<{ shown: boolean }> {
    return { shown: false };
  }

  async showRewarded(): Promise<{ rewarded: boolean; error?: string }> {
    return { rewarded: false, error: 'unavailable' };
  }

  async loadSave(): Promise<SaveData | null> {
    return parseSave(this.store.getJSON(mirrorKey(this.opts.saveSlot)));
  }

  markDirty(data: SaveData): void {
    // No cloud outside Yandex: the mirror is the save, written at once (docs/02-tech.md 11.6).
    this.store.setJSON(mirrorKey(this.opts.saveSlot), data);
  }

  async flushNow(): Promise<void> {
    /* written in markDirty */
  }

  async submitScore(): Promise<void> {
    /* no leaderboard outside Yandex */
  }

  async topScores(): Promise<LeaderEntry[] | null> {
    return null;
  }

  async maybeRequestReview(): Promise<void> {
    /* no review outside Yandex */
  }

  serverTime(): number {
    return Date.now();
  }

  async getFlags(defaults: Record<string, string>): Promise<Record<string, string>> {
    return { ...defaults };
  }

  /** For tests: is GameplayAPI considered running. */
  get gameplayRunning(): boolean {
    return this.gameplay;
  }
}

export function detectDevice(): DeviceType {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return 'mobile';
  return 'desktop';
}
