/**
 * Quests window and time rewards window with the lucky wheel (docs/01-gdd.md 7.7, 7.8, 7.13; 10.2). Quests: a row per
 * quest with its bar «2/3» and «Claim» once done, the bonus row for all three, the timer to new quests. Time rewards:
 * 8 tiles 4 × 2, each with its timer or «Claim»; below — the wheel of 8 equal sectors with the free spin of the day.
 */
import { icon } from './icons.ts';
import { rewardIcon } from './daily-panel.ts';

export interface QuestRow {
  text: string;
  progress: string;
  frac: number;
  state: 'run' | 'ready' | 'got';
}

export interface QuestsPanelModel {
  rows: QuestRow[];
  bonus: { text: string; state: 'run' | 'ready' | 'got' };
  claim: string;
  next: string;
}

export interface TimeTile {
  at: string;
  name: string;
  icon: string;
  /** Timer text while running; «Claim» shows when ready. */
  timer: string;
  state: 'run' | 'ready' | 'got';
}

export interface TimePanelModel {
  played: string;
  tiles: TimeTile[];
  claim: string;
  wheel: { title: string; sectors: Array<{ name: string; icon: string }>; hit: number | null; spin: string | null; next: string | null };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function stateEnd(state: 'run' | 'ready' | 'got', claim: string, hud: string, onClaim: () => void, extra?: HTMLElement): HTMLElement {
  if (state === 'ready') {
    const b = el('button', 'card-btn', claim);
    b.dataset['hud'] = hud;
    b.addEventListener('click', onClaim);
    return b;
  }
  if (state === 'got') {
    const m = el('span', 'qs-got');
    m.innerHTML = icon('check');
    return m;
  }
  return extra ?? el('span', '');
}

export function renderQuestsPanel(body: HTMLElement, m: QuestsPanelModel, a: { claim(i: number): void; bonus(): void }): void {
  const list = el('div', 'qs-list');
  m.rows.forEach((r, i) => {
    const row = el('div', `qs-row ${r.state}`);
    row.dataset['role'] = 'quest';
    row.dataset['state'] = r.state;
    const main = el('div', 'qs-main');
    const bar = el('div', 'qs-bar');
    const fill = el('div', 'qs-fill');
    fill.style.width = `${Math.round(Math.min(1, r.frac) * 100)}%`;
    bar.append(fill, el('span', 'qs-num', r.progress));
    main.append(el('div', 'qs-text', r.text), bar);
    row.append(main, stateEnd(r.state, m.claim, `quest-claim-${i}`, () => a.claim(i)));
    list.appendChild(row);
  });
  const bonus = el('div', `qs-row qs-bonus ${m.bonus.state}`);
  bonus.dataset['role'] = 'quest-bonus';
  bonus.dataset['state'] = m.bonus.state;
  bonus.append(el('div', 'qs-text', m.bonus.text), stateEnd(m.bonus.state, m.claim, 'quest-bonus', a.bonus));
  list.appendChild(bonus);
  body.appendChild(list);
  const next = el('div', 'dl-next qs-next', m.next);
  next.dataset['role'] = 'quests-next';
  body.appendChild(next);
}

export function renderTimePanel(body: HTMLElement, head: HTMLElement, m: TimePanelModel, a: { claim(i: number): void; spin(): void }): void {
  const played = el('span', 'tr-played', m.played);
  played.dataset['role'] = 'time-played';
  head.appendChild(played);
  const grid = el('div', 'tr-grid');
  m.tiles.forEach((tile, i) => {
    const card = el('div', `card tr-tile ${tile.state}`);
    card.dataset['role'] = 'time-tile';
    card.dataset['state'] = tile.state;
    card.append(el('span', 'card-sub', tile.at), rewardIcon(tile.icon), el('span', 'card-name', tile.name));
    card.appendChild(stateEnd(tile.state, m.claim, `time-claim-${i}`, () => a.claim(i), el('span', 'tr-timer', tile.timer)));
    grid.appendChild(card);
  });
  body.appendChild(grid);
  const wheel = el('div', 'wh');
  wheel.dataset['role'] = 'wheel';
  wheel.appendChild(el('div', 'rb-head', m.wheel.title));
  const ring = el('div', 'wh-ring');
  m.wheel.sectors.forEach((s, i) => {
    const sec = el('div', `wh-sector${m.wheel.hit === i ? ' hit' : ''}`);
    sec.dataset['role'] = 'wheel-sector';
    sec.append(rewardIcon(s.icon), el('span', 'wh-name', s.name));
    ring.appendChild(sec);
  });
  wheel.appendChild(ring);
  const foot = el('div', 'rb-btns dl-foot');
  if (m.wheel.spin) {
    const b = el('button', 'btn-primary rb-go', m.wheel.spin);
    b.dataset['hud'] = 'wheel-spin';
    b.addEventListener('click', a.spin);
    foot.appendChild(b);
  }
  if (m.wheel.next) {
    const n = el('span', 'dl-next', m.wheel.next);
    n.dataset['role'] = 'wheel-next';
    foot.appendChild(n);
  }
  wheel.appendChild(foot);
  body.appendChild(wheel);
}
