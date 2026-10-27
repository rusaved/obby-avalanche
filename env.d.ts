// Build-time flags (vite.config.ts `define`). In the release build every flag is false and the
// dynamic imports behind them are dropped from the bundle (docs/02-tech.md 16.1).
declare const __DEBUG_TOOLS__: boolean;
declare const __STUDIO__: boolean;
declare const __TEST_API__: boolean;
/** Milestone label for the producer link ("M1 · 2026-10-12 · 1a2b3c4"); empty string in release. */
declare const __BUILD_LABEL__: string;
/** Path of the Yandex SDK script: "/sdk.js" in release, "sdk.js" on GitHub Pages. */
declare const __SDK_PATH__: string;
/** Pack id of this build (VITE_CONTENT). */
declare const __CONTENT_PACK__: string;
/** G-10: `VITE_NO_PAYMENTS=1` — the release archive without purchases (game.json payments.enabled is ignored). */
declare const __NO_PAYMENTS__: boolean;
/** K-02: the platform of this build — 'yandex' (every Yandex build) or 'vk' (`npm run build:vk`, dist-vk for VK and OK). */
declare const __PLATFORM__: 'yandex' | 'vk';
/** K-12: the producer's check kit (?fresh=1, ?mountain=N, ?stage=N, ?coins=N, ?playtime=N, the build line in the pause):
 * the Pages build and the VK build (there only on ?mock=vk in a plain tab); false in every Yandex archive. */
declare const __KIT__: boolean;
/** K-12: the short commit of the Pages and VK builds («build <sha>» in the pause); empty elsewhere. */
declare const __BUILD_SHA__: string;
declare module '@vk' {
  export const appId: number;
  export const vkGroupId: number;
  export const okGroupId: number;
  export const bridge: unknown;
  export const save: unknown;
  export const ads: unknown;
  export const join: unknown;
  export const texts: unknown;
}
/** ZzFX 1.4.0 ships no types; the sound module uses only ZZFX.buildSamples on its own context (docs/02-tech.md 10). */
declare module 'zzfx' {
  export const ZZFX: { sampleRate: number; audioContext: AudioContext; buildSamples(...params: number[]): number[] };
}
