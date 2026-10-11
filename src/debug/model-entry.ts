// What: Computes the entry state (stat, coins, shoes, pets) for To mountain N by running the greedy bot of the balance model up to that camp.
// Called by: debug/index.ts; e2e/to-mountain.spec.ts.
// Keep: Wraps scripts/balance-model.ts, shared with sim:balance, so the game and the model stay identical; debug-only (never in the release, check-release).

/**
 * «To mountain N» of ?debug=1 (PR-09): the state of the greedy bot of the balance model (scripts/balance-model.ts,
 * docs/01-gdd.md 8.5, 16.8) at the camp of mountain N on a tier — the tiers below whole, then mountains 1…N−1 of this
 * one; pets, trophies and the egg generator go on from tier to tier as in sim:balance. Debug builds only: the release
 * never imports src/debug (check-release).
 */
import { runCycle, type ModelMeta, type ModelPack } from '../../scripts/balance-model.ts';

export interface ModelEntry {
  stat: number;
  coins: number;
  /** Shoe level: index in balance.upgrade.tiers. */
  shoe: number;
  /** Bonuses of the pets on, strongest first (the model keeps the `slots` best). */
  pets: number[];
}

export function modelEntry(pack: ModelPack, tier: number, mountain: number): ModelEntry {
  let meta: ModelMeta | undefined;
  let seed: number | undefined;
  for (let k = 0; k < tier; k++) {
    const r = runCycle(pack, { profile: 'greedy', tier: k, ...(meta ? { meta } : {}), ...(seed !== undefined ? { seed } : {}) });
    meta = r.meta;
    seed = r.seedOut;
  }
  // The camp of mountain 1: a fresh climb of this tier (a rebirth zeroes the stat, the coins and the shoes).
  if (mountain <= 1) return { stat: 0, coins: 0, shoe: 0, pets: [...(meta?.pets ?? [])] };
  const r = runCycle(pack, { profile: 'greedy', tier, mountains: mountain - 1, ...(meta ? { meta } : {}), ...(seed !== undefined ? { seed } : {}) });
  const last = r.walls[r.walls.length - 1];
  return { stat: last?.stat ?? 0, coins: r.coins, shoe: last?.shoe ?? 0, pets: [...r.meta.pets] };
}
