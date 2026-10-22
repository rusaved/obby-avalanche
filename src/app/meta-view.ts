// What: Shoes button and shop tab Sneakers, the shoe reset on rebirth, and the meta step multiplier (shoes, pets, trails, auras) pushed into the sim.
// Called by: main.ts; app/handles.ts (type); tests/meta/{cosmetics,pets,rebirth,shoes}.test.ts.
// Keep: Shoe level and the button-was-shown flag live in the save (never rename keys); prices come from content balance; the sim gets the multiplier only via apply().

/**
 * Meta on the HUD (docs/01-gdd.md 6.2, 6.4, 7.1): the shoes button «Shoes ×N · price» at the bottom centre (shows the
 * first time coins reach the next pair, then stays, grey while short; one tap buys), the reset of the shoes on a
 * rebirth, and the step multiplier of the meta for the simulation (shoes, the pets on — app/pets-view.ts); the cards
 * of the shop tab «Sneakers» (M3-09). The shoe level and «the button was shown» live in the save.
 */
import type { AurasJson, BalanceJson, PetsJson, TrailsJson } from '../content/types.ts';
import type { SaveData } from '../meta/save.ts';
import type { Sim } from '../sim/world.ts';
import type { Hud } from '../ui/hud.ts';
import { buyNextShoes, gainMult, nextShoes, SHOES_AFTER_REBIRTH, shoesPrice } from '../meta/shoes.ts';
import { equippedIds } from '../meta/pets.ts';
import { cosmeticMult } from '../meta/cosmetics.ts';
import { formatMult, formatNumber } from '../ui/format.ts';
import type { ShopCard } from '../ui/shop-panel.ts';
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
  /** Swatch colour of the sneaker cards in the shop (theme.json ui.stat). */
  shoesColor?: string;
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
  /** MU round 5: the shoes button tapped while short — a toast of what is missing (or that the best pair is on). */
  shoesShort(): void;
  /** Rebirth (M3-06): the starting pair again; the button stays on the HUD. */
  resetShoes(): void;
  /** Cards of the shop tab «Sneakers»: lower pairs owned, the pair on, the next one to buy, the rest locked in order. */
  shopCards(): ShopCard[];
  /** SD-03 (docs/01-gdd.md 23.3): what the shoes are paid with now — coins, or the trophies (upgrade.currency). */
  shoeFunds(): number;
  readonly shoesInTrophies: boolean;
}

export function createMetaView(d: MetaViewDeps): MetaView {
  const tiers = d.balance.upgrade.tiers;
  const inTrophies = d.balance.upgrade.currency === 'trophies';
  const funds = (): number => (inTrophies ? (d.save.trophies ?? 0) : d.getSim().coins);
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
        // M4-07: the VIP purchase (iap.vipMult).
        vip: d.save.flags?.['vip'] ?? false,
      });
    },
    update() {
      const sim = d.getSim();
      const next = nextShoes(tiers, view.shoeLevel);
      const price = next ? shoesPrice(next, sim.tier, d.balance.rebirth, d.balance.upgrade) : 0;
      if (!view.shoesShown && next && funds() >= price) {
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
      const words = { m: formatNumber(d.balance.gainPerStep * next.mult, d.numSuffix), price: formatNumber(price, d.numSuffix) };
      d.hud.setShoes({
        text: t(inTrophies ? 'hud.shoesBtnTrophies' : 'hud.shoesBtn', words),
        short: t(inTrophies ? 'hud.shoesBtnTrophiesShort' : 'hud.shoesBtnShort', words),
        cap: t('hud.shoesCap'),
        can: funds() >= price,
        progress: price > 0 ? funds() / price : 1,
      });
    },
    shoesShort() {
      // MU round 5 (producer 21.10): a tap on the quiet shoes button says what is missing.
      const next = nextShoes(tiers, view.shoeLevel);
      if (!next) {
        d.hud.toast(t('toast.shoesAll'));
        return;
      }
      const price = shoesPrice(next, d.getSim().tier, d.balance.rebirth, d.balance.upgrade);
      d.hud.toast(t(inTrophies ? 'toast.shoesShortTrophies' : 'toast.shoesShort', { n: formatNumber(Math.max(0, price - funds()), d.numSuffix) }));
    },
    buyShoes() {
      const sim = d.getSim();
      const wallet = { coins: funds(), level: view.shoeLevel };
      const next = buyNextShoes(wallet, tiers, sim.tier, d.balance.rebirth, d.balance.upgrade);
      if (!next) return false;
      if (inTrophies) d.save.trophies = wallet.coins;
      else sim.coins = wallet.coins;
      d.save.shoes = wallet.level;
      d.persist(true);
      view.apply();
      if (inTrophies) d.hud.setTrophies(formatNumber(wallet.coins, d.numSuffix));
      else d.hud.setCoins(formatNumber(sim.coins, d.numSuffix));
      d.hud.toast(t('toast.newShoes', { name: t(`shoes.${next.id}`), m: formatNumber(d.balance.gainPerStep * next.mult, d.numSuffix) }));
      d.trackOnce('shoes_1');
      d.onShoes?.();
      view.update();
      return true;
    },
    shopCards() {
      const sim = d.getSim();
      const level = view.shoeLevel;
      return tiers.map((x, i): ShopCard => {
        const price = shoesPrice(x, sim.tier, d.balance.rebirth, d.balance.upgrade);
        const state: ShopCard['state'] = i < level ? 'done' : i === level ? 'on' : i > level + 1 ? 'locked' : funds() >= price ? 'buy' : 'short';
        return {
          id: x.id,
          name: t(`shoes.${x.id}`),
          // Q-MU-11 (staff 19.10: «+N per step» everywhere): what a step gives in these sneakers, as on the HUD button.
          mult: t('hud.perStep', { n: formatNumber(d.balance.gainPerStep * x.mult, d.numSuffix) }),
          price: formatNumber(price, d.numSuffix),
          color: d.shoesColor ?? '#ffffff',
          pic: 'sneaker',
          state,
          need: t('shop.need', { n: formatNumber(Math.max(0, price - funds()), d.numSuffix) }),
          coin: !inTrophies,
          lock: t('shop.next', { name: t(`shoes.${tiers[level + 1]?.id ?? x.id}`) }),
        };
      });
    },
    shoeFunds: funds,
    shoesInTrophies: inTrophies,
    resetShoes() {
      d.save.shoes = SHOES_AFTER_REBIRTH;
      d.persist(true);
      view.apply();
      view.update();
    },
  };
  return view;
}
