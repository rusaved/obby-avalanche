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
import { icon, setRich } from './icons.ts';
import { markIcon } from './daily-panel.ts';
import { playButton, stepEnd } from './footsteps-panel.ts';

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
  /** MU round 4 (producer 20.10: «Buy» of an egg under its long list of chances): the pets of an egg as small faces
   * with their %, drawn instead of `lines`; the name, the price and «Buy» go to the top of the card. */
  chances?: Array<{ name: string; color: string; accent: string; pct: string }>;
  /** Caption of the buy button instead of «Buy» («No room»), still pressable. */
  action?: string;
  /** MU-12: a set of steps — a round «listen» button in its colour instead of the swatch. */
  sound?: boolean;
  /** Round of fixes MU: a picture (an icon id, drawn in `color`) instead of the swatch — the sneakers. */
  pic?: string;
  /** M4-07 (IAP-01): a price of the platform's catalog — its text and its currency picture, instead of coins/trophies. */
  money?: { text: string; icon?: string };
  /** M4-03 (docs/01-gdd.md 9.1, place egg): «▶ Ad: {egg}» under the card; `busy` — locked until the ad answers. */
  ad?: { text: string; busy: boolean };
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
  /** M4-03: the rewarded ad of a card (the egg of the mountain). */
  ad?(id: string): void;
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
  // MU round of fixes 2 (staff: 4 in a row): the sets of steps — the grid and cards of the «Footsteps» window.
  const steps = m.cards.some((c) => c.sound);
  // MU round 5 (producer 21.10): the sneakers in rows, as the leader of the genre — 3–4 whole at 880 × 405.
  const shoes = !steps && m.cards.some((c) => c.pic);
  // …and trails and auras in rows too (reviews of round 5: one row of cards and a quarter of the window empty).
  const swatches = !steps && !shoes && m.cards.some((c) => !c.chances?.length && !c.pic);
  const grid = el('div', steps ? 'win-grid foot-grid' : shoes ? 'win-grid shoe-list' : swatches ? 'win-grid swatch-list' : 'win-grid');
  grid.dataset['role'] = 'shop-grid';
  for (const c of m.cards) {
    const card = el('div', `${c.state === 'on' ? 'card on' : c.state === 'locked' ? 'card locked' : 'card'}${steps ? ' foot-card' : ''}`);
    card.dataset['item'] = c.id;
    if (c.sound) card.appendChild(playButton(c.color, () => a.preview?.(c.id)));
    else if (c.pic) {
      const pic = el('span', 'card-pic');
      pic.innerHTML = icon(c.pic);
      pic.style.color = c.color;
      card.appendChild(pic);
    } else {
      const sw = el('span', 'card-swatch');
      // MU round 5, reviews (strong 3: flat squares, a white egg like an empty cell): the item's own mark in its colour.
      const mark = m.tab === 'eggs' ? 'egg' : m.tab === 'trails' ? 'trailMark' : m.tab === 'auras' ? 'auraMark' : null;
      if (mark) {
        sw.classList.add('drawn');
        sw.innerHTML = icon(mark);
        sw.style.color = c.color;
      } else sw.style.background = c.color;
      card.appendChild(sw);
    }
    card.appendChild(el('span', 'card-name', c.name));
    // MU round 3: «+N per step» and the price of a pair of sneakers in one line box — a line of its own on a low screen
    // (815 × 290), invisible otherwise (`display: contents`).
    // MU round 4 (the automatic check of 07: trails and auras cut at 815 × 290): the swatch cards take the same line.
    const line = c.pic || !c.chances?.length ? el('span', 'card-line') : card;
    if (line !== card) card.appendChild(line);
    if (c.mult) line.appendChild(el('span', 'card-big', c.mult));
    if (c.lines?.length && !c.chances?.length) {
      const list = el('span', 'card-lines');
      list.append(el('b', '', t('shop.chances')), ...c.lines.map((x) => el('span', '', x)));
      card.appendChild(list);
    }
    // MU round 3 (D50): a set of steps — the bottom of the card of «Footsteps»: «✓ Chosen», the padlock with the price or
    // the condition, a button.
    if (c.sound) {
      let button: HTMLElement | undefined;
      if (c.state === 'owned') {
        button = el('button', 'card-btn quiet', t('footsteps.choose'));
        button.addEventListener('click', () => a.equip(c.id));
      } else if (c.state === 'buy' || c.state === 'short') {
        button = el('button', c.state === 'short' ? 'card-btn off' : 'card-btn', c.state === 'short' ? c.need : (c.action ?? t('btn.buy')));
        if (c.state === 'buy') button.addEventListener('click', () => a.buy(c.id));
      }
      if (button) button.dataset['hud'] = 'shop-item';
      const price = c.state === 'buy' || c.state === 'short' ? (c.coin ? coinPrice(c.price) : trophyPrice(c.price)) : undefined;
      card.appendChild(stepEnd({ chosen: c.state === 'on', ...(c.state === 'locked' ? { lock: c.lock ?? '' } : price ? { lock: price } : {}), button }));
      grid.appendChild(card);
      continue;
    }
    if (c.chances?.length) {
      grid.appendChild(eggCard(card, c, a));
      continue;
    }
    let btn: HTMLElement;
    if (c.state === 'on') {
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
      if (c.money) {
        const m = el('span', 'card-price iap-price');
        m.dataset['role'] = 'iap-price';
        if (c.money.icon) {
          const img = el('img', 'iap-cur');
          img.src = c.money.icon;
          img.alt = '';
          m.appendChild(img);
        }
        m.appendChild(el('span', '', c.money.text));
        line.appendChild(m);
      } else line.appendChild(c.coin ? coinPrice(c.price) : trophyPrice(c.price));
      btn = el('button', c.state === 'short' ? 'card-btn off' : 'card-btn', c.state === 'short' ? c.need : (c.action ?? t('btn.buy')));
      if (c.state === 'buy') btn.addEventListener('click', () => a.buy(c.id));
    }
    btn.dataset['hud'] = 'shop-item';
    card.appendChild(btn);
    grid.appendChild(card);
  }
  body.appendChild(grid);
}

/** MU round 4: an egg card — the swatch, the name, the price and «Buy» on top; under them the pets as faces with their
 * % in a grid of two rows (the name of a pet in its title). */
function eggCard(card: HTMLElement, c: ShopCard, a: ShopPanelActions): HTMLElement {
  card.classList.add('egg-card');
  const sw = card.querySelector('.card-swatch');
  const name = card.querySelector('.card-name');
  const top = el('div', 'egg-top');
  const what = el('div', 'egg-what');
  if (name) what.appendChild(name);
  let btn: HTMLElement;
  if (c.state === 'locked') {
    btn = el('span', 'card-lock');
    btn.innerHTML = markIcon('lock');
    btn.appendChild(el('span', '', c.lock ?? ''));
  } else {
    what.appendChild(c.coin ? coinPrice(c.price) : trophyPrice(c.price));
    btn = el('button', c.state === 'short' ? 'card-btn off' : 'card-btn', c.state === 'short' ? c.need : (c.action ?? t('btn.buy')));
    if (c.state === 'buy') btn.addEventListener('click', () => a.buy(c.id));
  }
  btn.dataset['hud'] = 'shop-item';
  if (sw) top.appendChild(sw);
  top.append(what, btn);
  const odds = el('div', 'egg-odds');
  odds.dataset['role'] = 'egg-odds';
  for (const x of c.chances ?? []) {
    const chip = el('span', 'egg-odd');
    chip.title = x.name;
    const face = el('span', 'egg-face');
    face.style.background = x.color;
    const nose = el('span', 'egg-nose');
    nose.style.background = x.accent;
    face.appendChild(nose);
    chip.append(face, el('span', '', x.pct));
    odds.appendChild(chip);
  }
  card.replaceChildren(top, odds);
  // M4-03 (docs/01-gdd.md 9.1; 07 rule 13: the ad with its mark and the word «Ad», not by the main button): the egg of
  // the mountain for an ad, a quiet button under the chances.
  if (c.ad && c.state !== 'locked') {
    const ad = el('button', c.ad.busy ? 'card-btn quiet egg-ad off' : 'card-btn quiet egg-ad');
    ad.dataset['hud'] = 'shop-egg-ad';
    setRich(ad, c.ad.text);
    if (!c.ad.busy) ad.addEventListener('click', () => a.ad?.(c.id));
    card.appendChild(ad);
  }
  return card;
}
