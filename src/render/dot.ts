// What: One shared round soft dot texture for Points (snowflakes, avalanche dust, puffs) — no square sprites near the camera.
// Called by: app/events-view.ts (blizzard snow), render/threat/avalanche.ts (dust), render/fx.ts (puffs), render/threat/bonus.ts and render/ftue.ts (sparks).
// Keep: Generated in code (no file, no canvas), white with alpha only — the material colour tints it; one texture for all.
import { DataTexture, LinearFilter, RGBAFormat } from 'three';

const N = 32;
let dot: DataTexture | null = null;

/** R-05 («Лавина 23»): a snowflake by the camera was a big square — the dot is round with a soft edge. */
export function roundDot(): DataTexture {
  if (dot) return dot;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const r = Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / (N / 2);
      const i = (y * N + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(255 * Math.min(1, Math.max(0, (1 - r) / 0.25)));
    }
  dot = new DataTexture(data, N, N, RGBAFormat);
  dot.magFilter = LinearFilter;
  dot.minFilter = LinearFilter;
  dot.needsUpdate = true;
  return dot;
}
