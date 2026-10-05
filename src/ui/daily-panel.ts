/**
 * Calendar window body (docs/01-gdd.md 7.6, 10.2): 7 cards in a row (4 + 3 on a phone) — past ones with a tick, today's
 * bigger and glowing, future ones with a lock; «Claim» while today's reward waits, otherwise «Next reward in 14:20».
 */
import { icon } from './icons.ts';

export interface DailyCard {
  day: string;
  name: string;
  icon: string;
  state: 'past' | 'today' | 'future';
}

export interface DailyPanelModel {
  cards: DailyCard[];
  /** Today's reward waits: the «Claim» button (its caption). */
  claim: string | null;
  /** «Next reward in 14:20» when today's reward is taken. */
  next: string | null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A reward picture: an icon of the set, or the coin snowflake of the HUD plaque. */
export function rewardIcon(id: string): HTMLElement {
  const i = el('span', `rw-icon rw-${id}`);
  if (id === 'coins') i.textContent = '❄';
  else i.innerHTML = icon(id);
  return i;
}

export function renderDailyPanel(body: HTMLElement, m: DailyPanelModel, claim: () => void): void {
  const row = el('div', 'dl-cards');
  for (const c of m.cards) {
    const card = el('div', `card dl-card ${c.state}`);
    card.dataset['role'] = 'daily-card';
    card.dataset['state'] = c.state;
    card.append(el('span', 'card-sub', c.day), rewardIcon(c.icon), el('span', 'card-name', c.name));
    if (c.state !== 'today') {
      const mark = el('span', 'dl-mark');
      mark.innerHTML = icon(c.state === 'past' ? 'check' : 'lock');
      card.appendChild(mark);
    }
    row.appendChild(card);
  }
  body.appendChild(row);
  const foot = el('div', 'rb-btns dl-foot');
  if (m.claim) {
    const b = el('button', 'btn-primary rb-go', m.claim);
    b.dataset['hud'] = 'daily-claim';
    b.addEventListener('click', claim);
    foot.appendChild(b);
  }
  if (m.next) {
    const n = el('span', 'dl-next', m.next);
    n.dataset['role'] = 'daily-next';
    foot.appendChild(n);
  }
  body.appendChild(foot);
}
