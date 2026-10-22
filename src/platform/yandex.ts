// What: YandexPlatform: the one place where ysdk exists - init with retry, ready/gameplay, ads with watchdog, cloud save, leaderboard, review, server time, flags.
// Called by: platform/index.ts; tests/platform/yandex.test.ts, tests/platform/pace-save.test.ts, tests/meta/save.test.ts (with a fake SDK / dev/yasdk-mock).
// Keep: Ads follow docs/03 section 2 (game resumes after any outcome, reward only in onRewarded); LoadingAPI.ready strictly once; no ysdk outside this file.

import type { Payments, Player, SDK } from 'ysdk';
import type { SaveData } from '../meta/save.ts';
import { newerSave, parseSave } from '../meta/save.ts';
import { log } from '../core/log.ts';
import { createStorage, type KeyValueStore } from './storage.ts';
import { SaveQueue } from './save-queue.ts';
import { joinCloud, mirrorKey, splitCloud } from './pace-save.ts';
import { mapLang, type DeviceType, type Lang, type CatalogItem, type LeaderEntry, type Platform, type PlatformOptions } from './types.ts';

/** How long YaGames.init() may take before the `sdk_init_slow` event (docs/02-tech.md 11.2); init itself is never cut. */
export const SDK_SLOW_INIT_MS = 8000;
/** Ad watchdog (docs/02-tech.md 11.4): no callback at all for this long → the game goes on. */
export /** M4-06 (docs/02-tech.md 11.7): setScore not oftener than this. */
const SCORE_GAP_MS = 5000;
const AD_WATCHDOG_MS = 10000;
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
  /** M4-02: the SDK holds the game paused (game_api_pause without its resume yet); the startup ad seen. */
  private sdkPaused = false;
  private startupAd: 'none' | 'open' | 'done' = 'none';
  /** M4-03 (GDD-05; docs/02-tech.md 11.5): every ad call has its own requestId — a late callback counts for its own only. */
  private adSeq = 0;
  /** M4-06: the last setScore sent (ms), the score waiting for its turn and its timer. */
  private scoreAt = -Infinity;
  private scoreNext: number | null = null;
  private scoreTimer: ReturnType<typeof setTimeout> | null = null;
  private pauseCbs: Array<() => void> = [];
  private resumeCbs: Array<() => void> = [];
  /** Cloud writes (11.6): debounce, token bucket and retries on the platform clock. */
  readonly cloud = new SaveQueue<Record<string, unknown>>({
    now: () => this.serverTime(),
    write: (data) => {
      if (!this.player) return Promise.resolve();
      return this.player.setData(data, true).catch((err: unknown) => {
        log.warn('setData failed, kept locally', err);
        throw err;
      });
    },
  });
  private reviewAsked = false;
  /** Cloud data of the other paces as loaded: every write carries it untouched (src/platform/pace-save.ts). A pace
   * slot writes to the cloud only after its getData came back, so a failed read never wipes the classic save there. */
  private cloudRest: Record<string, unknown> = {};
  private cloudRead = false;

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
    // M4-02 (docs/06 step 2): a pause before the first start of gameplay is the platform's startup ad.
    sdk.on('game_api_pause', () => {
      this.sdkPaused = true;
      if (this.gameplay === null && this.startupAd === 'none') {
        this.startupAd = 'open';
        this.opts.track('startup_ad_start');
      }
      for (const cb of this.pauseCbs) cb();
    });
    sdk.on('game_api_resume', () => {
      this.sdkPaused = false;
      if (this.startupAd === 'open') {
        this.startupAd = 'done';
        this.opts.track('startup_ad_end');
      }
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
    // M4-02: the startup ad may come before the game listens — it learns of the pause at once.
    if (this.sdkPaused) cb();
  }

  onResume(cb: () => void): void {
    this.resumeCbs.push(cb);
  }

  showInterstitial(placement: string): Promise<{ shown: boolean }> {
    const sdk = this.sdk;
    if (!sdk) return Promise.resolve({ shown: false });
    const requestId = `${placement}-${++this.adSeq}`;
    this.opts.track('ad_interstitial_request', { placement, requestId });
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

  showRewarded(placement: string, onLate?: () => void): Promise<{ rewarded: boolean; error?: string }> {
    const sdk = this.sdk;
    if (!sdk) return Promise.resolve({ rewarded: false, error: 'unavailable' });
    const requestId = `${placement}-${++this.adSeq}`;
    this.opts.track('ad_rewarded_request', { placement, requestId });
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
              // Idempotent: a second onRewarded never grants twice (11.5), before or after the watchdog.
              if (done) {
                // After the watchdog: still the reward, once for this requestId (11.5).
                if (rewarded) return;
                rewarded = true;
                this.opts.track('ad_late_callback', { placement, requestId });
                onLate?.();
                return;
              }
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
        const split = splitCloud(await this.player.getData(), this.opts.saveSlot);
        this.cloudRest = split.rest;
        this.cloudRead = true;
        cloud = parseSave(split.mine);
      } catch (err) {
        log.warn('getData failed', err);
      }
    }
    // Broken data in one source → the other one; both broken → a new player (11.6, SAV-05).
    return newerSave(cloud, parseSave(this.store.getJSON(mirrorKey(this.opts.saveSlot))));
  }

  markDirty(data: SaveData, opts?: { flush?: boolean }): void {
    // Every change goes to the mirror at once: F5 right after an action loses nothing (11.6, SAV-01).
    this.store.setJSON(mirrorKey(this.opts.saveSlot), data);
    if (this.player && (this.cloudRead || !this.opts.saveSlot)) this.cloud.push(joinCloud(this.cloudRest, data, this.opts.saveSlot), opts?.flush ?? false);
  }

  async flushNow(): Promise<void> {
    await this.cloud.flush();
  }

  get authorized(): boolean {
    try {
      return this.player?.getMode() === '';
    } catch {
      return false;
    }
  }

  async signIn(): Promise<boolean> {
    if (!this.sdk) return false;
    try {
      await this.sdk.auth.openAuthDialog();
      this.player = await this.sdk.getPlayer({ signed: false });
    } catch (err) {
      log.debug('auth dialog closed', err);
    }
    return this.authorized;
  }

  async submitScore(score: number): Promise<void> {
    const name = this.opts.leaderboardName;
    if (!name || !this.sdk || !this.authorized) return;
    // Not oftener than once in SCORE_GAP_MS (the Yandex limit is once a second): the latest score waits for its turn.
    this.scoreNext = Math.floor(score);
    if (this.scoreTimer) return;
    const wait = Math.max(0, this.scoreAt + SCORE_GAP_MS - Date.now());
    this.scoreTimer = setTimeout(() => void this.sendScore(name), wait);
  }

  private async sendScore(name: string): Promise<void> {
    this.scoreTimer = null;
    const score = this.scoreNext;
    if (score === null || !this.sdk) return;
    this.scoreNext = null;
    this.scoreAt = Date.now();
    try {
      if (!(await this.sdk.isAvailableMethod('leaderboards.setScore'))) return;
      await this.sdk.leaderboards.setScore(name, score);
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

  async reviewCan(): Promise<boolean> {
    if (!this.sdk || this.reviewAsked) return false;
    try {
      return (await this.sdk.feedback.canReview()).value === true;
    } catch (err) {
      log.warn('feedback.canReview failed', err);
      return false;
    }
  }

  async reviewAsk(): Promise<boolean> {
    if (!this.sdk || this.reviewAsked) return false;
    // One review dialog a session, whoever asks (03 SDK-07).
    this.reviewAsked = true;
    try {
      return (await this.sdk.feedback.requestReview()).feedbackSent === true;
    } catch (err) {
      log.warn('feedback.requestReview failed', err);
      return false;
    }
  }

  async shortcutCanShow(): Promise<boolean> {
    if (!this.sdk) return false;
    try {
      return (await this.sdk.shortcut.canShowPrompt()).canShow === true;
    } catch (err) {
      log.warn('shortcut.canShowPrompt failed', err);
      return false;
    }
  }

  async shortcutShow(): Promise<'accepted' | 'rejected'> {
    if (!this.sdk) return 'rejected';
    try {
      return (await this.sdk.shortcut.showPrompt()).outcome === 'accepted' ? 'accepted' : 'rejected';
    } catch (err) {
      log.warn('shortcut.showPrompt failed', err);
      return 'rejected';
    }
  }

  async requestFullscreen(): Promise<boolean> {
    const fs = this.sdk?.screen?.fullscreen;
    if (!fs) return false;
    if (fs.status === fs.STATUS_ON) return true;
    try {
      await fs.request();
      return true;
    } catch (err) {
      // MU round 4: every tap outside the whole screen asks again — a refusal is routine, not a warning.
      log.debug('screen.fullscreen.request refused', err);
      return false;
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

  private pay: Promise<Payments | null> | null = null;

  /** M4-07: ysdk.payments only with the flag on, got once. */
  private payments(): Promise<Payments | null> {
    if (!this.opts.payments || !this.sdk) return Promise.resolve(null);
    this.pay ??= this.sdk.getPayments({ signed: false }).catch((err: unknown) => {
      log.warn('getPayments failed', err);
      return null;
    });
    return this.pay;
  }

  async catalog(): Promise<CatalogItem[] | null> {
    const p = await this.payments();
    if (!p) return null;
    try {
      return (await p.getCatalog()).map((x) => ({ id: x.id, price: x.price, currencyImage: x.getPriceCurrencyImage('svg') }));
    } catch (err) {
      log.warn('getCatalog failed', err);
      return null;
    }
  }

  async purchase(id: string): Promise<boolean> {
    const p = await this.payments();
    if (!p) return false;
    try {
      await p.purchase({ id });
      return true;
    } catch (err) {
      log.debug('purchase closed', err);
      return false;
    }
  }

  async purchased(): Promise<string[]> {
    const p = await this.payments();
    if (!p) return [];
    try {
      return (await p.getPurchases()).map((x) => x.productID);
    } catch (err) {
      log.warn('getPurchases failed', err);
      return [];
    }
  }

  hideBanner(): void {
    void this.sdk?.adv.hideBannerAdv().catch(() => undefined);
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
