// What: Purchases for yans behind game.json payments.enabled (docs/01-gdd.md 9.3): the «Special» tab of the shop from the catalog, the purchase, the restore at the start, and the show after it.
// Called by: main.ts (createIapView when payments are on; the shop source «special»; restore after boot); app/handles.ts (IapView type).
// Keep: No ysdk.payments call with the flag off (platform); each purchase is granted once (save flag iap_<id>); the show is a change seen within 5 s, never a window «success».

/**
 * The «Special» tab (docs/01-gdd.md 9.3; decisions of the producer 07.10 and 10.10, Q-035): vip, autopilot, no_ads, starter
 * with the price and the currency picture of the console's catalog, «Bought» once owned. A purchase — the platform's own
 * window — then the show: VIP — a gold star by the Speed and the toast «Was +a, now +b per step»; autopilot — the hero runs
 * by himself with «Turn off in the settings»; no ads — a toast and its mark in the pause, the banner off; the starter pack —
 * the pet jumps out by the hero and is on, the gold skin on the hero, trophies to spend only (not the records). Every one —
 * the fanfare of a summit and a jump of the pet by the hero. Bought before (another device, a reload) — granted at the start.
 */
import type { Vector3 } from 'three';
import type { BalanceJson } from '../content/types.ts';
import type { SaveData } from '../meta/save.ts';
import type { CatalogItem, Platform } from '../platform/types.ts';
import type { Hud } from '../ui/hud.ts';
import type { ShopCard } from '../ui/shop-panel.ts';
import type { Sim } from '../sim/world.ts';
import type { EventName } from '../analytics/catalog.ts';
import type { PetsView } from './pets-view.ts';
import type { ShopTabSource } from './cosmetics-view.ts';
import { addSpendableTrophies } from '../meta/trophies.ts';
import { formatNumber } from '../ui/format.ts';
import { t } from '../ui/i18n.ts';

export const IAP_PRODUCTS = ['vip', 'autopilot', 'no_ads', 'starter'] as const;

export interface IapViewDeps {
  platform: Platform;
  balance: BalanceJson;
  save: SaveData;
  hud: Hud;
  getSim(): Sim;
  pets(): PetsView | null;
  heroPos(): Vector3;
  numSuffix(k: string): string;
  /** The step gain anew (meta apply) — after VIP. */
  applyMeta(): void;
  /** The free «Autorun» of the settings (7.11) — on for the autopilot. */
  setAutoRun(on: boolean): void;
  /** The gold skin of the pack: given and on the hero. */
  wearSkin(id: string): void;
  play(name: string): void;
  persist(flush?: boolean): void;
  track(name: EventName, params?: Record<string, unknown>): void;
  /** The gold of the theme (theme.json ui.mu.gold): the marks of the cards. */
  gold: string;
  /** The shop window closes: the show is on the slope, the game and its sound go on. */
  closeWindow(): void;
}

export interface IapView {
  /** The «Special» tab of the shop. */
  readonly shop: ShopTabSource;
  /** Loads the catalog and grants what was bought before (IAP-01). */
  start(): Promise<void>;
  /** Ids granted (tests). */
  readonly owned: readonly string[];
}

const STARTER_SKIN = 'golden';
const SHOW_DELAY_MS = 300;

export function createIapView(d: IapViewDeps): IapView {
  let catalog: CatalogItem[] = [];
  const flags = (): Record<string, boolean> => (d.save.flags ??= {});
  const owns = (id: string): boolean => flags()[`iap_${id}`] === true;
  const stepGain = (): string => formatNumber(Math.round(d.balance.gainPerStep * d.getSim().progress.gainMult), d.numSuffix);

  /** Grants `id` once and returns the toast of its show. */
  const grant = (id: string): string | null => {
    if (owns(id)) return null;
    flags()[`iap_${id}`] = true;
    let toast = '';
    if (id === 'vip') {
      const a = stepGain();
      flags()['vip'] = true;
      d.applyMeta();
      d.hud.setVip(true);
      toast = t('iap.vipToast', { a, b: stepGain() });
    } else if (id === 'autopilot') {
      flags()['autopilot'] = true;
      d.setAutoRun(true);
      toast = t('iap.autopilotOn');
    } else if (id === 'no_ads') {
      flags()['noAds'] = true;
      d.platform.hideBanner();
      d.hud.setNoAds(t('iap.noAdsMark'));
      toast = t('iap.noAdsOn');
    } else if (id === 'starter') {
      const pack = d.balance.iap.starter;
      if (pack) {
        d.pets()?.hatched(pack.pet, d.heroPos().clone(), true, undefined, true);
        addSpendableTrophies(d.save, pack.trophies);
      }
      d.wearSkin(STARTER_SKIN);
      toast = t('iap.starterOn');
    }
    d.persist(true);
    return toast;
  };
  /** The show: the toast in gold, the fanfare of a summit, the pet by the hero jumps. */
  const show = (toast: string): void => {
    d.hud.toast(toast, 4, true, undefined, undefined, true);
    d.play('rewardTrophy');
    d.pets()?.cheer(d.heroPos().clone());
  };

  const view: IapView = {
    shop: {
      cards: (): ShopCard[] =>
        IAP_PRODUCTS.map((id): ShopCard => {
          const c = catalog.find((x) => x.id === id);
          return {
            id,
            name: t(`iap.${id}`),
            mult: t(`iap.${id}.what`),
            price: '',
            color: d.gold,
            state: owns(id) ? 'done' : 'buy',
            need: '',
            pic: id === 'vip' ? 'bolt' : id === 'autopilot' ? 'sneaker' : id === 'no_ads' ? 'ad' : 'gift',
            ...(c ? { money: { text: c.price, ...(c.currencyImage ? { icon: c.currencyImage } : {}) } } : {}),
          };
        }).filter((c) => catalog.length === 0 || catalog.some((x) => x.id === c.id)),
      balance: () => formatNumber(d.getSim().coins, d.numSuffix),
      buy: (id) => {
        if (owns(id)) return;
        void d.platform.purchase(id).then((ok) => {
          if (!ok) return;
          d.track('purchase', { id });
          const toast = grant(id);
          d.closeWindow();
          // A beat for the pause of the window to come off — the fanfare is heard, the change is seen on the slope.
          if (toast) setTimeout(() => show(toast), SHOW_DELAY_MS);
        });
      },
    },
    async start() {
      catalog = (await d.platform.catalog()) ?? [];
      // Restored state of the purchases granted before (a reload): their marks.
      if (owns('vip')) d.hud.setVip(true);
      if (owns('no_ads')) {
        d.hud.setNoAds(t('iap.noAdsMark'));
        d.platform.hideBanner();
      }
      for (const id of await d.platform.purchased()) {
        const toast = (IAP_PRODUCTS as readonly string[]).includes(id) ? grant(id) : null;
        if (toast) show(toast);
      }
    },
    get owned() {
      return IAP_PRODUCTS.filter(owns);
    },
  };
  return view;
}
