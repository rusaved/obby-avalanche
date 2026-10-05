/**
 * Wardrobe window body (docs/01-gdd.md 7.4, 10.2): the hero large and slowly turning in the skin and wings on, tabs
 * «Skins 2/12» and «Wings 0/8», cards with the look, its state and its source: the trophy price with «Buy» / «N more»,
 * or a lock with «Tier 3», «Day 7», «Starter Pack» (M3-04b).
 */
import { t } from './i18n.ts';
import { icon } from './icons.ts';
import { trophyPrice } from './shop-panel.ts';

export interface SkinLook {
  head: string;
  torso: string;
  armL: string;
  armR: string;
  legL: string;
  legR: string;
}

/** Wings in the picture: the colours of the big and the small feather block. */
export interface WingsLook {
  a: string;
  b: string;
}

export type WardrobeTab = 'skins' | 'wings';

export interface LookCard {
  id: string;
  name: string;
  /** The figure on the card: a skin, or the skin on with these wings. */
  skin: SkinLook;
  wings: WingsLook | null;
  state: 'on' | 'owned' | 'buy' | 'short' | 'locked';
  /** Trophy price («40»), the «N more» text while short, the source of a locked look («Tier 3»). */
  price?: string | undefined;
  need?: string | undefined;
  source?: string | undefined;
}

export interface WardrobePanelModel {
  tab: WardrobeTab;
  /** «2/12» per tab. */
  counts: Record<WardrobeTab, string>;
  trophies: string;
  current: SkinLook;
  currentWings: WingsLook | null;
  cards: LookCard[];
}

export interface WardrobePanelActions {
  tab(tab: WardrobeTab): void;
  buy(id: string): void;
  equip(id: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A block figure of the skin colours (head, torso, arms, legs) with optional wings; `big` — the turning hero. */
export function skinFigure(c: SkinLook, big = false, wings: WingsLook | null = null): HTMLElement {
  const fig = el('div', big ? 'fig big' : 'fig');
  if (wings) {
    for (const side of ['L', 'R'] as const) {
      const w = el('span', `fig-wing${side}`);
      w.style.background = `linear-gradient(${wings.a} 0 60%, ${wings.b} 60%)`;
      fig.appendChild(w);
    }
  }
  for (const [part, color] of [['head', c.head], ['torso', c.torso], ['armL', c.armL], ['armR', c.armR], ['legL', c.legL], ['legR', c.legR]] as const) {
    const p = el('span', `fig-${part}`);
    p.style.background = color;
    fig.appendChild(p);
  }
  return fig;
}

export function renderWardrobePanel(body: HTMLElement, head: HTMLElement, m: WardrobePanelModel, a: WardrobePanelActions): void {
  const balance = trophyPrice(m.trophies);
  balance.dataset['role'] = 'wardrobe-trophies';
  head.appendChild(balance);
  const tabs = el('div', 'win-tabs');
  for (const id of ['skins', 'wings'] as const) {
    const tab = el('button', id === m.tab ? 'win-tab on' : 'win-tab', `${t(`wardrobe.tab.${id}`)} ${m.counts[id]}`);
    tab.dataset['hud'] = `wardrobe-tab-${id}`;
    tab.addEventListener('click', () => a.tab(id));
    tabs.appendChild(tab);
  }
  head.appendChild(tabs);
  const row = el('div', 'wardrobe');
  const stage = el('div', 'wardrobe-stage');
  stage.dataset['role'] = 'wardrobe-hero';
  stage.appendChild(skinFigure(m.current, true, m.currentWings));
  const grid = el('div', 'win-grid');
  grid.dataset['role'] = 'wardrobe-grid';
  for (const c of m.cards) {
    const card = el('div', c.state === 'on' ? 'card on' : c.state === 'locked' ? 'card locked' : 'card');
    card.dataset[m.tab === 'skins' ? 'skin' : 'wings'] = c.id;
    card.append(skinFigure(c.skin, false, c.wings), el('span', 'card-name', c.name));
    let btn: HTMLButtonElement | null = null;
    if (c.state === 'on') btn = el('button', 'card-btn off', t('shop.equipped'));
    else if (c.state === 'owned') {
      btn = el('button', 'card-btn', t('btn.equip'));
      btn.addEventListener('click', () => a.equip(c.id));
    } else if (c.state === 'locked') {
      const lock = el('span', 'card-lock');
      lock.dataset['role'] = 'look-source';
      const i = el('span', '');
      i.innerHTML = icon('lock');
      lock.append(i, el('span', '', c.source ?? ''));
      card.appendChild(lock);
    } else {
      card.appendChild(trophyPrice(c.price ?? ''));
      btn = el('button', c.state === 'short' ? 'card-btn off' : 'card-btn', c.state === 'short' ? (c.need ?? '') : t('btn.buy'));
      if (c.state === 'buy') btn.addEventListener('click', () => a.buy(c.id));
    }
    if (btn) {
      btn.dataset['hud'] = 'wardrobe-item';
      card.appendChild(btn);
    }
    grid.appendChild(card);
  }
  row.append(stage, grid);
  body.appendChild(row);
}
