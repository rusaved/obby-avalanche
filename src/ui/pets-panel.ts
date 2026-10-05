/**
 * The «Pets» window body (docs/01-gdd.md 7.2, 10.2): 3 slots on top, the grid of up to 30 pets sorted by bonus,
 * «Equip best», and on every card «Equip / Unequip / Release» (release asks first). Texts from i18n, numbers ready.
 */
import { t } from './i18n.ts';

export interface PetCard {
  /** Index in the inventory (save.pets). */
  index: number;
  name: string;
  /** «+10% per step». */
  bonus: string;
  color: string;
  accent: string;
  /** Rarity colour of the rim (theme.json rarity). */
  rim: string;
  on: boolean;
}

export interface PetsPanelModel {
  /** «Pets 4/27», «Equipped 2/3», «Total: ×1.65». */
  count: string;
  slots: string;
  total: string;
  /** Pets on, in slot order, then the grid sorted by bonus. */
  on: PetCard[];
  cards: PetCard[];
  slotCount: number;
  /** The card that asks «Release this pet?» now (inventory index), or null. */
  asking: number | null;
}

export interface PetsPanelActions {
  equip(index: number): void;
  unequip(index: number): void;
  /** First tap asks, the second (yes) releases; `no` cancels. */
  askRelease(index: number | null): void;
  release(index: number): void;
  equipBest(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(text: string, hud: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', `card-btn ${cls}`.trim(), text);
  b.dataset['hud'] = hud;
  b.addEventListener('click', onClick);
  return b;
}

/** A block pet face in CSS: the pet colour, dark eyes, an accent nose. */
export function petFace(color: string, accent: string): HTMLElement {
  const face = el('span', 'card-pet');
  face.style.background = color;
  const nose = el('span', 'card-pet-nose');
  nose.style.background = accent;
  face.appendChild(nose);
  return face;
}

export function renderPetsPanel(body: HTMLElement, head: HTMLElement, m: PetsPanelModel, a: PetsPanelActions): void {
  const count = el('span', '', m.count);
  count.dataset['role'] = 'pets-count';
  head.append(count);

  const row = el('div', 'win-row');
  const slots = el('div', 'slots');
  for (let i = 0; i < m.slotCount; i++) {
    const slot = el('div', 'slot');
    const card = m.on[i];
    if (card) slot.appendChild(petFace(card.color, card.accent));
    slots.appendChild(slot);
  }
  row.append(slots, el('span', '', m.slots), el('span', '', m.total));
  if (m.cards.length > 0) row.appendChild(button(t('btn.equipBest'), 'pets-best', () => a.equipBest()));
  body.appendChild(row);

  if (m.cards.length === 0) {
    body.appendChild(el('p', 'win-row', t('pets.empty')));
    return;
  }
  const grid = el('div', 'win-grid');
  grid.dataset['role'] = 'pets-grid';
  for (const c of m.cards) {
    const card = el('div', c.on ? 'card on' : 'card');
    card.dataset['pet'] = String(c.index);
    card.style.setProperty('--rim', c.rim);
    card.append(petFace(c.color, c.accent), el('span', 'card-name', c.name), el('span', 'card-sub', c.bonus));
    const btns = el('div', 'card-btns');
    if (m.asking === c.index) {
      btns.append(el('span', 'card-sub', t('pets.releaseAsk')), button(t('btn.yes'), 'pet-yes', () => a.release(c.index)), button(t('btn.no'), 'pet-no', () => a.askRelease(null), 'alt'));
    } else {
      if (c.on) btns.appendChild(button(t('btn.unequip'), 'pet-unequip', () => a.unequip(c.index), 'alt'));
      else btns.appendChild(button(t('btn.equip'), 'pet-equip', () => a.equip(c.index), m.on.length >= m.slotCount ? 'off' : ''));
      btns.appendChild(button(t('btn.release'), 'pet-release', () => a.askRelease(c.index), 'alt'));
    }
    card.appendChild(btns);
    grid.appendChild(card);
  }
  body.appendChild(grid);
}
