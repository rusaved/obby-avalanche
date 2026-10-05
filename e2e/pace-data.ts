import classicWorlds from '../content/avalanche/worlds.json' with { type: 'json' };
import fastWorlds from '../content/avalanche/pace/fast/worlds.json' with { type: 'json' };
import sharedBalance from '../content/avalanche/balance.json' with { type: 'json' };
import fastBalance from '../content/avalanche/pace/fast/balance.json' with { type: 'json' };
import { mergePatch } from '../src/content/pace.ts';

// Data of a pace for the specs that run on both (docs/01-gdd.md 16.1): its worlds.json and the shared balance.json
// with the pace patch merged over it, as the game loads them.
export const PACES = ['classic', 'fast'] as const;
export type Pace = (typeof PACES)[number];
/** Evidence screenshots come from the default pace (content/avalanche/game.json pace). */
export const SHOT_PACE: Pace = 'fast';

export type Balance = typeof sharedBalance;

const WORLDS: Record<Pace, unknown> = { classic: classicWorlds, fast: fastWorlds };
const BALANCE: Record<Pace, Balance> = { classic: sharedBalance, fast: mergePatch(sharedBalance, fastBalance) };

/** worlds.json of the pace, typed by the caller's view of a world. */
export function paceWorlds<W>(pace: Pace): W[] {
  return (WORLDS[pace] as { worlds: W[] }).worlds;
}

/** balance.json of the pace: shared, plus the pace patch (classic — the shared file). */
export function paceBalance(pace: Pace): Balance {
  return BALANCE[pace];
}
