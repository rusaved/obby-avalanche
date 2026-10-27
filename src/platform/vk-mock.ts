// What: K-02 stand-in of VK Bridge for ?mock=vk (Pages, e2e) and the unit tests: init, Storage on localStorage, native ads with a short dim, join; every call logged in window.__VK_MOCK__.
// Called by: platform/index.ts (VK build, ?mock=vk in a plain tab only — never on a signed VK/OK launch); tests/platform/vk.test.ts.
// Keep: the same answers as the real bridge (result: true / an error object); ?mock_ads=none — no ad ready, ?mock_join=no — the player declines, ?mock_net=off — no answer at all.

import type { VkBridgeLike } from './vk.ts';

export interface VkMockCall {
  method: string;
  params?: Record<string, unknown>;
}

export interface VkMock extends VkBridgeLike {
  calls: VkMockCall[];
  /** Fire a bridge event (VKWebAppViewHide, VKWebAppViewRestore) as the site would. */
  emit(type: string): void;
}

export interface VkMockOptions {
  ads?: 'ok' | 'none';
  join?: 'yes' | 'no';
  net?: 'on' | 'off';
  /** How long the stand-in ad stays on screen (ms). */
  adMs?: number;
  storage?: Storage | null;
  /** Draw the ad dim over the page (browser); off in unit tests. */
  dom?: boolean;
}

const STORE_PREFIX = 'vkmock:';

export function createVkMock(o: VkMockOptions = {}): VkMock {
  const subs: Array<(e: { detail?: { type?: string; data?: unknown } }) => void> = [];
  const calls: VkMockCall[] = [];
  const mem = new Map<string, string>();
  // A third-party frame may have its storage blocked: reading `localStorage` then throws — keep the stand-in in memory.
  let store: Storage | null = o.storage ?? null;
  if (o.storage === undefined) {
    try {
      store = typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      store = null;
    }
  }
  const get = (k: string): string => {
    try {
      return store ? (store.getItem(STORE_PREFIX + k) ?? '') : (mem.get(k) ?? '');
    } catch {
      return '';
    }
  };
  const set = (k: string, v: string): void => {
    try {
      if (store) store.setItem(STORE_PREFIX + k, v);
      else mem.set(k, v);
    } catch {
      mem.set(k, v);
    }
  };
  const showAd = (): Promise<void> =>
    new Promise((resolve) => {
      const ms = o.adMs ?? 1500;
      if (!o.dom || typeof document === 'undefined') {
        setTimeout(resolve, Math.min(ms, 50));
        return;
      }
      const dim = document.createElement('div');
      dim.dataset['vkMockAd'] = '1';
      dim.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(10,20,40,.88);color:#fff;display:flex;align-items:center;justify-content:center;font:700 28px sans-serif';
      dim.textContent = '▶';
      document.body.appendChild(dim);
      setTimeout(() => {
        dim.remove();
        resolve();
      }, ms);
    });
  const fail = (code: number): Promise<never> => Promise.reject({ error_type: 'client_error', error_data: { error_code: code } });
  const mock: VkMock = {
    calls,
    emit(type) {
      for (const cb of subs) cb({ detail: { type, data: {} } });
    },
    subscribe(cb) {
      subs.push(cb);
    },
    async send(method, params) {
      calls.push(params ? { method, params } : { method });
      if (o.net === 'off') return new Promise<never>(() => undefined);
      switch (method) {
        case 'VKWebAppInit':
          return { result: true };
        case 'VKWebAppStorageGet': {
          const keys = (params?.['keys'] as string[] | undefined) ?? [];
          return { keys: keys.map((key) => ({ key, value: get(key) })) };
        }
        case 'VKWebAppStorageSet': {
          const value = String(params?.['value'] ?? '');
          if (value.length > 4096) return fail(11);
          set(String(params?.['key'] ?? ''), value);
          return { result: true };
        }
        case 'VKWebAppCheckNativeAds':
          return { result: o.ads !== 'none' };
        case 'VKWebAppShowNativeAds':
          if (o.ads === 'none') return fail(20);
          await showAd();
          return { result: true };
        case 'VKWebAppJoinGroup':
          return o.join === 'no' ? fail(4) : { result: true };
        default:
          return fail(6);
      }
    },
  };
  return mock;
}
