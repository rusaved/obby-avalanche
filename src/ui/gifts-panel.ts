// What: Renders the «Gifts» window body (w1-gifts): four tiles of the rewards for the time in the game with timers («Take» in green when ready), then three cards — «Drop by the group» (Telegram, VK), «Chest for a review · Rate», «+N Speed · Ad».
// Called by: main.ts (openGifts, the gift plaque of the HUD).
// Keep: Pure view over GiftsPanelModel; texts via t(); the ad button carries the ad mark and the word «Ad» (docs/03 2.3) and is never the main button; no «subscribe» wording — the reward is for a visit.

/**
 * «Gifts» window body (MU-07, docs/07-mobile-ui.md): the rewards for the time in the game come first; under them the
 * group, the review and the Speed for an ad — each a card with its own quiet button.
 */
import { t } from './i18n.ts';
import { icon, setRich } from './icons.ts';

export interface GiftTile {
  index: number;
  icon: string;
  name: string;
  /** «for 3 minutes», «at once»… */
  sub: string;
  timer: string;
  state: 'run' | 'ready' | 'got';
}

export interface GiftsPanelModel {
  tiles: GiftTile[];
  /** The groups of the game (ids) and the line under «Drop by the group» («for a visit — an egg»); null — no card. */
  groups: { ids: string[]; sub: string } | null;
  /** «Chest for a review»: null — no card. */
  review: { sub: string; can: boolean } | null;
  /** K-08 (VK build): «Join the community (group)» — the gift for joining; absent or null — no card. */
  join?: { name: string; sub: string; button: string } | null;
  /** «+N Speed» for an ad: null — no card. */
  /** `wait` — M4 review (game designer): the pause between these ads, «in 3:20» under the title, the button off. */
  ad: { title: string; busy: boolean; wait?: string } | null;
  /** ST-07 (Q-M4-1 B): «×2 per step · 3 min» for an ad beside «+N Speed»; `wait` — the boost runs (its time left) or the
   * pause of the ads, the button off; null — no card. */
  boost?: { title: string; busy: boolean; wait?: string; running?: string } | null;
}

export interface GiftsPanelActions {
  claim(index: number): void;
  visit(id: string): void;
  review(): void;
  join?(): void;
  ad(): void;
  boostAd?(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function iconBtn(cls: string, id: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls);
  const i = el('span', 'mark');
  i.innerHTML = icon(id);
  b.append(i, text);
  b.addEventListener('click', onClick);
  return b;
}

export function renderGiftsPanel(body: HTMLElement, m: GiftsPanelModel, a: GiftsPanelActions): void {
  const tiles = el('div', 'gf-tiles');
  tiles.dataset['role'] = 'gift-tiles';
  for (const x of m.tiles) {
    const tile = el('div', `card gf-tile ${x.state}`);
    tile.dataset['tile'] = String(x.index);
    const pic = el('span', 'gf-icon');
    pic.innerHTML = icon(x.icon);
    tile.append(pic, el('span', 'card-name', x.name), el('span', 'card-sub', x.sub));
    if (x.state === 'ready') {
      const b = el('button', 'card-btn ok', t('btn.claim'));
      b.dataset['hud'] = 'gift-claim';
      b.addEventListener('click', () => a.claim(x.index));
      tile.appendChild(b);
    } else tile.appendChild(el('span', 'gf-timer', x.state === 'got' ? t('time.got') : x.timer));
    tiles.appendChild(tile);
  }
  // M4 review (07 rule 13: no ad in the lower third of a window): the cards with the ad come first, the timers under them.
  const cards = el('div', 'gf-cards');
  if (m.groups) {
    const c = el('div', 'card gf-card gf-groups');
    c.append(el('span', 'card-name', t('gifts.group')), el('span', 'card-sub', m.groups.sub));
    const row = el('div', 'gf-btns');
    for (const id of m.groups.ids) {
      const b = iconBtn('card-btn quiet', id === 'telegram' ? 'telegram' : 'vk', t(`community.${id}`), () => a.visit(id));
      b.dataset['hud'] = `gift-visit-${id}`;
      row.appendChild(b);
    }
    c.appendChild(row);
    cards.appendChild(c);
  }
  if (m.join) {
    const c = el('div', 'card gf-card gf-join');
    c.append(el('span', 'card-name', m.join.name), el('span', 'card-sub', m.join.sub));
    const b = iconBtn('card-btn quiet', 'gift', m.join.button, () => a.join?.());
    b.dataset['hud'] = 'gift-join';
    c.appendChild(b);
    cards.appendChild(c);
  }
  if (m.review) {
    const c = el('div', 'card gf-card');
    c.append(el('span', 'card-name', t('communityGift.review')), el('span', 'card-sub', m.review.sub));
    const b = iconBtn('card-btn quiet', 'star', t('gifts.rate'), () => a.review());
    b.dataset['hud'] = 'gift-review';
    b.disabled = !m.review.can;
    c.appendChild(b);
    cards.appendChild(c);
  }
  if (m.ad) {
    const c = el('div', 'card gf-card');
    c.append(el('span', 'card-name', m.ad.title), el('span', 'card-sub', m.ad.wait ?? t('gifts.forAd')));
    const b = el('button', 'card-btn quiet');
    b.dataset['hud'] = 'gift-ad';
    setRich(b, t('gifts.ad'));
    b.disabled = m.ad.busy || m.ad.wait !== undefined;
    b.addEventListener('click', () => a.ad());
    c.appendChild(b);
    cards.appendChild(c);
  }
  if (m.boost) {
    const c = el('div', 'card gf-card');
    c.dataset['role'] = 'gift-boost';
    c.append(el('span', 'card-name', m.boost.title), el('span', 'card-sub', m.boost.running ? t('gifts.forAd') : (m.boost.wait ?? t('gifts.forAd'))));
    const b = el('button', 'card-btn quiet');
    b.dataset['hud'] = 'gift-boost-ad';
    // ST-07 (usability review): while the boost runs the button says so with its time, grey.
    if (m.boost.running) b.textContent = m.boost.running;
    else setRich(b, t('gifts.ad'));
    b.disabled = m.boost.busy || m.boost.wait !== undefined || m.boost.running !== undefined;
    b.addEventListener('click', () => a.boostAd?.());
    c.appendChild(b);
    cards.appendChild(c);
  }
  // ST-07 (usability review: a fourth card went to a row of its own and the window cut the body to one row): four in a row.
  if (cards.children.length >= 4) cards.classList.add('four');
  body.append(cards, tiles);
}
