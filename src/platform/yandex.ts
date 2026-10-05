import type { Player, SDK } from 'ysdk';
import type { SaveData } from '../meta/save.ts';
import { newerSave, parseSave } from '../meta/save.ts';
import { log } from '../core/log.ts';
import { createStorage, type KeyValueStore } from './storage.ts';
import { SaveQueue } from './save-queue.ts';
import { mapLang, type DeviceType, type Lang, type LeaderEntry, type Platform, type PlatformOptions } from './types.ts';

/** How long YaGames.init() may take before the `sdk_init_slow` event (docs/02-tech.md 11.2); init itself is never cut. */
export const SDK_SLOW_INIT_MS = 8000;
/** Ad watchdog (docs/02-tech.md 11.4): no callback at all for this long → the game goes on. */
export const AD_WATCHDOG_MS = 10000;
/** Retry delay after a failed init (11.2). */
export const INIT_RETRY_MS = 1000;

export interface YandexDeps {
  /** Defaults to window.YaGames; tests inject a fake. */
  yaGames?: { init(): Promise<SDK> };
  now?: () => number;
}

/**
 * YandexPlatform (docs/02-tech.md 11): the one place where `ysdk` exists. The same code runs against
 * the real SDK and against dev/yasdk-mock/sdk.js.
 */
export class YandexPlatform implements Platform {
  readonly kind = 'yandex' as const;
  lang: Lang = 'ru';
  device: DeviceType = 'desktop';

  private sdk: SDK | null = null;
  private player: Player | null = null;
  private readonly store: KeyValueStore;
  private readyDone = false;
  private gameplay: boolean | null = null;
  private pauseCbs: Array<() => void> = [];
  private resumeCbs: Array<() => void> = [];
  /** Cloud writes (11.6): debounce, token bucket and retries on the platform clock. */
  readonly cloud = new SaveQueue<SaveData>({
    now: () => this.serverTime(),
    write: (data) => {
      if (!this.player) return Promise.resolve();
      return this.player.setData(data as unknown as Record<string, unknown>, true).catch((err: unknown) => {
        log.warn('setData failed, kept locally', err);
        throw err;
      });
    },
  });
  private reviewAsked = false;

  constructor(
    private readonly opts: PlatformOptions,
    private readonly deps: YandexDeps = {},
  ) {
    this.store = createStorage(opts.packId);
  }

  async init(): Promise<void> {
    const ya = this.deps.yaGames ?? (typeof YaGames !== 'undefined' ? YaGames : null);
    if (!ya) throw new Error('YaGames is not available');
    const slow = setTimeout(() => this.opts.track('sdk_init_slow'), SDK_SLOW_INIT_MS);
    try {
      this.sdk = await this.initWithRetry(ya);
    } finally {
      clearTimeout(slow);
    }
    const sdk = this.sdk;
    this.lang = mapLang(sdk.environment?.i18n?.lang);
    this.device = (sdk.deviceInfo?.type as DeviceType | undefined) ?? 'desktop';
    // Subscribed right away: the platform may show its own startup ad without callbacks (11.2, step 3).
    sdk.on('game_api_pause', () => {
      for (const cb of this.pauseCbs) cb();
    });
    sdk.on('game_api_resume', () => {
      for (const cb of this.resumeCbs) cb();
    });
    // getPlayer once per launch, cached (limit 20 calls per 5 minutes). Unauthorized is fine.
    try {
      this.player = await sdk.getPlayer({ signed: false });
    } catch (err) {
      log.warn('getPlayer failed, saves go to localStorage only', err);
      this.player = null;
    }
  }

  private async initWithRetry(ya: { init(): Promise<SDK> }): Promise<SDK> {
    try {
      return await ya.init();
    } catch (first) {
      log.warn('YaGames.init failed, retrying once', first);
      await new Promise((r) => setTimeout(r, INIT_RETRY_MS));
      return await ya.init();
    }
  }

  ready(): void {
    if (this.readyDone) return;
    this.readyDone = true;
    try {
      this.sdk?.features?.LoadingAPI?.ready();
    } catch (err) {
      log.warn('LoadingAPI.ready failed', err);
    }
  }

  gameplayStart(): void {
    if (this.gameplay === true) return;
    this.gameplay = true;
    try {
      this.sdk?.features?.GameplayAPI?.start();
    } catch (err) {
      log.warn('GameplayAPI.start failed', err);
    }
  }

  gameplayStop(): void {
    if (this.gameplay === false || this.gameplay === null) {
      this.gameplay = false;
      return;
    }
    this.gameplay = false;
    try {
      this.sdk?.features?.GameplayAPI?.stop();
    } catch (err) {
      log.warn('GameplayAPI.stop failed', err);
    }
  }

  onPause(cb: () => void): void {
    this.pauseCbs.push(cb);
  }

  onResume(cb: () => void): void {
    this.resumeCbs.push(cb);
  }

  showInterstitial(placement: string): Promise<{ shown: boolean }> {
    const sdk = this.sdk;
    if (!sdk) return Promise.resolve({ shown: false });
    this.opts.track('ad_interstitial_request', { placement });
    return new Promise((resolve) => {
      let done = false;
      let opened = false;
      const finish = (shown: boolean): void => {
        if (done) return;
        done = true;
        clearTimeout(watchdog);
        resolve({ shown });
      };
      const watchdog = setTimeout(() => {
        if (!opened) finish(false);
      }, AD_WATCHDOG_MS);
      try {
        sdk.adv.showFullscreenAdv({
          callbacks: {
            onOpen: () => {
              opened = true;
            },
            onClose: (wasShown: boolean) => finish(!!wasShown),
            onError: () => finish(false),
            onOffline: () => finish(false),
          },
        });
      } catch {
        finish(false);
      }
    });
  }

  showRewarded(placement: string): Promise<{ rewarded: boolean; error?: string }> {
    const sdk = this.sdk;
    if (!sdk) return Promise.resolve({ rewarded: false, error: 'unavailable' });
    this.opts.track('ad_rewarded_request', { placement });
    return new Promise((resolve) => {
      let done = false;
      let opened = false;
      let rewarded = false;
      let error: string | undefined;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(watchdog);
        resolve(error ? { rewarded, error } : { rewarded });
      };
      const watchdog = setTimeout(() => {
        if (!opened) {
          error = 'timeout';
          finish();
        }
      }, AD_WATCHDOG_MS);
      try {
        sdk.adv.showRewardedVideo({
          callbacks: {
            onOpen: () => {
              opened = true;
            },
            onRewarded: () => {
              // Idempotent: a second onRewarded never grants twice (11.5).
              rewarded = true;
            },
            onClose: () => finish(),
            onError: (err: Error) => {
              error = err?.message || 'error';
              finish();
            },
          },
        });
      } catch (err) {
        error = err instanceof Error ? err.message : 'error';
        finish();
      }
    });
  }

  async loadSave(): Promise<SaveData | null> {
    let cloud: SaveData | null = null;
    if (this.player) {
      try {
        cloud = parseSave(await this.player.getData());
      } catch (err) {
        log.warn('getData failed', err);
      }
    }
    // Broken data in one source → the other one; both broken → a new player (11.6, SAV-05).
    return newerSave(cloud, parseSave(this.store.getJSON('save')));
  }

  markDirty(data: SaveData, opts?: { flush?: boolean }): void {
    // Every change goes to the mirror at once: F5 right after an action loses nothing (11.6, SAV-01).
    this.store.setJSON('save', data);
    if (this.player) this.cloud.push(data, opts?.flush ?? false);
  }

  async flushNow(): Promise<void> {
    await this.cloud.flush();
  }

  async submitScore(score: number): Promise<void> {
    const name = this.opts.leaderboardName;
    if (!name || !this.sdk) return;
    try {
      await this.sdk.leaderboards.setScore(name, Math.floor(score));
    } catch (err) {
      log.warn('setScore failed', err);
    }
  }

  async topScores(n: number): Promise<LeaderEntry[] | null> {
    const name = this.opts.leaderboardName;
    if (!name || !this.sdk) return null;
    try {
      const data = await this.sdk.leaderboards.getEntries(name, { quantityTop: n, includeUser: true, quantityAround: 0 });
      return data.entries.map((e) => ({
        rank: e.rank,
        score: e.score,
        name: e.player.publicName,
        isPlayer: this.player ? e.player.uniqueID === this.player.getUniqueID() : false,
      }));
    } catch (err) {
      log.warn('getEntries failed', err);
      return null;
    }
  }

  async maybeRequestReview(trigger: string): Promise<void> {
    if (this.reviewAsked || !this.sdk) return;
    this.reviewAsked = true;
    try {
      const can = await this.sdk.feedback.canReview();
      if (!can.value) return;
      this.opts.track('review_request', { trigger });
      await this.sdk.feedback.requestReview();
    } catch (err) {
      log.warn('review failed', err);
    }
  }

  serverTime(): number {
    try {
      const t = this.sdk?.serverTime();
      if (typeof t === 'number' && t > 0) return t;
    } catch {
      /* fall through */
    }
    return (this.deps.now ?? Date.now)();
  }

  async getFlags(defaults: Record<string, string>): Promise<Record<string, string>> {
    if (!this.sdk) return { ...defaults };
    try {
      const flags = await this.sdk.getFlags({ defaultFlags: defaults });
      return { ...defaults, ...flags };
    } catch (err) {
      log.warn('getFlags failed, defaults used', err);
      return { ...defaults };
    }
  }
}
