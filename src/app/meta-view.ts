/**
 * Meta on the HUD (docs/01-gdd.md 6.2, 6.4, 7.1): the shoes button «Shoes ×N · price» at the bottom centre (shows the
 * first time coins reach the next pair, then stays, grey while short; one tap buys), the reset of the shoes on a
 * rebirth, and the step multiplier of the meta for the simulation (shoes, the pets on — app/pets-view.ts). The shop
 * window — M3-09. The shoe level and «the button was shown» live in the save.
 */
import type { AurasJson, BalanceJson, PetsJson, TrailsJson } from '../content/types.ts';
import type { SaveData } from '../meta/save.ts';
import type { Sim } from '../sim/world.ts';
import type { Hud } from '../ui/hud.ts';
import { buyNextShoes, gainMult, nextShoes, SHOES_AFTER_REBIRTH, shoesPrice } from '../meta/shoes.ts';
import { equippedIds } from '../meta/pets.ts';
import { cosmeticMult } from '../meta/cosmetics.ts';
import { formatNumber } from '../ui/format.ts';
import { t } from '../ui/i18n.ts';

export interface MetaViewDeps {
  balance: BalanceJson;
  pets: PetsJson;
  /** Trails and auras (M3-04); absent — ×1. */
  trails?: TrailsJson;
  auras?: AurasJson;
  save: SaveData;
  getSim(): Sim;
  hud: Hud;
  numSuffix(k: string): string;
  trackOnce(name: string, params?: Record<string, unknown>): void;
  persist(flush?: boolean): void;
  /** Shoes bought (the quest «Buy new sneakers», M3-08b). */
  onShoes?(): void;
}

export interface MetaView {
  /** Shoe level (0 = the starting pair), the shoes button is on screen. */
  readonly shoeLevel: number;
  readonly shoesShown: boolean;
  /** Pushes the meta multiplier into the simulation (after a purchase, a pet on or off, a new mountain). */
  apply(): void;
  /** Called every frame: shows and refreshes the shoes button. */
  update(): void;
  buyShoes(): boolean;
  /** Rebirth (M3-06): the starting pair again; the button stays on the HUD. */
  resetShoes(): void;
}

export function createMetaView(d: MetaViewDeps): MetaView {
  const tiers = d.balance.upgrade.tiers;
  const flags = (): Record<string, boolean> => (d.save.flags ??= {});
  const view: MetaView = {
    get shoeLevel() {
      return d.save.shoes ?? 0;
    },
    get shoesShown() {
      return flags()['shoesBtn'] ?? false;
    },
    apply() {
      const sim = d.getSim();
      sim.progress.gainMult = gainMult(d.balance, d.pets, {
        tier: sim.tier,
        shoeLevel: view.shoeLevel,
        pets: equippedIds(d.save, d.pets, d.balance.pets.slots),
        trail: cosmeticMult(d.save, 'trail', d.trails?.trails ?? []),
        aura: cosmeticMult(d.save, 'aura', d.auras?.auras ?? []),
        boost: (d.save.boostSec ?? 0) > 0,
      });
    },
    update() {
      const sim = d.getSim();
      const next = nextShoes(tiers, view.shoeLevel);
      const price = next ? shoesPrice(next, sim.tier, d.balance.rebirth) : 0;
      if (!view.shoesShown && next && sim.coins >= price) {
        flags()['shoesBtn'] = true;
        d.persist();
      }
      if (!view.shoesShown) {
        d.hud.setShoes(null);
        return;
      }
      if (!next) {
        d.hud.setShoes({ text: t('hud.shoesMax'), can: false, progress: 1 });
        return;
      }
      d.hud.setShoes({
        text: t('hud.shoesBtn', { m: formatNumber(next.mult, d.numSuffix), price: formatNumber(price, d.numSuffix) }),
        can: sim.coins >= price,
        progress: price > 0 ? sim.coins / price : 1,
      });
    },
    buyShoes() {
      const sim = d.getSim();
      const wallet = { coins: sim.coins, level: view.shoeLevel };
      const next = buyNextShoes(wallet, tiers, sim.tier, d.balance.rebirth);
      if (!next) return false;
      sim.coins = wallet.coins;
      d.save.shoes = wallet.level;
      d.persist(true);
      view.apply();
      d.hud.setCoins(formatNumber(sim.coins, d.numSuffix));
      d.hud.toast(t('toast.newShoes', { name: t(`shoes.${next.id}`), m: formatNumber(next.mult, d.numSuffix) }));
      d.trackOnce('shoes_1');
      d.onShoes?.();
      view.update();
      return true;
    },
    resetShoes() {
      d.save.shoes = SHOES_AFTER_REBIRTH;
      d.persist(true);
      view.apply();
      view.update();
    },
  };
  return view;
}
