// What: Renders the Shop window body: tabs (sneakers, eggs, trails, auras, special), cards with price and Buy/Equip/Owned/lock state; exports price chips.
// Called by: app/cosmetics-view.ts, app/meta-view.ts, app/pets-view.ts; ui/wardrobe-panel.ts (trophyPrice).
// Keep: Pure view over ShopPanelModel/ShopPanelActions: card states, prices and locks are decided by the caller; trophyPrice and coinPrice are shared with other panels.

/**
 * Shop window body (docs/01-gdd.md 10.2, 7.1–7.3): tabs «Sneakers», «Eggs», «Trails», «Auras» and «Special» (from
 * 300 s with purchases on). A card: a colour preview, the name, the multiplier or the chances, the price in coins or
 * trophies and «Buy»; «Equipped», «Equip» or «Owned» for what the player has; grey «N more» while short; a lock with
 * its condition («First: Runners», «Unlocks on mountain 2»).
 */
import { t } from './i18n.ts';
import { icon } from './icons.ts';
import { markIcon } from './daily-panel.ts';
import { playButton } from './footsteps-panel.ts';

export type ShopTab = 'shoes' | 'eggs' | 'steps' | 'trails' | 'auras' | 'special';

export interface ShopCard {
  id: string;
  name: string;
  /** «×1.1 per step». */
  mult: string;
  price: string;
  color: string;
  /** on — equipped; owned — can be equipped; done — owned, nothing to do (lower sneakers); locked — `lock` says why. */
  state: 'on' | 'owned' | 'done' | 'buy' | 'short' | 'locked';
  /** «3 more» while short. */
  need: string;
  /** Price currency (default trophies). */
  coin?: boolean;
  /** Lock condition. */
  lock?: string;
  /** Small lines under the name (egg chances). */
  lines?: string[];
  /** Caption of the buy button instead of «Buy» («No room»), still pressable. */
  action?: string;
  /** MU-12: a set of steps — a round «listen» button in its colour instead of the swatch. */
  sound?: boolean;
  /** Round of fixes MU: a picture (an icon id, drawn in `color`) instead of the swatch — the sneakers. */
  pic?: string;
}

export interface ShopPanelModel {
  tab: ShopTab;
  /** Tabs shown now, in order. */
  tabs: ShopTab[];
  /** The balance in the head: trophies, or coins on the coin tabs. */
  balance: string;
  coin: boolean;
  cards: ShopCard[];
  /** Round of fixes MU (staff 19.10): both balances in the head — coins and trophies — whatever the tab. */
  wallet?: { coins: string; trophies: string };
}

export interface ShopPanelActions {
  tab(tab: ShopTab): void;
  buy(id: string): void;
  equip(id: string): void;
  /** MU-12: listen to a set of steps. */
  preview?(id: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Trophy icon and a number (prices and the balance in the window head). */
export function trophyPrice(text: string): HTMLElement {
  const p = el('span', 'card-price');
  const i = el('span', 'mark mark-cup');
  i.innerHTML = icon('cup');
  p.append(i, el('span', '', text));
  return p;
}

/** Stages pace (docs/01-gdd.md 22.8): the coin wallet is shown as trophies everywhere — set once at boot. */
let walletTrophies = false;
export function setWalletTrophies(on: boolean): void {
  walletTrophies = on;
}

/** Coin (a snowflake on the coin colour, as the HUD plaque) and a number; trophies on the stages pace. */
export function coinPrice(text: string): HTMLElement {
  if (walletTrophies) return trophyPrice(text);
  const p = el('span', 'card-price');
  const c = el('span', 'mark mark-coin');
  c.innerHTML = icon('coin');
  p.append(c, el('span', '', text));
  return p;
}

export function renderShopPanel(body: HTMLElement, head: HTMLElement, m: ShopPanelModel, a: ShopPanelActions): void {
  if (m.wallet) {
    const coins = coinPrice(m.wallet.coins);
    coins.dataset['role'] = 'shop-coins';
    const trophies = trophyPrice(m.wallet.trophies);
    trophies.dataset['role'] = 'shop-trophies';
    head.append(coins, trophies);
  } else {
    const balance = m.coin ? coinPrice(m.balance) : trophyPrice(m.balance);
    balance.dataset['role'] = m.coin ? 'shop-coins' : 'shop-trophies';
    head.appendChild(balance);
  }
  const tabs = el('div', 'win-tabs');
  for (const id of m.tabs) {
    const b = el('button', id === m.tab ? 'win-tab on' : 'win-tab', t(`shop.tab.${id}`));
    b.dataset['hud'] = `shop-tab-${id}`;
    b.addEventListener('click', () => a.tab(id));
    tabs.appendChild(b);
  }
  body.appendChild(tabs);
  const grid = el('div', 'win-grid');
  grid.dataset['role'] = 'shop-grid';
  for (const c of m.cards) {
    const card = el('div', c.state === 'on' ? 'card on' : c.state === 'locked' ? 'card locked' : 'card');
    card.dataset['item'] = c.id;
    if (c.sound) card.appendChild(playButton(c.color, () => a.preview?.(c.id)));
    else if (c.pic) {
      const pic = el('span', 'card-pic');
      pic.innerHTML = icon(c.pic);
      pic.style.color = c.color;
      card.appendChild(pic);
    } else {
      const sw = el('span', 'card-swatch');
      sw.style.background = c.color;
      card.appendChild(sw);
    }
    card.appendChild(el('span', 'card-name', c.name));
    if (c.mult) card.appendChild(el('span', 'card-big', c.mult));
    if (c.lines?.length) {
      const list = el('span', 'card-lines');
      list.append(el('b', '', t('shop.chances')), ...c.lines.map((x) => el('span', '', x)));
      card.appendChild(list);
    }
    let btn: HTMLElement;
    if (c.state === 'on' && c.sound) {
      btn = el('span', 'foot-chosen', t('footsteps.chosen'));
    } else if (c.state === 'owned' && c.sound) {
      btn = el('button', 'card-btn quiet', t('footsteps.choose'));
      btn.addEventListener('click', () => a.equip(c.id));
    } else if (c.state === 'on') {
      btn = el('button', 'card-btn off', t('shop.equipped'));
    } else if (c.state === 'owned') {
      card.appendChild(el('span', 'card-sub', t('shop.owned')));
      btn = el('button', 'card-btn', t('btn.equip'));
      btn.addEventListener('click', () => a.equip(c.id));
    } else if (c.state === 'done') {
      btn = el('button', 'card-btn off', t('shop.owned'));
    } else if (c.state === 'locked') {
      btn = el('span', 'card-lock');
      btn.innerHTML = markIcon('lock');
      btn.appendChild(el('span', '', c.lock ?? ''));
    } else {
      card.appendChild(c.coin ? coinPrice(c.price) : trophyPrice(c.price));
      btn = el('button', c.state === 'short' ? 'card-btn off' : 'card-btn', c.state === 'short' ? c.need : (c.action ?? t('btn.buy')));
      if (c.state === 'buy') btn.addEventListener('click', () => a.buy(c.id));
    }
    btn.dataset['hud'] = 'shop-item';
    card.appendChild(btn);
    grid.appendChild(card);
  }
  body.appendChild(grid);
}
