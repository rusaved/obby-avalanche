// What: VkPlatform (K-02…K-08, Lavina 21): VK Bridge for VK and OK — VKWebAppInit first, the site by the launch parameters, VK Storage saves (packed, in parts) with localStorage as the cache, native ads (rewarded checked ahead), hide/restore, joining the community.
// Called by: platform/index.ts (VK build only, __PLATFORM__ === 'vk') with the npm vk-bridge or the stand-in of ?mock=vk (platform/vk-mock.ts); tests/platform/vk.test.ts with a fake bridge.
// Keep: VKWebAppInit is the first call, sent in the constructor; every bridge call has a time limit (no endless loading offline); a reward only on result: true, once; use_waterfall: false; Storage writes at most once per save.gapSec (VK: 1 000 writes an hour).

import type { SaveData } from '../meta/save.ts';
import { newerSave, parseSave } from '../meta/save.ts';
import { createStorage, type KeyValueStore } from './storage.ts';
import { mirrorKey } from './pace-save.ts';
import { cloudKey, headParts, packSave, partKey, unpackSave } from './vk-save.ts';
import { detectDevice } from './null.ts';
import type { DeviceType, Lang, LeaderEntry, Platform, PlatformOptions, VkSite } from './types.ts';

/** The part of VK Bridge the game uses (the npm module and the stand-in both fit it). */
export interface VkBridgeLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  subscribe(cb: (e: { detail?: { type?: string; data?: unknown } }) => void): void;
}

/** content/vk.json numbers the platform needs. */
export interface VkRules {
  timeoutSec: number;
  rewardedRecheckSec: number;
  gapSec: number;
  hideGapSec: number;
  chunkChars: number;
  writesPerHour: number;
  /** The community (VK) or group (OK) id; 0 — not filled yet (no join). */
  groupId: number;
}

export interface VkDeps {
  bridge: VkBridgeLike;
  /** location.search of the launch (vk_platform, vk_client, sign…). */
  search: string;
  rules: VkRules;
  now?: () => number;
  /** localStorage stand-in for tests. */
  backend?: Storage | null;
  /** The browser's guess of the device when vk_platform says nothing. */
  device?: DeviceType;
}

/** OK when the launch says so (vk_client=ok or vk_platform=*_ok), else VK. */
export function siteOf(search: string): VkSite {
  const q = new URLSearchParams(search);
  return q.get('vk_client') === 'ok' || /_ok$/.test(q.get('vk_platform') ?? '') ? 'ok' : 'vk';
}

/** mobile_* — a phone (a tablet stays a tablet), desktop_web — a computer; otherwise the browser's guess. */
export function deviceOf(search: string, fallback: DeviceType): DeviceType {
  const p = new URLSearchParams(search).get('vk_platform') ?? '';
  if (/^desktop/.test(p)) return 'desktop';
  if (/^mobile/.test(p)) return fallback === 'tablet' ? 'tablet' : 'mobile';
  return fallback;
}

/** The launch came from VK or OK itself (signed parameters), not from a plain tab (the ?mock=vk check of the studio). */
export function launchedByPlatform(search: string): boolean {
  const q = new URLSearchParams(search);
  return q.has('vk_app_id') && q.has('sign');
}

const resultTrue = (r: unknown): boolean => !!r && typeof r === 'object' && (r as { result?: unknown }).result === true;

export class VkPlatform implements Platform {
  readonly kind = 'vk' as const;
  readonly site: VkSite;
  /** K-04: Russian only on VK and OK. */
  readonly lang: Lang = 'ru';
  readonly device: DeviceType;
  readonly authorized = false;
  /** Bridge up (VKWebAppInit answered); false — offline or outside VK: the game runs from the cache, no ads. */
  bridgeOk = false;
  private readonly initDone: Promise<boolean>;
  private readonly store: KeyValueStore;
  private readonly key: string;
  private readonly now: () => number;
  private readonly pauseCbs: Array<() => void> = [];
  private readonly resumeCbs: Array<() => void> = [];
  private rewardReady = false;
  private checking = false;
  private recheck: ReturnType<typeof setTimeout> | undefined;
  private latest: string | null = null;
  private lastWriteAt = -Infinity;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly written = new Map<string, string>();
  private writesHour: number[] = [];
  private writing: Promise<void> = Promise.resolve();
  /** For tests: the Storage writes really sent. */
  writes = 0;

  constructor(
    private readonly opts: PlatformOptions,
    private readonly deps: VkDeps,
  ) {
    this.now = deps.now ?? (() => Date.now());
    // K-02: VKWebAppInit first of all, before the game loads anything.
    this.initDone = this.call('VKWebAppInit').then(
      () => true,
      () => false,
    );
    this.site = siteOf(deps.search);
    this.device = deviceOf(deps.search, deps.device ?? detectDevice());
    this.store = createStorage(opts.packId, deps.backend);
    this.key = cloudKey(opts.saveSlot);
    deps.bridge.subscribe((e) => {
      const type = e.detail?.type;
      if (type === 'VKWebAppViewHide') {
        this.pauseCbs.forEach((cb) => cb());
        this.flushSoon();
      } else if (type === 'VKWebAppViewRestore') {
        this.resumeCbs.forEach((cb) => cb());
        this.checkReward();
      }
    });
    // K-06: the tab hidden (a phone locked, another app) — the save goes out at once, as on VKWebAppViewHide.
    if (typeof document !== 'undefined')
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.flushSoon();
      });
  }

  /** A bridge call that gives up after the time limit (offline, outside VK): rejects, never hangs. */
  private call(method: string, params?: Record<string, unknown>, ms = this.deps.rules.timeoutSec * 1000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${method}: timeout`)), ms);
      let p: Promise<unknown>;
      try {
        p = this.deps.bridge.send(method, params);
      } catch (e) {
        clearTimeout(t);
        reject(e as Error);
        return;
      }
      p.then(
        (r) => {
          clearTimeout(t);
          resolve(r);
        },
        (e: unknown) => {
          clearTimeout(t);
          reject(e as Error);
        },
      );
    });
  }

  async init(): Promise<void> {
    this.bridgeOk = await this.initDone;
    this.checkReward();
  }

  /** The VK build's options and the mirror key of the save (the cache). */
  private get mirror(): string {
    return mirrorKey(this.opts.saveSlot);
  }

  ready(): void {
    /* VK has no ready call: VKWebAppInit already said the app is up */
  }

  gameplayStart(): void {
    /* no gameplay signal on VK */
  }

  gameplayStop(): void {
    /* no gameplay signal on VK */
  }

  onPause(cb: () => void): void {
    this.pauseCbs.push(cb);
  }

  onResume(cb: () => void): void {
    this.resumeCbs.push(cb);
  }

  // K-05: the rewarded video is checked ahead; its buttons show only while one is loaded.
  rewardedReady(): boolean {
    return this.rewardReady;
  }

  private checkReward(): void {
    if (!this.bridgeOk || this.checking || this.rewardReady) return;
    this.checking = true;
    clearTimeout(this.recheck);
    this.call('VKWebAppCheckNativeAds', { ad_format: 'reward', use_waterfall: false })
      .then(
        (r) => void (this.rewardReady = resultTrue(r)),
        () => void (this.rewardReady = false),
      )
      .finally(() => {
        this.checking = false;
        if (!this.rewardReady) this.recheck = setTimeout(() => this.checkReward(), this.deps.rules.rewardedRecheckSec * 1000);
      });
  }

  async showInterstitial(): Promise<{ shown: boolean }> {
    if (!this.bridgeOk) return { shown: false };
    try {
      if (!resultTrue(await this.call('VKWebAppCheckNativeAds', { ad_format: 'interstitial', use_waterfall: false }))) return { shown: false };
      return { shown: resultTrue(await this.call('VKWebAppShowNativeAds', { ad_format: 'interstitial', use_waterfall: false }, 120_000)) };
    } catch {
      return { shown: false };
    }
  }

  async showRewarded(): Promise<{ rewarded: boolean; error?: string }> {
    if (!this.bridgeOk || !this.rewardReady) return { rewarded: false, error: 'unavailable' };
    this.rewardReady = false;
    let out: { rewarded: boolean; error?: string };
    try {
      // A video runs as long as it runs: the limit only catches a window that never comes back.
      out = { rewarded: resultTrue(await this.call('VKWebAppShowNativeAds', { ad_format: 'reward', use_waterfall: false }, 180_000)) };
    } catch {
      out = { rewarded: false, error: 'unavailable' };
    }
    this.checkReward();
    return out;
  }

  /** K-08: only once the studio filled the id of the community (VK) or group (OK). */
  get joinGroup(): (() => Promise<boolean>) | undefined {
    const id = this.deps.rules.groupId;
    if (!(id > 0)) return undefined;
    return async () => {
      if (!this.bridgeOk) return false;
      try {
        return resultTrue(await this.call('VKWebAppJoinGroup', { group_id: id }, 120_000));
      } catch {
        return false;
      }
    };
  }

  async loadSave(): Promise<SaveData | null> {
    const local = parseSave(this.store.getJSON(this.mirror));
    if (!(await this.initDone)) return local;
    let cloud: SaveData | null = null;
    try {
      const got = (r: unknown): Map<string, string> =>
        new Map(((r as { keys?: Array<{ key: string; value: string }> })?.keys ?? []).map((x) => [x.key, x.value]));
      const head = got(await this.call('VKWebAppStorageGet', { keys: [this.key] })).get(this.key) ?? '';
      const n = headParts(head);
      if (n) {
        const keys = Array.from({ length: n }, (_, i) => partKey(this.key, i));
        const parts = got(await this.call('VKWebAppStorageGet', { keys }));
        const list = keys.map((k) => parts.get(k) ?? null);
        const text = unpackSave(head, list);
        if (text !== null) {
          cloud = parseSave(JSON.parse(text));
          this.written.set(this.key, head);
          keys.forEach((k, i) => this.written.set(k, list[i]!));
        }
      }
    } catch {
      cloud = null;
    }
    return newerSave(cloud, local);
  }

  // K-06: localStorage at once (the cache); VK Storage — the latest text waits, at most once per gapSec.
  markDirty(data: SaveData, opts?: { flush?: boolean }): void {
    this.store.setJSON(this.mirror, data);
    this.latest = JSON.stringify(data);
    this.schedule(!!opts?.flush);
  }

  async flushNow(): Promise<void> {
    this.flushSoon();
    await this.writing;
  }

  /** On hide: write now, but not oftener than hideGapSec. R-05 («Лавина 23»): with something unsaved — at once whatever
   * the gap (a hidden app may never run the timer); writesPerHour still holds in put(). */
  private flushSoon(): void {
    if (this.latest !== null) this.writeNow();
  }

  private schedule(flush: boolean): void {
    const now = this.now();
    const r = this.deps.rules;
    const due = Math.max(flush ? now : now + 2000, this.lastWriteAt + (flush ? r.hideGapSec : r.gapSec) * 1000);
    clearTimeout(this.timer);
    if (due <= now) this.writeNow();
    else this.timer = setTimeout(() => this.writeNow(), due - now);
  }

  private async put(key: string, value: string): Promise<boolean> {
    if (this.written.get(key) === value) return true;
    const now = this.now();
    this.writesHour = this.writesHour.filter((t) => now - t < 3_600_000);
    if (this.writesHour.length >= this.deps.rules.writesPerHour) return false;
    this.writesHour.push(now);
    try {
      await this.call('VKWebAppStorageSet', { key, value });
      this.written.set(key, value);
      this.writes += 1;
      return true;
    } catch {
      return false;
    }
  }

  private writeNow(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.latest === null || !this.bridgeOk) return;
    const text = this.latest;
    this.latest = null;
    this.lastWriteAt = this.now();
    const { head, parts } = packSave(text, this.deps.rules.chunkChars);
    this.writing = this.writing.then(async () => {
      let ok = true;
      for (let i = 0; i < parts.length && ok; i++) ok = await this.put(partKey(this.key, i), parts[i]!);
      // The head last: a half-written set of parts is never read (its checksum would not match anyway).
      if (ok) ok = await this.put(this.key, head);
      if (!ok && this.latest === null) this.latest = text;
    });
  }

  async submitScore(): Promise<void> {
    /* K-02: no leaderboard on VK in this build */
  }

  async signIn(): Promise<boolean> {
    return false;
  }

  async topScores(): Promise<LeaderEntry[] | null> {
    return null;
  }

  async maybeRequestReview(): Promise<void> {
    /* K-04: no review window on VK and OK */
  }

  async shortcutCanShow(): Promise<boolean> {
    return false;
  }

  async shortcutShow(): Promise<'accepted' | 'rejected'> {
    return 'rejected';
  }

  async reviewCan(): Promise<boolean> {
    return false;
  }

  async reviewAsk(): Promise<boolean> {
    return false;
  }

  /** K-07: on live VK and OK the site owns the screen — never ask; on ?mock=vk (a plain tab) — the Fullscreen API as on Pages. */
  async requestFullscreen(): Promise<boolean> {
    if (launchedByPlatform(this.deps.search) || typeof document === 'undefined') return false;
    if (document.fullscreenElement) return true;
    const el = document.documentElement;
    if (typeof el.requestFullscreen !== 'function') return false;
    try {
      await el.requestFullscreen({ navigationUI: 'hide' });
      return true;
    } catch {
      return false;
    }
  }

  serverTime(): number {
    return this.now();
  }

  async catalog(): Promise<null> {
    return null;
  }

  async purchase(): Promise<boolean> {
    return false;
  }

  async purchased(): Promise<string[]> {
    return [];
  }

  hideBanner(): void {}

  async getFlags(defaults: Record<string, string>): Promise<Record<string, string>> {
    return { ...defaults };
  }
}
