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
/** ZzFX 1.4.0 ships no types; the sound module uses only ZZFX.buildSamples on its own context (docs/02-tech.md 10). */
declare module 'zzfx' {
  export const ZZFX: { sampleRate: number; audioContext: AudioContext; buildSamples(...params: number[]): number[] };
}
