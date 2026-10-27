// What: Platform factory: VkPlatform in the VK build (K-02), YandexPlatform when YaGames exists (init waits), NullPlatform when there is no SDK or init failed twice; re-exports the facade types.
// Called by: main.ts; tests/platform/yandex.test.ts.
// Keep: The game must always start (fall back to NullPlatform, never throw); only src/platform touches ysdk; keep the docs/02-tech.md 11.2 init order.

import { NullPlatform } from './null.ts';
import { YandexPlatform, type YandexDeps } from './yandex.ts';
import type { Platform, PlatformOptions } from './types.ts';
import { log } from '../core/log.ts';
import { VkPlatform, launchedByPlatform, siteOf, type VkBridgeLike } from './vk.ts';
import { vkConfig, vkGroupId } from '../content/vk.ts';

export type { Platform, PlatformOptions, Lang, DeviceType, LeaderEntry } from './types.ts';
export { mapLang } from './types.ts';
export { NullPlatform } from './null.ts';
export { YandexPlatform } from './yandex.ts';

/**
 * docs/02-tech.md 11.2: `window.YaGames` present → YandexPlatform (init waits as long as needed);
 * init failed twice → NullPlatform so the game still starts; no YaGames at all → NullPlatform at once.
 */
export async function createPlatform(opts: PlatformOptions, deps: YandexDeps = {}): Promise<Platform> {
  if (__PLATFORM__ === 'vk') return createVk(opts);
  const hasYa = deps.yaGames !== undefined || typeof YaGames !== 'undefined';
  if (hasYa) {
    const yandex = new YandexPlatform(opts, deps);
    try {
      await yandex.init();
      return yandex;
    } catch (err) {
      log.warn('Yandex SDK failed twice, running without platform', err);
    }
  }
  const fallback = new NullPlatform(opts);
  await fallback.init();
  return fallback;
}

/**
 * K-02: the VK build — the npm VK Bridge; `?mock=vk` in a plain tab (Pages, e2e; never on a signed VK/OK launch) — the
 * stand-in (platform/vk-mock.ts). VKWebAppInit goes out in the constructor, before anything else of the game loads.
 */
async function createVk(opts: PlatformOptions): Promise<Platform> {
  const search = location.search;
  const q = new URLSearchParams(search);
  let bridge: VkBridgeLike;
  if (q.get('mock') === 'vk' && !launchedByPlatform(search)) {
    const { createVkMock } = await import('./vk-mock.ts');
    const mock = createVkMock({
      dom: true,
      ads: q.get('mock_ads') === 'none' ? 'none' : 'ok',
      join: q.get('mock_join') === 'no' ? 'no' : 'yes',
      net: q.get('mock_net') === 'off' ? 'off' : 'on',
    });
    (window as unknown as { __VK_MOCK__?: unknown }).__VK_MOCK__ = mock;
    bridge = mock;
  } else bridge = (await import('@vkontakte/vk-bridge')).default as unknown as VkBridgeLike;
  const site = siteOf(search);
  const platform = new VkPlatform(opts, {
    bridge,
    search,
    rules: { ...vkConfig.bridge, ...vkConfig.save, groupId: vkGroupId(site) },
  });
  await platform.init();
  return platform;
}
