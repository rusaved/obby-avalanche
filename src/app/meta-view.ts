/**
 * Meta of the first minute (docs/01-gdd.md 6.2, 6.4): the shoes button (shows from the first time coins reach the
 * next pair, one tap buys), pets from the free egg, the step multiplier they give to the simulation. Shoes reset and
 * the shop window arrive with M3-02; pets beyond the free egg with M3-03.
 */
import type { BalanceJson, PetsJson } from '../content/types.ts';
import type { SaveData } from '../meta/save.ts';
import type { Sim } from '../sim/world.ts';
import type { Hud } from '../ui/hud.ts';
import { gainMult, nextShoes, shoesPrice } from '../meta/shoes.ts';
import { formatNumber } from '../ui/format.ts';
import { t } from '../ui/i18n.ts';

export interface MetaViewDeps {
  balance: BalanceJson;
  pets: PetsJson;
  save: SaveData;
  getSim(): Sim;
  hud: Hud;
  numSuffix(k: string): string;
  trackOnce(name: string, params?: Record<string, unknown>): void;
  persist(): void;
}

export interface MetaView {
  /** Shoe level (0 = the starting pair), the shoes button is on screen. */
  readonly shoeLevel: number;
  readonly shoesShown: boolean;
  /** Pushes the meta multiplier into the simulation (after a purchase, a pet, a new mountain). */
  apply(): void;
  /** Called every frame: shows and refreshes the shoes button. */
  update(): void;
  buyShoes(): boolean;
  /** The free egg hatched `pet` (docs/01-gdd.md 6.2). */
  addPet(pet: string): void;
}

export function createMetaView(d: MetaViewDeps): MetaView {
  const tiers = d.balance.upgrade.tiers;
  let shoeLevel = 0;
  let shoesShown = false;
  const owned = (): string[] => (d.save.pets ??= []);
  const view: MetaView & { shoeLevel: number; shoesShown: boolean } = {
    get shoeLevel() {
      return shoeLevel;
    },
    get shoesShown() {
      return shoesShown;
    },
    apply() {
      d.getSim().progress.gainMult = gainMult(tiers, shoeLevel, owned(), d.pets, d.balance.pets.slots);
    },
    update() {
      const sim = d.getSim();
      const next = nextShoes(tiers, shoeLevel);
      const price = next ? shoesPrice(next, sim.tier, d.balance.rebirth) : 0;
      if (!shoesShown && next && sim.coins >= price) shoesShown = true;
      if (!shoesShown) {
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
      const next = nextShoes(tiers, shoeLevel);
      if (!next) return false;
      const price = shoesPrice(next, sim.tier, d.balance.rebirth);
      if (sim.coins < price) return false;
      sim.coins -= price;
      shoeLevel++;
      view.apply();
      d.hud.setCoins(formatNumber(sim.coins, d.numSuffix));
      d.hud.toast(t('toast.newShoes', { name: t(`shoes.${next.id}`), m: formatNumber(next.mult, d.numSuffix) }));
      d.trackOnce('shoes_1');
      view.update();
      return true;
    },
    addPet(pet) {
      owned().push(pet);
      (d.save.flags ??= {})['giftEgg'] = true;
      view.apply();
      const bonus = d.pets.pets.find((p) => p.id === pet)?.bonus ?? 0;
      d.hud.toast(t('toast.newPet', { n: Math.round(bonus * 100) }));
      d.trackOnce('egg_1');
      d.persist();
    },
  };
  return view;
}
