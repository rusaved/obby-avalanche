import type { SaveData } from '../meta/save.ts';
import { parseSave } from '../meta/save.ts';
import { createStorage, type KeyValueStore } from './storage.ts';
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
  private pending: SaveData | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

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
    return parseSave(this.store.getJSON('save'));
  }

  markDirty(data: SaveData, opts?: { flush?: boolean }): void {
    this.pending = data;
    if (opts?.flush) {
      void this.flushNow();
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => void this.flushNow(), 500);
  }

  async flushNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.pending) return;
    this.store.setJSON('save', this.pending);
    this.pending = null;
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
