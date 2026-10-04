import { NullPlatform } from './null.ts';
import { YandexPlatform, type YandexDeps } from './yandex.ts';
import type { Platform, PlatformOptions } from './types.ts';
import { log } from '../core/log.ts';

export type { Platform, PlatformOptions, Lang, DeviceType, LeaderEntry } from './types.ts';
export { mapLang } from './types.ts';
export { NullPlatform } from './null.ts';
export { YandexPlatform } from './yandex.ts';

/**
 * docs/02-tech.md 11.2: `window.YaGames` present → YandexPlatform (init waits as long as needed);
 * init failed twice → NullPlatform so the game still starts; no YaGames at all → NullPlatform at once.
 */
export async function createPlatform(opts: PlatformOptions, deps: YandexDeps = {}): Promise<Platform> {
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
