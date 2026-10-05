import { describe, expect, it } from 'vitest';
import { createMetaView } from '../../src/app/meta-view.ts';
import { buyNextShoes, nextShoes, shoesPrice, SHOES_AFTER_REBIRTH } from '../../src/meta/shoes.ts';
import { createSave } from '../../src/meta/save.ts';
import balanceJson from '../../content/avalanche/balance.json' with { type: 'json' };
import petsJson from '../../content/avalanche/pets.json' with { type: 'json' };
import ru from '../../content/avalanche/i18n/ru.json' with { type: 'json' };
import en from '../../content/avalanche/i18n/en.json' with { type: 'json' };
import type { BalanceJson, PetsJson } from '../../src/content/types.ts';
import type { Hud, ShoesButtonState } from '../../src/ui/hud.ts';
import type { Sim } from '../../src/sim/world.ts';

const balance = balanceJson as BalanceJson;
const pets = petsJson as PetsJson;
const tiers = balance.upgrade.tiers;

// M3-02: shoes (docs/01-gdd.md 7.1; docs/01a-content.md 5).
describe('shoes (M3-02)', () => {
  it('16 pairs in order: price and multiplier grow, names in both languages', () => {
    expect(tiers).toHaveLength(16);
    expect(tiers[0]).toMatchObject({ id: 'old_sneakers', mult: 1, price: 0 });
    expect(tiers[15]).toMatchObject({ id: 'slope_legend', mult: 1200 });
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i]!.price).toBeGreaterThan(tiers[i - 1]!.price);
      expect(tiers[i]!.mult).toBeGreaterThan(tiers[i - 1]!.mult);
    }
    for (const t of tiers) {
      expect((ru as Record<string, string>)[`shoes.${t.id}`], t.id).toBeTruthy();
      expect((en as Record<string, string>)[`shoes.${t.id}`], t.id).toBeTruthy();
    }
  });

  it('a purchase takes the price and raises the level; short of coins — nothing happens', () => {
    const w = { coins: 30, level: 0 };
    expect(buyNextShoes(w, tiers, 0, balance.rebirth)?.id).toBe('runners');
    expect(w).toEqual({ coins: 0, level: 1 });
    // Snow Runners cost 200: 199 is not enough, coins and level stay.
    w.coins = 199;
    expect(buyNextShoes(w, tiers, 0, balance.rebirth)).toBeNull();
    expect(w).toEqual({ coins: 199, level: 1 });
    w.coins = 250;
    expect(buyNextShoes(w, tiers, 0, balance.rebirth)?.id).toBe('snow_runners');
    expect(w).toEqual({ coins: 50, level: 2 });
    // Tier 1: prices × wallScale[1] = 15 — Runners cost 450.
    const t1 = { coins: 449, level: 0 };
    expect(buyNextShoes(t1, tiers, 1, balance.rebirth)).toBeNull();
    t1.coins = 450;
    expect(buyNextShoes(t1, tiers, 1, balance.rebirth)?.id).toBe('runners');
    expect(t1).toEqual({ coins: 0, level: 1 });
    // The best pair on: nothing to buy.
    const top = { coins: 1e30, level: 15 };
    expect(nextShoes(tiers, 15)).toBeNull();
    expect(buyNextShoes(top, tiers, 0, balance.rebirth)).toBeNull();
    expect(top.level).toBe(15);
  });

  it('HUD button: hidden until coins first reach the price, then always shown (grey while short); rebirth resets the shoes', () => {
    const save = createSave(0);
    const sim = { coins: 0, tier: 0, progress: { gainMult: 1 } } as unknown as Sim;
    let button: ShoesButtonState | null = null;
    const hud = new Proxy({} as Hud, {
      get: (_t, key) => (key === 'setShoes' ? (s: ShoesButtonState | null) => (button = s) : () => undefined),
    });
    let flushes = 0;
    const meta = createMetaView({ balance, pets, save, getSim: () => sim, hud, numSuffix: (k) => k, trackOnce: () => undefined, persist: (f) => void (f && flushes++) });
    meta.apply();
    meta.update();
    expect(button).toBeNull();
    sim.coins = 29;
    meta.update();
    expect(button).toBeNull();
    expect(meta.buyShoes()).toBe(false);
    sim.coins = 30;
    meta.update();
    expect(button).toMatchObject({ can: true });
    expect(meta.shoesShown).toBe(true);
    expect(meta.buyShoes()).toBe(true);
    expect(sim.coins).toBe(0);
    expect(meta.shoeLevel).toBe(1);
    expect(save.shoes).toBe(1);
    expect(flushes).toBeGreaterThan(0);
    expect(sim.progress.gainMult).toBe(2);
    meta.update();
    expect(button).toMatchObject({ can: false, progress: 0 });
    sim.coins = 100;
    meta.update();
    expect(button).toMatchObject({ can: false, progress: 0.5 });
    expect(shoesPrice(nextShoes(tiers, 1)!, 0, balance.rebirth)).toBe(200);
    // Rebirth (M3-06 calls it): the starting pair again, ×1 for the step, the button stays on the HUD.
    meta.resetShoes();
    expect(meta.shoeLevel).toBe(SHOES_AFTER_REBIRTH);
    expect(save.shoes).toBe(0);
    expect(sim.progress.gainMult).toBe(1);
    sim.coins = 0;
    meta.update();
    expect(button).not.toBeNull();
    expect(button).toMatchObject({ can: false });
  });
});
