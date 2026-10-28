import { afterEach, describe, expect, it, vi } from 'vitest';
import { VkPlatform, deviceOf, launchedByPlatform, siteOf, type VkRules } from '../../src/platform/vk.ts';
import { createVkMock } from '../../src/platform/vk-mock.ts';
import { VALUE_MAX, cloudKey, packSave, unpackSave } from '../../src/platform/vk-save.ts';
import { createSave } from '../../src/meta/save.ts';
import { vkConfig, vkText } from '../../src/content/vk.ts';

/** K-02…K-08 («Лавина 21»): the VK adapter on the bridge stand-in, no browser. */
const rules: VkRules = { timeoutSec: 6, rewardedRecheckSec: 30, gapSec: 45, hideGapSec: 5, chunkChars: 4000, writesPerHour: 600, groupId: 0 };

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

function make(o: { search?: string; ads?: 'ok' | 'none'; join?: 'yes' | 'no'; net?: 'on' | 'off'; groupId?: number; now?: () => number } = {}) {
  const bridge = createVkMock({ storage: memStorage(), ads: o.ads ?? 'ok', join: o.join ?? 'yes', net: o.net ?? 'on' });
  const platform = new VkPlatform(
    { packId: 'avalanche', leaderboardName: '', track: () => {} },
    { bridge, search: o.search ?? '', rules: { ...rules, groupId: o.groupId ?? 0 }, backend: memStorage(), device: 'desktop', ...(o.now ? { now: o.now } : {}) },
  );
  return { bridge, platform };
}

const methods = (b: { calls: Array<{ method: string }> }) => b.calls.map((c) => c.method);

afterEach(() => {
  vi.useRealTimers();
});

describe('K-02 VK adapter: init and the site', () => {
  it('VKWebAppInit is the first call, sent when the platform is made', async () => {
    const { bridge, platform } = make();
    expect(methods(bridge)).toEqual(['VKWebAppInit']);
    await platform.init();
    expect(platform.bridgeOk).toBe(true);
    expect(platform.kind).toBe('vk');
    expect(platform.lang).toBe('ru');
  });

  it('OK by vk_client=ok or vk_platform=*_ok, otherwise VK', () => {
    expect(siteOf('?vk_client=ok')).toBe('ok');
    expect(siteOf('?vk_platform=mobile_android_ok')).toBe('ok');
    expect(siteOf('?vk_platform=desktop_web')).toBe('vk');
    expect(siteOf('')).toBe('vk');
    expect(make({ search: '?vk_platform=web_ok' }).platform.site).toBe('ok');
    expect(deviceOf('?vk_platform=mobile_iphone', 'desktop')).toBe('mobile');
    expect(deviceOf('?vk_platform=desktop_web', 'mobile')).toBe('desktop');
    expect(launchedByPlatform('?vk_app_id=1&sign=abc')).toBe(true);
    expect(launchedByPlatform('?mock=vk')).toBe(false);
  });

  it('off in this build: leaderboard, sign-in, purchases, review, shortcut', async () => {
    const { platform } = make();
    expect(await platform.topScores()).toBeNull();
    expect(await platform.signIn()).toBe(false);
    expect(await platform.catalog()).toBeNull();
    expect(await platform.purchase()).toBe(false);
    expect(await platform.reviewCan()).toBe(false);
    expect(await platform.shortcutCanShow()).toBe(false);
  });

  it('K-07: no network — init gives up after the time limit, the game runs from the cache', async () => {
    vi.useFakeTimers();
    const { platform } = make({ net: 'off' });
    const init = platform.init();
    await vi.advanceTimersByTimeAsync(rules.timeoutSec * 1000 + 10);
    await init;
    expect(platform.bridgeOk).toBe(false);
    const save = createSave(1);
    platform.markDirty(save);
    expect(await platform.loadSave()).toMatchObject({ v: save.v });
    expect((await platform.showRewarded()).rewarded).toBe(false);
  });
});

describe('K-05 VK ads', () => {
  it('rewarded is checked ahead with use_waterfall: false; ready only on result: true; the reward once per press', async () => {
    const { bridge, platform } = make();
    await platform.init();
    await vi.waitFor(() => expect(platform.rewardedReady()).toBe(true));
    const check = bridge.calls.find((c) => c.method === 'VKWebAppCheckNativeAds');
    expect(check?.params).toEqual({ ad_format: 'reward', use_waterfall: false });
    const r = await platform.showRewarded();
    expect(r.rewarded).toBe(true);
    const show = bridge.calls.find((c) => c.method === 'VKWebAppShowNativeAds');
    expect(show?.params).toEqual({ ad_format: 'reward', use_waterfall: false });
    // Checked again after the show; a second press before the next one is loaded gets nothing.
    expect(methods(bridge).filter((m) => m === 'VKWebAppCheckNativeAds').length).toBeGreaterThanOrEqual(2);
  });

  it('no ad loaded — no button (rewardedReady false) and no reward', async () => {
    const { platform } = make({ ads: 'none' });
    await platform.init();
    await new Promise((r) => setTimeout(r, 5));
    expect(platform.rewardedReady()).toBe(false);
    expect(await platform.showRewarded()).toEqual({ rewarded: false, error: 'unavailable' });
    expect((await platform.showInterstitial()).shown).toBe(false);
  });

  it('interstitial: checked, then shown, use_waterfall: false', async () => {
    const { bridge, platform } = make();
    await platform.init();
    expect((await platform.showInterstitial()).shown).toBe(true);
    const shows = bridge.calls.filter((c) => c.method === 'VKWebAppShowNativeAds');
    expect(shows.at(-1)?.params).toEqual({ ad_format: 'interstitial', use_waterfall: false });
  });

  it('the VK build shows interstitials only on a transition, at most once in 30 s (content/vk.json)', () => {
    expect(vkConfig.ads.interstitial).not.toContain('menu');
    expect(vkConfig.ads.interstitial).toContain('portal');
    expect(vkConfig.ads.interstitialCooldownSec).toBeGreaterThanOrEqual(30);
    expect(vkConfig.ads.interstitialMinSec).toBeGreaterThanOrEqual(60);
  });
});

describe('K-06 VK Storage', () => {
  it('packed into parts of at most 4 096 characters and back; a broken part is not a save', () => {
    const big = JSON.stringify({ v: 2, rev: 1, savedAt: 0, junk: Array.from({ length: 4000 }, (_, i) => `${i}-${(i * 7919) % 104729}`) });
    const { head, parts } = packSave(big, 4000);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(VALUE_MAX);
    expect(unpackSave(head, parts)).toBe(big);
    expect(unpackSave(head, parts.slice(0, -1))).toBeNull();
    expect(unpackSave(head, [...parts.slice(0, -1), `${parts.at(-1)}x`])).toBeNull();
    expect(cloudKey()).toBe('s');
    expect(cloudKey('open.x')).toMatch(/^[A-Za-z0-9_]+$/);
  });

  it('written at most once per gapSec; at once on VKWebAppViewHide; the newest of cloud and cache loads', async () => {
    vi.useFakeTimers();
    let now = 1_000_000;
    const { bridge, platform } = make({ now: () => now });
    await platform.init();
    const save = createSave(now);
    save.rev = 1;
    platform.markDirty(save);
    await vi.advanceTimersByTimeAsync(2100);
    expect(platform.writes).toBeGreaterThan(0);
    const after1 = platform.writes;
    // Ten saves in 10 s: nothing more goes out before gapSec.
    for (let i = 0; i < 10; i++) {
      now += 1000;
      save.rev += 1;
      platform.markDirty({ ...save });
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(platform.writes).toBe(after1);
    // Hidden: written at once (after hideGapSec since the last one).
    bridge.emit('VKWebAppViewHide');
    await vi.advanceTimersByTimeAsync(10);
    expect(platform.writes).toBeGreaterThan(after1);
    // A fresh platform on the same bridge storage and an empty cache reads the cloud save back.
    const other = new VkPlatform(
      { packId: 'avalanche', leaderboardName: '', track: () => {} },
      { bridge, search: '', rules, backend: memStorage(), device: 'desktop', now: () => now },
    );
    await other.init();
    const back = await other.loadSave();
    expect(back?.rev).toBe(save.rev);
  });
});

describe('R-05 unsaved on hide', () => {
  it('a hide 1 s after a write with something unsaved writes it at once, not after hideGapSec', async () => {
    vi.useFakeTimers();
    let now = 1_000_000;
    const { bridge, platform } = make({ now: () => now });
    await platform.init();
    const save = createSave(now);
    save.rev = 1;
    platform.markDirty(save, { flush: true });
    await vi.advanceTimersByTimeAsync(10);
    const after1 = platform.writes;
    expect(after1).toBeGreaterThan(0);
    now += 1000;
    platform.markDirty({ ...save, rev: 2 });
    bridge.emit('VKWebAppViewHide');
    await vi.advanceTimersByTimeAsync(10);
    expect(platform.writes).toBeGreaterThan(after1);
    // Nothing unsaved: a second hide writes nothing.
    const after2 = platform.writes;
    bridge.emit('VKWebAppViewHide');
    await vi.advanceTimersByTimeAsync(10);
    expect(platform.writes).toBe(after2);
    vi.useRealTimers();
  });
});

describe('K-07 hide and restore', () => {
  it('VKWebAppViewHide pauses the game, VKWebAppViewRestore resumes it', async () => {
    const { bridge, platform } = make();
    await platform.init();
    const log: string[] = [];
    platform.onPause(() => log.push('pause'));
    platform.onResume(() => log.push('resume'));
    bridge.emit('VKWebAppViewHide');
    bridge.emit('VKWebAppViewRestore');
    expect(log).toEqual(['pause', 'resume']);
  });

  it('never asks for the whole screen on a signed VK/OK launch', async () => {
    const { platform } = make({ search: '?vk_app_id=1&sign=x' });
    expect(await platform.requestFullscreen()).toBe(false);
  });
});

describe('K-08 joining the community', () => {
  it('no community id — no join at all', () => {
    expect(make().platform.joinGroup).toBeUndefined();
  });

  it('true only on result: true; a refusal is false', async () => {
    const yes = make({ groupId: 42 });
    await yes.platform.init();
    expect(await yes.platform.joinGroup?.()).toBe(true);
    expect(yes.bridge.calls.find((c) => c.method === 'VKWebAppJoinGroup')?.params).toEqual({ group_id: 42 });
    const no = make({ groupId: 42, join: 'no' });
    await no.platform.init();
    expect(await no.platform.joinGroup?.()).toBe(false);
  });
});

describe('K-03 texts of the VK build', () => {
  it('a text of one site never names the other; both sites have the same keys', () => {
    const ok = Object.values(vkConfig.texts.ok).join(' ') + Object.values(vkConfig.texts.common).join(' ');
    const vk = Object.values(vkConfig.texts.vk).join(' ') + Object.values(vkConfig.texts.common).join(' ');
    expect(ok).not.toMatch(/вконтакт|\bvk\b/i);
    expect(vk).not.toMatch(/одноклассник|\bok\b/i);
    expect(Object.keys(vkConfig.texts.ok).sort()).toEqual(Object.keys(vkConfig.texts.vk).sort());
    expect(vkText('ok', 'join.button')).not.toBe(vkText('vk', 'join.button'));
    expect(vkText('vk', 'boot.loading', { n: 40 })).toContain('40');
  });
});
