import type { Page } from '@playwright/test';
import { testState, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };

// The way about the base of the open pace for the FM e2e (docs/01-gdd.md 19.2–19.4): a summit, a base portal, the first base.
export type Seg = { type: string; z: number; x?: number; kind?: string; requires?: number; passLength?: number };
export type OpenWorld = { id: string; index: number; segments: Seg[]; bosses: Array<{ zone: [number, number]; requires: number }> };
export const worlds = (openWorlds as unknown as { worlds: OpenWorld[] }).worlds;

/** The hero of `w` (the current mountain) from past its giant into its summit portal, fast enough for every wall. */
export async function intoSummit(page: Page, w: OpenWorld): Promise<void> {
  const portal = w.segments.find((s) => s.type === 'portal')!;
  await page.evaluate(([st, z]) => {
    window.__TEST__!.holdWave(900);
    window.__TEST__!.setStat(st);
    window.__TEST__!.teleport(z, 0);
  }, [w.bosses[0]!.requires * 1.3, w.bosses[0]!.zone[1] + 4] as const);
  await waitTicks(page, 10);
  await page.evaluate((p) => window.__TEST__!.botPath(p), [[portal.x ?? 0, portal.z + 4]] as Array<[number, number]>);
}

/** Walks from where the hero stands on the base into the portal of mountain `world`; game seconds it took. */
export async function intoPortal(page: Page, world: number): Promise<number> {
  const s = await testState(page);
  const p = s.basePortals.find((b) => b.world === world)!;
  const [sn, cs] = [Math.sin(p.yaw), Math.cos(p.yaw)];
  const t0 = s.ticks;
  await page.evaluate((path) => window.__TEST__!.botPath(path), [
    [p.x - 4 * sn, p.z - 4 * cs],
    [p.x + 3 * sn, p.z + 3 * cs],
  ] as Array<[number, number]>);
  await page.waitForFunction(() => !window.__TEST__!.state().onBase, undefined, { timeout: 60_000 });
  return ((await testState(page)).ticks - t0) / 60;
}

/** The scripted first wave of mountain 1 over (the flag the ad buttons wait for, docs/01-gdd.md 9.1). */
export async function pastScriptedWave(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
}

/** A new game of the open pace, mountain 1 to its summit, «Next» — the first base; `prep` — right after the load. */
export async function toFirstBase(page: Page, openGame: (q?: string) => Promise<void>, prep?: () => Promise<void>): Promise<void> {
  await openGame('pace=open&quality=high');
  await prep?.();
  await intoSummit(page, worlds[0]!);
  await page.waitForFunction(() => window.__TEST__!.state().window === 'summit', undefined, { timeout: 60_000 });
  await page.locator('[data-hud="win-next"]').click();
  await page.waitForFunction(() => window.__TEST__!.state().onBase, undefined, { timeout: 60_000 });
  // The bot's point on the summit is left over: the hero stands at the spawn.
  await page.evaluate(() => window.__TEST__!.botPath(null));
}

/** From the base through portal `world` (the own mountain), up to its summit, «Next» — back on the base; `atWindow` —
 * while its «Mountain cleared» window is open. */
export async function nextSummit(page: Page, world: number, atWindow?: () => Promise<void>): Promise<void> {
  await intoPortal(page, world);
  await waitTicks(page, 10);
  await intoSummit(page, worlds[world - 1]!);
  await page.waitForFunction(() => window.__TEST__!.state().window === 'summit', undefined, { timeout: 60_000 });
  await atWindow?.();
  await page.locator('[data-hud="win-next"]').click();
  await page.waitForFunction(() => window.__TEST__!.state().onBase, undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
}
