/**
 * Trails, auras and the wardrobe in the game (docs/01-gdd.md 7.3, 7.4, 6.4): the «Shop» window with the tabs
 * «Trails» and «Auras» (buy for trophies, equip), the trail and the aura on the hero, the «Wardrobe» window with the
 * tabs «Skins» and «Wings» (M3-04b: for trophies, or locked with the source), the skin and wings on the hero, the
 * trophy plaque. Purchases write the save at once; the step multiplier
 * goes into the simulation through `onChange` (meta-view). The shop also shows the tabs «Sneakers» (meta-view) and
 * «Eggs» (pets-view) by `shopTabs` (M3-09); when the buttons and the trophy plaque come — meta/hud-schedule.ts.
 */
import type { AccessoriesJson, AurasJson, BalanceJson, CosmeticItem, SkinsJson, TrailsJson } from '../content/types.ts';
import type { SaveData } from '../meta/save.ts';
import type { Hud, MenuItem } from '../ui/hud.ts';
import type { WindowFrame } from '../ui/window.ts';
import type { CosmeticsVisual } from '../render/cosmetics.ts';
import { buyCosmetic, buyLook, equipCosmetic, equipLook, lookPrice, owned, ownedLooks, wearing, type CosmeticKind, type LookItem, type LookKind } from '../meta/cosmetics.ts';
import { renderShopPanel, type ShopCard, type ShopTab } from '../ui/shop-panel.ts';

/** A shop tab another view owns (sneakers, eggs): cards in coins and the purchase. */
export interface ShopTabSource {
  cards(): ShopCard[];
  /** Coins now, formatted (the window head). */
  balance(): string;
  buy(id: string): void;
}
import { renderWardrobePanel, skinFigure, type LookCard, type WardrobeTab, type WingsLook } from '../ui/wardrobe-panel.ts';
import { formatMult, formatNumber } from '../ui/format.ts';
import { t } from '../ui/i18n.ts';

export interface CosmeticsViewDeps {
  balance: BalanceJson;
  trails: TrailsJson;
  auras: AurasJson;
  skins: SkinsJson;
  accessories: AccessoriesJson;
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
  /** Puts wings `id` on the hero's back, null — none (M3-04b). */
  setHeroWings(id: string | null): void;
  /** Tabs «Sneakers» and «Eggs» of the shop (M3-09), first in the tab row. */
  shopTabs?: Partial<Record<'shoes' | 'eggs', ShopTabSource>>;
  /** The trophy plaque is due (docs/01-gdd.md 6.4: after the «Mountain cleared» window of the first summit). */
  trophiesDue?(): boolean;
}

export interface CosmeticsView {
  /** Skin on: save.skin when skins.json has it, otherwise the default. */
  readonly skin: string;
  /** Wings on: save.wing when owned, otherwise none (M3-04b). */
  readonly wings: string | null;
  update(): void;
  openShop(tab?: ShopTab): void;
  openWardrobe(tab?: WardrobeTab): void;
  /** Buttons of the HUD column this view owns, when they are due. */
  menuItems(): { shop: MenuItem | null; wardrobe: MenuItem | null };
  /** A block figure of a look (a skin, or the skin on with these wings): the rebirth reward card (M3-06). */
  lookFigure(kind: LookKind, id: string): HTMLElement;
  /** Looks granted outside the wardrobe (a rebirth tier): the skin and wings of the save onto the hero. */
  syncHero(): void;
}

export function createCosmeticsView(d: CosmeticsViewDeps): CosmeticsView {
  let tab: ShopTab = d.shopTabs?.shoes ? 'shoes' : 'trails';
  const tabs = (): ShopTab[] => [...(['shoes', 'eggs'] as const).filter((x) => d.shopTabs?.[x]), 'trails', 'auras'];
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
    const toTab = (next: ShopTab): void => {
      tab = next;
      d.windows.refresh();
    };
    const source = tab === 'shoes' || tab === 'eggs' ? d.shopTabs?.[tab] : undefined;
    if (source) {
      renderShopPanel(body, head, { tab, tabs: tabs(), balance: source.balance(), coin: true, cards: source.cards() }, { tab: toTab, buy: (id) => source.buy(id), equip: () => undefined });
      return;
    }
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
    renderShopPanel(body, head, { tab, tabs: tabs(), balance: formatNumber(trophies, d.numSuffix), coin: false, cards }, {
      tab: toTab,
      buy: (id) => void (buyCosmetic(d.save, kind, items(kind), id) && changed()),
      equip: (id) => void (equipCosmetic(d.save, kind, id) && changed()),
    });
  };

  // Wardrobe (docs/01-gdd.md 7.4, M3-04b): skins and wings, bought for trophies or locked with their source.
  let wardrobeTab: WardrobeTab = 'skins';
  const looks = (kind: LookKind): LookItem[] => (kind === 'skin' ? d.skins.skins : (d.skins.wings ?? []));
  const lookKind = (x: WardrobeTab): LookKind => (x === 'skins' ? 'skin' : 'wings');
  const wingsLook = (id: string | null): WingsLook | null => {
    const parts = id ? d.accessories.accessories.find((x) => x.id === id)?.parts : undefined;
    return parts && parts[0] ? { a: parts[0].color, b: (parts[1] ?? parts[0]).color } : null;
  };
  const source = (x: LookItem): string => {
    const n = x.unlock.value ?? '';
    if (x.unlock.kind === 'tier') return t('wardrobe.fromTier', { n });
    if (x.unlock.kind === 'daily') return t('wardrobe.fromDay', { n });
    return t('wardrobe.fromStarter');
  };
  const skinOf = (id: string) => (d.skins.skins.find((x) => x.id === id) ?? d.skins.skins[0]!).colors;
  const renderWardrobe = (body: HTMLElement, head: HTMLElement): void => {
    const kind = lookKind(wardrobeTab);
    const have = ownedLooks(d.save, kind, looks(kind));
    const on = kind === 'skin' ? view.skin : view.wings;
    const trophies = d.save.trophies ?? 0;
    const cards: LookCard[] = looks(kind).map((x) => {
      const price = lookPrice(x);
      const state: LookCard['state'] =
        on === x.id ? 'on' : have.includes(x.id) ? 'owned' : price === null ? 'locked' : trophies >= price ? 'buy' : 'short';
      return {
        id: x.id,
        name: t(`${kind}.${x.id}`),
        skin: kind === 'skin' ? skinOf(x.id) : skinOf(view.skin),
        wings: kind === 'skin' ? wingsLook(view.wings) : wingsLook(x.id),
        state,
        price: price === null ? undefined : formatNumber(price, d.numSuffix),
        need: price === null ? undefined : t('shop.need', { n: formatNumber(Math.max(0, price - trophies), d.numSuffix) }),
        source: price === null ? source(x) : undefined,
      };
    });
    const count = (k: LookKind): string => t('wardrobe.count', { a: ownedLooks(d.save, k, looks(k)).length, b: looks(k).length });
    renderWardrobePanel(
      body,
      head,
      {
        tab: wardrobeTab,
        counts: { skins: count('skin'), wings: count('wings') },
        trophies: formatNumber(trophies, d.numSuffix),
        current: skinOf(view.skin),
        currentWings: wingsLook(view.wings),
        cards,
      },
      {
        tab: (next) => {
          wardrobeTab = next;
          d.windows.refresh();
        },
        buy: (id) => void (buyLook(d.save, kind, looks(kind), id) && lookChanged(kind)),
        equip: (id) => void (equipLook(d.save, kind, looks(kind), id) && lookChanged(kind)),
      },
    );
  };
  /** A look bought or put on: onto the hero, into the save at once; numbers of the game stay as they are. */
  const lookChanged = (kind: LookKind): void => {
    if (kind === 'skin') d.setHeroSkin(view.skin);
    else d.setHeroWings(view.wings);
    d.persist(true);
    d.windows.refresh();
    view.update();
  };

  const view: CosmeticsView = {
    get skin() {
      const id = d.save.skin;
      return id && d.skins.skins.some((x) => x.id === id) ? id : d.skins.default;
    },
    get wings() {
      const id = d.save.wing;
      return id && ownedLooks(d.save, 'wings', looks('wings')).includes(id) ? id : null;
    },
    update() {
      const trail = color('trail');
      const aura = color('aura');
      const key = `${trail}|${aura}`;
      if (key !== shown) {
        shown = key;
        d.visual.set(trail, aura);
      }
      d.hud.setTrophies(summitDone() && (d.trophiesDue?.() ?? true) ? formatNumber(d.save.trophies ?? 0, d.numSuffix) : null);
    },
    openShop(next) {
      if (next) tab = next;
      d.windows.open('shop', t('shop.title'), renderShop);
    },
    openWardrobe(next) {
      if (next) wardrobeTab = next;
      d.windows.open('wardrobe', t('wardrobe.title'), renderWardrobe);
    },
    lookFigure(kind, id) {
      return kind === 'skin' ? skinFigure(skinOf(id), false, wingsLook(view.wings)) : skinFigure(skinOf(view.skin), false, wingsLook(id));
    },
    syncHero() {
      d.setHeroSkin(view.skin);
      d.setHeroWings(view.wings);
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
