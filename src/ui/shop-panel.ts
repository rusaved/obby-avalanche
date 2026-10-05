/**
 * Shop window body, tabs «Trails» and «Auras» (docs/01-gdd.md 7.3, 10.2): card with a colour preview, the multiplier
 * large, the price in trophies and «Buy»; «Equipped», «Equip» for an owned one, grey «N more» while short.
 * The tabs «Shoes», «Eggs» and «Special» arrive with the full set of windows (M3-09).
 */
import { t } from './i18n.ts';
import { icon } from './icons.ts';

export type ShopTab = 'trails' | 'auras';

export interface ShopCard {
  id: string;
  name: string;
  /** «×1.1 per step». */
  mult: string;
  price: string;
  color: string;
  state: 'on' | 'owned' | 'buy' | 'short';
  /** «3 more» while short of trophies. */
  need: string;
}

export interface ShopPanelModel {
  tab: ShopTab;
  trophies: string;
  cards: ShopCard[];
}

export interface ShopPanelActions {
  tab(tab: ShopTab): void;
  buy(id: string): void;
  equip(id: string): void;
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
  const i = el('span', '');
  i.innerHTML = icon('trophy');
  p.append(i, el('span', '', text));
  return p;
}

export function renderShopPanel(body: HTMLElement, head: HTMLElement, m: ShopPanelModel, a: ShopPanelActions): void {
  const balance = trophyPrice(m.trophies);
  balance.dataset['role'] = 'shop-trophies';
  head.appendChild(balance);
  const tabs = el('div', 'win-tabs');
  for (const id of ['trails', 'auras'] as const) {
    const b = el('button', id === m.tab ? 'win-tab on' : 'win-tab', t(`shop.tab.${id}`));
    b.dataset['hud'] = `shop-tab-${id}`;
    b.addEventListener('click', () => a.tab(id));
    tabs.appendChild(b);
  }
  body.appendChild(tabs);
  const grid = el('div', 'win-grid');
  grid.dataset['role'] = 'shop-grid';
  for (const c of m.cards) {
    const card = el('div', c.state === 'on' ? 'card on' : 'card');
    card.dataset['item'] = c.id;
    const sw = el('span', 'card-swatch');
    sw.style.background = c.color;
    card.append(sw, el('span', 'card-name', c.name), el('span', 'card-big', c.mult));
    let btn: HTMLButtonElement;
    if (c.state === 'on') {
      btn = el('button', 'card-btn off', t('shop.equipped'));
    } else if (c.state === 'owned') {
      card.appendChild(el('span', 'card-sub', t('shop.owned')));
      btn = el('button', 'card-btn', t('btn.equip'));
      btn.addEventListener('click', () => a.equip(c.id));
    } else {
      card.appendChild(trophyPrice(c.price));
      btn = el('button', c.state === 'short' ? 'card-btn off' : 'card-btn', c.state === 'short' ? c.need : t('btn.buy'));
      if (c.state === 'buy') btn.addEventListener('click', () => a.buy(c.id));
    }
    btn.dataset['hud'] = 'shop-item';
    card.appendChild(btn);
    grid.appendChild(card);
  }
  body.appendChild(grid);
}
