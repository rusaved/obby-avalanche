import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlatform } from '../../src/platform/index.ts';
import { YandexPlatform, SDK_SLOW_INIT_MS } from '../../src/platform/yandex.ts';
import { mapLang } from '../../src/platform/types.ts';

/** Minimal fake ysdk for the boot order (docs/02-tech.md 11.2). */
function fakeSdk(opts: { lang?: string; device?: string } = {}) {
  const calls: string[] = [];
  const listeners: Record<string, Array<() => void>> = {};
  const player = {
    getData: vi.fn(async () => ({})),
    setData: vi.fn(async () => {}),
    isAuthorized: () => false,
    getName: () => '',
    getUniqueID: () => '',
    getMode: () => 'lite',
  };
  const sdk = {
    environment: { i18n: { lang: opts.lang ?? 'ru', tld: 'ru' }, app: { id: '0' }, browser: { lang: 'ru' }, payload: null },
    deviceInfo: { type: opts.device ?? 'desktop', isMobile: () => false, isDesktop: () => true, isTablet: () => false, isTV: () => false },
    features: {
      LoadingAPI: { ready: () => calls.push('ready') },
      GameplayAPI: { start: () => calls.push('start'), stop: () => calls.push('stop') },
    },
    on: (ev: string, cb: () => void) => {
      (listeners[ev] ??= []).push(cb);
      return () => {};
    },
    off: () => {},
    getPlayer: vi.fn(async () => player),
    serverTime: () => 1000,
    getFlags: vi.fn(async (p: { defaultFlags: Record<string, string> }) => ({ ...p.defaultFlags, remote: '1' })),
    adv: { showFullscreenAdv: () => {}, showRewardedVideo: () => {} },
    leaderboards: {},
    feedback: { canReview: async () => ({ value: false }), requestReview: async () => ({ feedbackSent: false }) },
  };
  return { sdk, calls, listeners, player, fire: (ev: string) => (listeners[ev] ?? []).forEach((cb) => cb()) };
}

const track = vi.fn();
const opts = { packId: 'avalanche', leaderboardName: '', track };

describe('YandexPlatform', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    track.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('maps languages: ru, be, kk, uk, uz → ru; everything else → en', () => {
    for (const l of ['ru', 'be', 'kk', 'uk', 'uz']) expect(mapLang(l)).toBe('ru');
    for (const l of ['en', 'de', 'tr', '', undefined]) expect(mapLang(l)).toBe('en');
  });

  it('init: lang and device from the SDK, getPlayer once, ready() strictly once, gameplay start/stop idempotent', async () => {
    const f = fakeSdk({ lang: 'uk', device: 'mobile' });
    const p = new YandexPlatform(opts, { yaGames: { init: async () => f.sdk as never } });
    await p.init();
    expect(p.lang).toBe('ru');
    expect(p.device).toBe('mobile');
    expect(f.sdk.getPlayer).toHaveBeenCalledTimes(1);
    p.ready();
    p.ready();
    p.gameplayStart();
    p.gameplayStart();
    p.gameplayStop();
    p.gameplayStop();
    p.gameplayStart();
    expect(f.calls).toEqual(['ready', 'start', 'stop', 'start']);
  });

  it('slow init: sdk_init_slow once after 8 s, init still waits as long as needed', async () => {
    const f = fakeSdk();
    let resolveInit: (v: never) => void = () => {};
    const p = new YandexPlatform(opts, {
      yaGames: {
        init: () =>
          new Promise<never>((r) => {
            resolveInit = r;
          }),
      },
    });
    const done = p.init();
    await vi.advanceTimersByTimeAsync(SDK_SLOW_INIT_MS + 10);
    expect(track).toHaveBeenCalledWith('sdk_init_slow');
    await vi.advanceTimersByTimeAsync(20000);
    expect(track.mock.calls.filter((c) => c[0] === 'sdk_init_slow')).toHaveLength(1);
    resolveInit(f.sdk as never);
    await done;
    expect(p.lang).toBe('ru');
  });

  it('init fails → one retry after 1 s; fails twice → NullPlatform', async () => {
    const f = fakeSdk();
    let attempts = 0;
    const p = new YandexPlatform(opts, {
      yaGames: {
        init: async () => {
          attempts++;
          if (attempts === 1) throw new Error('boom');
          return f.sdk as never;
        },
      },
    });
    const done = p.init();
    await vi.advanceTimersByTimeAsync(1100);
    await done;
    expect(attempts).toBe(2);

    const failing = createPlatform(opts, {
      yaGames: {
        init: async () => {
          throw new Error('down');
        },
      },
    });
    await vi.advanceTimersByTimeAsync(1100);
    const platform = await failing;
    expect(platform.kind).toBe('null');
  });

  it('game_api_pause / resume reach the callbacks', async () => {
    const f = fakeSdk();
    const p = new YandexPlatform(opts, { yaGames: { init: async () => f.sdk as never } });
    await p.init();
    const seq: string[] = [];
    p.onPause(() => seq.push('pause'));
    p.onResume(() => seq.push('resume'));
    f.fire('game_api_pause');
    f.fire('game_api_resume');
    expect(seq).toEqual(['pause', 'resume']);
  });

  it('getFlags merges defaults with remote values and falls back to defaults on error', async () => {
    const f = fakeSdk();
    const p = new YandexPlatform(opts, { yaGames: { init: async () => f.sdk as never } });
    await p.init();
    expect(await p.getFlags({ a: '1' })).toEqual({ a: '1', remote: '1' });
    f.sdk.getFlags.mockRejectedValueOnce(new Error('x'));
    expect(await p.getFlags({ a: '1' })).toEqual({ a: '1' });
  });
});
