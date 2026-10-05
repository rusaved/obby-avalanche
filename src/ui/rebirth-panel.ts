/**
 * Rebirth window body (docs/01-gdd.md 7.5, 10.2; GDD-08): before the button it shows exactly what resets, what stays
 * and what the player gets (the step ×3: now → after, the tier reward card, more trophies), «Mountains get higher» in
 * small print, the coins hint with «To eggs», and the buttons «Rebirth» (inactive with the lock text until the summit
 * of the last mountain) and «Later». One screen without scrolling on 640×360. Also the «All mountains cleared!» body.
 */
import { t } from './i18n.ts';
import { icon } from './icons.ts';

export interface RebirthPanelModel {
  /** «Tier 1» — the tier after the rebirth. */
  tier: string;
  ready: boolean;
  /** «Reach the top of mountain 5 · Mountain 3/5» under the inactive button. */
  locked: string;
  /** «Every step ×3 forever: ×1 → ×3». */
  step: string;
  /** Looks of the next tier: name and a figure. */
  rewards: Array<{ name: string; figure: HTMLElement }>;
  /** Coins reach an egg: the hint (and «To eggs» when the game has a way there). */
  spendHint: boolean;
  toEggs: boolean;
}

export interface RebirthPanelActions {
  rebirth(): void;
  later(): void;
  toEggs(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A column «Will reset» / «You keep» / «You get»: heading and one line per item of the list text («a · b · c»). */
function column(kind: string, title: string, items: Array<string | HTMLElement>): HTMLElement {
  const col = el('div', `rb-col rb-${kind}`);
  col.dataset['role'] = `rebirth-${kind}`;
  col.appendChild(el('div', 'rb-head', title));
  const list = el('ul', 'rb-list');
  for (const it of items) {
    const li = el('li', '');
    if (typeof it === 'string') li.textContent = it;
    else li.appendChild(it);
    list.appendChild(li);
  }
  col.appendChild(list);
  return col;
}

const split = (text: string): string[] => text.split(' · ').map((s) => s.trim()).filter(Boolean);

export function renderRebirthPanel(body: HTMLElement, head: HTMLElement, m: RebirthPanelModel, a: RebirthPanelActions): void {
  const tier = el('span', 'rb-tier', m.tier);
  tier.dataset['role'] = 'rebirth-tier';
  head.appendChild(tier);

  const gets: Array<string | HTMLElement> = [m.step];
  for (const r of m.rewards) {
    const card = el('div', 'rb-reward');
    card.dataset['role'] = 'rebirth-reward';
    const text = el('div', 'rb-reward-text');
    text.append(el('span', 'card-sub', t('rebirth.reward')), el('span', 'card-name', r.name));
    card.append(r.figure, text);
    gets.push(card);
  }
  gets.push(t('rebirth.moreTrophies'));
  const cols = el('div', 'rb-cols');
  cols.append(column('resets', t('rebirth.resets'), split(t('rebirth.resetList'))), column('keeps', t('rebirth.keeps'), split(t('rebirth.keepList'))), column('gets', t('rebirth.gets'), gets));
  body.appendChild(cols);
  body.appendChild(el('div', 'rb-small', t('rebirth.higher')));

  if (m.spendHint) {
    const hint = el('div', 'rb-hint');
    hint.dataset['role'] = 'rebirth-hint';
    hint.appendChild(el('span', '', t('rebirth.spendHint')));
    if (m.toEggs) {
      const b = el('button', 'card-btn alt', t('btn.toEggs'));
      b.dataset['hud'] = 'rebirth-eggs';
      b.addEventListener('click', () => a.toEggs());
      hint.appendChild(b);
    }
    body.appendChild(hint);
  }

  const row = el('div', 'rb-btns');
  const go = el('button', m.ready ? 'card-btn rb-go' : 'card-btn rb-go off', t('btn.doRebirth'));
  go.dataset['hud'] = 'rebirth-do';
  go.disabled = !m.ready;
  if (m.ready) go.addEventListener('click', () => a.rebirth());
  const later = el('button', 'card-btn alt', t('btn.later'));
  later.dataset['hud'] = 'rebirth-later';
  later.dataset['next'] = '1';
  later.addEventListener('click', () => a.later());
  row.append(go, later);
  if (!m.ready) {
    const lock = el('span', 'card-lock rb-locked');
    lock.dataset['role'] = 'rebirth-locked';
    const i = el('span', '');
    i.innerHTML = icon('lock');
    lock.append(i, el('span', '', m.locked));
    row.appendChild(lock);
  }
  body.appendChild(row);
}

/** «All mountains cleared!» (docs/01-gdd.md 7.5; docs/03 GD-05): the text, «Rebirth» (opens the rebirth window) and «Stay». */
export function renderAllDonePanel(body: HTMLElement, a: { rebirth(): void; stay(): void }): void {
  body.appendChild(el('p', 'rb-text', t('allDone.text')));
  const row = el('div', 'rb-btns');
  const go = el('button', 'card-btn rb-go', t('btn.doRebirth'));
  go.dataset['hud'] = 'alldone-rebirth';
  go.addEventListener('click', () => a.rebirth());
  const stay = el('button', 'card-btn alt', t('btn.stay'));
  stay.dataset['hud'] = 'alldone-stay';
  stay.dataset['next'] = '1';
  stay.addEventListener('click', () => a.stay());
  row.append(go, stay);
  body.appendChild(row);
}
