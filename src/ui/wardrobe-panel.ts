/**
 * Wardrobe window body (docs/01-gdd.md 7.4, 10.2): the hero large and slowly turning in the skin on, the «Skins» tab
 * with the counter and the cards. One default skin at M3-04; the other skins, wings and their sources — M3-04b.
 */
import { t } from './i18n.ts';

export interface SkinLook {
  head: string;
  torso: string;
  armL: string;
  armR: string;
  legL: string;
  legR: string;
}

export interface SkinCard {
  id: string;
  name: string;
  colors: SkinLook;
  on: boolean;
}

export interface WardrobePanelModel {
  /** «Skins 1/12». */
  count: string;
  current: SkinLook;
  skins: SkinCard[];
}

export interface WardrobePanelActions {
  equip(id: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A block figure of the skin colours (head, torso, arms, legs); `big` — the turning hero of the window. */
export function skinFigure(c: SkinLook, big = false): HTMLElement {
  const fig = el('div', big ? 'fig big' : 'fig');
  for (const [part, color] of [['head', c.head], ['torso', c.torso], ['armL', c.armL], ['armR', c.armR], ['legL', c.legL], ['legR', c.legR]] as const) {
    const p = el('span', `fig-${part}`);
    p.style.background = color;
    fig.appendChild(p);
  }
  return fig;
}

export function renderWardrobePanel(body: HTMLElement, head: HTMLElement, m: WardrobePanelModel, a: WardrobePanelActions): void {
  const tabs = el('div', 'win-tabs');
  const tab = el('button', 'win-tab on', `${t('wardrobe.tab.skins')} ${m.count}`);
  tab.dataset['hud'] = 'wardrobe-tab-skins';
  tabs.appendChild(tab);
  head.appendChild(tabs);
  const row = el('div', 'wardrobe');
  const stage = el('div', 'wardrobe-stage');
  stage.dataset['role'] = 'wardrobe-hero';
  stage.appendChild(skinFigure(m.current, true));
  const grid = el('div', 'win-grid');
  grid.dataset['role'] = 'wardrobe-grid';
  for (const s of m.skins) {
    const card = el('div', s.on ? 'card on' : 'card');
    card.dataset['skin'] = s.id;
    card.append(skinFigure(s.colors), el('span', 'card-name', s.name));
    const btn = el('button', s.on ? 'card-btn off' : 'card-btn', s.on ? t('shop.equipped') : t('btn.equip'));
    btn.dataset['hud'] = 'wardrobe-equip';
    if (!s.on) btn.addEventListener('click', () => a.equip(s.id));
    card.appendChild(btn);
    grid.appendChild(card);
  }
  row.append(stage, grid);
  body.appendChild(row);
}
