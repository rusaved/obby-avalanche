/**
 * Economy formulas of docs/01-gdd.md 8.1, one module for the game and for the balance model (scripts/balance-model.ts):
 * every number comes from balance.json (and per-item multipliers from the pack files), none lives here. Pure TS.
 *
 *   gain     = gainPerStep × stepMult^n × shoe × pets × trail × aura × boost × vip
 *   on belt  = gain × treadmill(p)
 *   coins    = k × zone gift × wallScale[n]   (gate pass, «Phew, made it!», summit chest, daily rewards)
 *   price    = price × wallScale[n]           (shoes, eggs)
 *   trophies = balance.trophies.perSummit of (world, tier)
 */
import type { BalanceJson } from '../content/types.ts';
import { wallScale } from './gates.ts';

/** The meta multipliers of one step; a missing one counts as ×1 (nothing bought yet). */
export interface GainMults {
  /** Rebirth tier n: the step grows × `rebirth.stepMult` per tier. */
  tier?: number;
  /** Multiplier of the shoes on (balance.upgrade.tiers[level].mult). */
  shoe?: number;
  /** 1 + the bonuses of the pets on (docs/01a-content.md 6). */
  pets?: number;
  /** Multipliers of the trail and the aura on (trails.json, auras.json; M3-04). */
  trail?: number;
  aura?: number;
  /** The ×2 boost runs (ad, rewards): × `boost.x2Mult`. */
  boost?: boolean;
  /** The VIP purchase: × `iap.vipMult`. */
  vip?: boolean;
}

type EconomyBalance = Pick<BalanceJson, 'gainPerStep' | 'rebirth' | 'boost' | 'iap'>;

/** Product of the multipliers of a step, without `gainPerStep` (the step tracker multiplies it in). */
export function gainMult(balance: EconomyBalance, m: GainMults): number {
  return (
    Math.pow(balance.rebirth.stepMult, m.tier ?? 0) *
    (m.shoe ?? 1) *
    (m.pets ?? 1) *
    (m.trail ?? 1) *
    (m.aura ?? 1) *
    (m.boost ? balance.boost.x2Mult : 1) *
    (m.vip ? balance.iap.vipMult : 1)
  );
}

/** Stat gained by one step; on a treadmill belt × its multiplier (docs/01-gdd.md 8.1). */
export function stepGain(balance: EconomyBalance, m: GainMults, treadmill = 1): number {
  return balance.gainPerStep * gainMult(balance, m) * treadmill;
}

/** «Speed now» for an ad: `boost.statNowSec` seconds of the nearest cave's treadmill at run speed `runSpeed`
 * (u/s, the stat effect with the live curve): gain × treadmill × steps a second × seconds. */
export function statNowGain(balance: EconomyBalance & Pick<BalanceJson, 'stepLength'>, m: GainMults, treadmill: number, runSpeed: number): number {
  return stepGain(balance, m, treadmill) * (runSpeed / balance.stepLength) * balance.boost.statNowSec;
}

/** A price (shoes, eggs) or a base coin amount on tier `tier`: × wallScale[n]. */
export function scaled(amount: number, tier: number, rebirth: BalanceJson['rebirth']): number {
  return amount * wallScale(tier, rebirth);
}

/** Coins of a reward kind of balance.coins: k × zone gift × wallScale[n]. */
export function rewardCoins(balance: Pick<BalanceJson, 'coins' | 'rebirth'>, kind: keyof BalanceJson['coins'], zoneGift: number, tier: number): number {
  return scaled(balance.coins[kind] * zoneGift, tier, balance.rebirth);
}

/** Trophies for the summit of mountain `world` on tier `tier`: the expression balance.trophies.perSummit. */
export function summitTrophies(balance: Pick<BalanceJson, 'trophies'>, world: number, tier: number): number {
  return evalFormula(balance.trophies.perSummit, { world, tier });
}

/**
 * A tiny arithmetic expression of the data (numbers, variables, + − × ÷, brackets): «world * (1 + tier)».
 * Throws on anything else, so the validator catches a broken formula before the game runs.
 */
export function evalFormula(src: string, vars: Record<string, number>): number {
  const tokens = src.match(/\d+(?:\.\d+)?|[A-Za-z_]\w*|[-+*/()]|\S/g) ?? [];
  let i = 0;
  const fail = (what: string): never => {
    throw new Error(`formula "${src}": ${what}`);
  };
  const atom = (): number => {
    const t = tokens[i++];
    if (t === undefined) return fail('unexpected end');
    if (t === '(') {
      const v = sum();
      if (tokens[i++] !== ')') fail('missing )');
      return v;
    }
    if (t === '-') return -atom();
    if (/^\d/.test(t)) return Number(t);
    if (/^[A-Za-z_]/.test(t)) return t in vars ? (vars[t] as number) : fail(`unknown name ${t}`);
    return fail(`unexpected ${t}`);
  };
  const product = (): number => {
    let v = atom();
    while (tokens[i] === '*' || tokens[i] === '/') v = tokens[i++] === '*' ? v * atom() : v / atom();
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (tokens[i] === '+' || tokens[i] === '-') v = tokens[i++] === '+' ? v + product() : v - product();
    return v;
  };
  const v = sum();
  if (i < tokens.length) fail(`unexpected ${tokens[i]}`);
  return v;
}
