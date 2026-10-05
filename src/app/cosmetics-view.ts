/**
 * Trails, auras and the wardrobe in the game (docs/01-gdd.md 7.3, 7.4, 6.4): the «Shop» window with the tabs
 * «Trails» and «Auras» (buy for trophies, equip), the trail and the aura on the hero, the «Wardrobe» window with the
 * default skin of skins.json on the hero, the trophy plaque. Purchases write the save at once; the step multiplier
 * goes into the simulation through `onChange` (meta-view). Shop and pets buttons from 180 s of play, the trophy
 * plaque and the wardrobe from the first summit (6.4); the full schedule with the glow — M3-09.
 */
import type { AurasJson, BalanceJson, CosmeticItem, SkinsJson, TrailsJson } from '../content/types.ts';
import type { SaveData } from '../meta/save.ts';
import type { Hud, MenuItem } from '../ui/hud.ts';
import type { WindowFrame } from '../ui/window.ts';
import type { CosmeticsVisual } from '../render/cosmetics.ts';
import { buyCosmetic, equipCosmetic, owned, wearing, type CosmeticKind } from '../meta/cosmetics.ts';
import { renderShopPanel, type ShopCard, type ShopTab } from '../ui/shop-panel.ts';
import { renderWardrobePanel } from '../ui/wardrobe-panel.ts';
import { formatMult, formatNumber } from '../ui/format.ts';
import { t } from '../ui/i18n.ts';

export interface CosmeticsViewDeps {
  balance: BalanceJson;
  trails: TrailsJson;
  auras: AurasJson;
  skins: SkinsJson;
  save: SaveData;
  hud: Hud;
  windows: WindowFrame;
  visual: CosmeticsVisual;
  numSuffix(k: string): string;
  persist(flush?: boolean): void;
  /** Trail or aura changed: the meta multiplier goes into the simulation again. */
  onChange(): void;
  /** Puts skin `id` on the hero. */
  setHeroSkin(id: string): void;
}

export interface CosmeticsView {
  /** Skin on: save.skin when skins.json has it, otherwise the default. */
  readonly skin: string;
  update(): void;
  openShop(tab?: ShopTab): void;
  openWardrobe(): void;
  /** Buttons of the HUD column this view owns, when they are due. */
  menuItems(): { shop: MenuItem | null; wardrobe: MenuItem | null };
}

export function createCosmeticsView(d: CosmeticsViewDeps): CosmeticsView {
  let tab: ShopTab = 'trails';
  let shown = '';
  const items = (kind: CosmeticKind): CosmeticItem[] => (kind === 'trail' ? d.trails.trails : d.auras.auras);
  const kindOf = (x: ShopTab): CosmeticKind => (x === 'trails' ? 'trail' : 'aura');
  const color = (kind: CosmeticKind): string | null => {
    const id = wearing(d.save, kind);
    return id ? (items(kind).find((x) => x.id === id)?.color ?? null) : null;
  };
  const summitDone = (): boolean => (d.save.trophiesTotal ?? 0) > 0;

  const changed = (): void => {
    d.onChange();
    d.persist(true);
    d.windows.refresh();
    view.update();
  };

  const renderShop = (body: HTMLElement, head: HTMLElement): void => {
    const kind = kindOf(tab);
    const have = owned(d.save, kind);
    const on = wearing(d.save, kind);
    const trophies = d.save.trophies ?? 0;
    const cards: ShopCard[] = items(kind).map((x) => ({
      id: x.id,
      name: t(`${kind}.${x.id}`),
      mult: t('shop.perStep', { m: formatMult(x.mult, d.numSuffix) }),
      price: formatNumber(x.price, d.numSuffix),
      color: x.color,
      state: on === x.id ? 'on' : have.includes(x.id) ? 'owned' : trophies >= x.price ? 'buy' : 'short',
      need: t('shop.need', { n: formatNumber(x.price - trophies, d.numSuffix) }),
    }));
    renderShopPanel(body, head, { tab, trophies: formatNumber(trophies, d.numSuffix), cards }, {
      tab: (next) => {
        tab = next;
        d.windows.refresh();
      },
      buy: (id) => void (buyCosmetic(d.save, kind, items(kind), id) && changed()),
      equip: (id) => void (equipCosmetic(d.save, kind, id) && changed()),
    });
  };

  const renderWardrobe = (body: HTMLElement, head: HTMLElement): void => {
    const current = d.skins.skins.find((x) => x.id === view.skin) ?? d.skins.skins[0]!;
    renderWardrobePanel(
      body,
      head,
      {
        count: t('wardrobe.count', { a: d.skins.skins.filter((x) => x.unlock.kind === 'default' || x.id === view.skin).length, b: d.skins.skins.length }),
        current: current.colors,
        skins: d.skins.skins.filter((x) => x.unlock.kind === 'default' || x.id === view.skin).map((x) => ({ id: x.id, name: t(`skin.${x.id}`), colors: x.colors, on: x.id === view.skin })),
      },
      {
        equip: (id) => {
          d.save.skin = id;
          d.setHeroSkin(id);
          d.persist(true);
          d.windows.refresh();
        },
      },
    );
  };

  const view: CosmeticsView = {
    get skin() {
      const id = d.save.skin;
      return id && d.skins.skins.some((x) => x.id === id) ? id : d.skins.default;
    },
    update() {
      const trail = color('trail');
      const aura = color('aura');
      const key = `${trail}|${aura}`;
      if (key !== shown) {
        shown = key;
        d.visual.set(trail, aura);
      }
      d.hud.setTrophies(summitDone() ? formatNumber(d.save.trophies ?? 0, d.numSuffix) : null);
    },
    openShop(next) {
      if (next) tab = next;
      d.windows.open('shop', t('shop.title'), renderShop);
    },
    openWardrobe() {
      d.windows.open('wardrobe', t('wardrobe.title'), renderWardrobe);
    },
    menuItems() {
      const time = (d.save.totalPlaySec ?? 0) >= d.balance.ui.unlockMenusSec;
      return {
        shop: time ? { id: 'shop', label: t('btn.shop'), icon: 'shop' } : null,
        wardrobe: summitDone() ? { id: 'wardrobe', label: t('btn.wardrobe'), icon: 'wardrobe' } : null,
      };
    },
  };
  return view;
}
