import { describe, expect, it } from 'vitest';
import { applyFlags, flagDefaults, type FlagDef } from '../../src/content/flags.ts';
import game from '../../content/avalanche/game.json' with { type: 'json' };
import balance from '../../content/avalanche/balance.json' with { type: 'json' };
import worlds from '../../content/avalanche/worlds.json' with { type: 'json' };

// M4-11, M4-12 (docs/02-tech.md 11.11; docs/06 8.1; Q-025): the defaults of the flags from their paths; a value from
// getFlags applied into its range — outside it clamped with a warning; interstitialCooldownSec no lower than 120.

const defs = game.flags as Record<string, FlagDef>;
function root() {
  const b = structuredClone(balance);
  const w = structuredClone(worlds);
  const g = structuredClone(game);
  return { b, w, g, root: { game: g, balance: b, worlds: Object.fromEntries(w.worlds.map((x) => [String(x.index), x])) } };
}

describe('remote flags (M4-11, M4-12)', () => {
  it('the six flags of the first week are there with their paths; the cooldown 180 by default, 120 at least', () => {
    for (const k of ['w1_warnSec', 'w1_firstIntervalSec', 'w2_firstIntervalSec', 'goldGift_mult', 'interstitialCooldownSec', 'sneakers1_price']) expect(defs[k], k).toBeDefined();
    expect(defs['interstitialCooldownSec']!.min).toBe(120);
    const { root: r } = root();
    expect(flagDefaults(defs, r)['interstitialCooldownSec']).toBe('180');
  });

  it('interstitialCooldownSec 60 is clamped to 120 with a warning; 150 is taken as it is', () => {
    const a = root();
    const warns: string[] = [];
    const d = flagDefaults(defs, a.root);
    expect(applyFlags(defs, { ...d, interstitialCooldownSec: '60' }, d, a.root, (m) => warns.push(m))).toEqual({ interstitialCooldownSec: 120 });
    expect(a.b.ads.interstitialCooldownSec).toBe(120);
    expect(warns.join()).toMatch(/interstitialCooldownSec/);
    const b = root();
    const w2: string[] = [];
    applyFlags(defs, { ...d, interstitialCooldownSec: '150' }, d, b.root, (m) => w2.push(m));
    expect(b.b.ads.interstitialCooldownSec).toBe(150);
    expect(w2).toEqual([]);
  });

  it('sneakers1_price changes the price of the first sneakers; w1_firstIntervalSec — the first avalanche of mountain 1', () => {
    const a = root();
    const d = flagDefaults(defs, a.root);
    applyFlags(defs, { ...d, sneakers1_price: '25', w1_firstIntervalSec: '40' }, d, a.root, () => undefined);
    expect(a.b.upgrade.tiers[1]!.price).toBe(25);
    expect(a.w.worlds.find((x) => x.index === 1)!.threat.firstIntervalSec).toBe(40);
  });

  it('a value equal to the default, a broken number or a text off its list changes nothing', () => {
    const a = root();
    const d = flagDefaults(defs, a.root);
    const warns: string[] = [];
    expect(applyFlags(defs, { ...d, w1_warnSec: 'abc', skipFirstPortal: 'maybe' }, d, a.root, (m) => warns.push(m))).toEqual({});
    expect(warns).toHaveLength(2);
    expect(a.b.ads.skipFirstPortal).toBe(true);
  });
});
