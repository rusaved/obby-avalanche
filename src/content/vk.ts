// What: K-03 the VK and OK build's config (content/vk.json): bridge and save numbers, ads, the join reward, the texts by site (VK — community, OK — group).
// Called by: platform/index.ts, main.ts and ui/vk-menu.ts (VK build only, behind __PLATFORM__ === 'vk').
// Keep: texts only from content/vk.json — a text of one site never names the other (validate:content); no Cyrillic here.

// Named imports only: the build-time keys of vk.json (`game`, `i18n`) never reach the bundle.
import { appId, vkGroupId as vkId, okGroupId, bridge, save, ads, join, texts } from '@vk';
import type { VkSite } from '../platform/types.ts';
import type { Reward } from './types.ts';

export interface VkConfig {
  appId: number;
  vkGroupId: number;
  okGroupId: number;
  bridge: { timeoutSec: number; rewardedRecheckSec: number };
  save: { gapSec: number; hideGapSec: number; chunkChars: number; writesPerHour: number };
  ads: { interstitial: string[]; interstitialMinSec: number; interstitialCooldownSec: number };
  join: { reward: Extract<Reward, { kind: 'egg' | 'coins' }>; retryDays: number };
  texts: { common: Record<string, string>; vk: Record<string, string>; ok: Record<string, string> };
}

export const vkConfig = { appId, vkGroupId: vkId, okGroupId, bridge, save, ads, join, texts } as unknown as VkConfig;

export function vkGroupId(site: VkSite): number {
  return Number(site === 'ok' ? vkConfig.okGroupId : vkConfig.vkGroupId) || 0;
}

/** A text of the VK build for the site, `{n}` filled. */
export function vkText(site: VkSite, key: string, params: Record<string, string | number> = {}): string {
  const raw = vkConfig.texts[site][key] ?? vkConfig.texts.common[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}
