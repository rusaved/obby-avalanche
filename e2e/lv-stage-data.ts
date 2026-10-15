import type { Page } from '@playwright/test';
import stagesWorlds from '../content/avalanche/pace/stages/worlds.json' with { type: 'json' };
import stagesBalance from '../content/avalanche/pace/stages/balance.json' with { type: 'json' };
import type { WorldStage } from '../src/content/types.ts';
import { levelThreshold } from '../src/sim/levels.ts';

// The stages pace for the LV specs (docs/01-gdd.md 22): its mountains and levels as the game loads them.
export const STAGES = (stagesWorlds as unknown as { worlds: Array<{ stages: WorldStage[]; segments: Array<{ type: string; z: number; [k: string]: unknown }> }> }).worlds;
export const LEVELS = (stagesBalance as unknown as { levels: { first: number; growth: number } }).levels;
export const threshold = (n: number): number => levelThreshold(n, LEVELS);
/** The flag of stage st (its checkpoint past the carniz). */
export function flagOf(world: number, st: WorldStage): { x: number; y: number; z: number } {
  const c = STAGES[world - 1]!.segments.find((s) => s.type === 'checkpoint' && s.z >= st.z0 && s.z <= st.start);
  return { x: 0, y: st.y, z: c ? c.z : st.start - 8 };
}

/** 60 s of play and the first avalanche over (the common conditions of the ads, 9.1). */
export async function ready(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setPlaySec(61));
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
}
