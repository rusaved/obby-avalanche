// What: Renders the «Footsteps» window body (w4-footsteps): the volume slider on its own line and five cards of one height — a coloured «listen» circle, «Selected», «Choose», or a lock with the price and «To the shop».
// Called by: app/footsteps-view.ts.
// Keep: Pure view over FootstepsPanelModel; texts via t(), names from i18n footsteps.set.<id>; the ad button text carries the word of 03 2.3 («Реклама»); the slider applies on input without a re-render; buying is in the shop (MU-12), never here.

/**
 * «Footsteps» window body (LV-09, docs/01-gdd.md 11): the volume of the steps on its own slider, applied at once; the
 * sets as cards — an open one has «Choose» («Selected» when on; a tap chooses and plays it), one by an ad has the
 * rewarded button, one of the shop its trophy price with «Buy» (SD-14) or «N more» while short — as the wardrobe; a shop
 * set with no price a lock with «From the shop» (no «soon»: a dev trace, docs/03 4.2).
 */
import { t } from './i18n.ts';
import { icon, setRich } from './icons.ts';

export interface FootstepCard {
  id: string;
  /** `on` — the set on; `open` — can be chosen; `ad` — opens by an ad (`busy` — the ad is running); `locked` — not
   * bought yet (MU-07: its price and «To the shop», the purchase is in the shop, MU-12) or a gift of the calendar. */
  state: 'on' | 'open' | 'ad' | 'busy' | 'locked';
  /** The colour of the set's circle (sfx.json). */
  color?: string;
  /** Locked: the price with its currency mark («{trophy} 3»), or the condition («Calendar · day 2»). */
  price?: string;
  lock?: string;
}

export interface FootstepsPanelModel {
  /** Volume of the steps, 0–1. */
  volume: number;
  cards: FootstepCard[];
}

export interface FootstepsPanelActions {
  choose(id: string): void;
  ad(id: string): void;
  /** MU-07: listen to a set (any, bought or not). */
  preview(id: string): void;
  /** MU-12: a set not bought — its card leads to the «Steps» tab of the shop. */
  toShop(id: string): void;
  /** The slider moved (`done` — released: the preview plays). */
  volume(v: number, done: boolean): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

const percent = (v: number): string => `${Math.round(v * 100)}\u202f%`;

/** A round «listen» button in the colour of the set (w4-footsteps). */
/**
 * MU round 3 (D50: the sets of steps drawn one way in «Footsteps» and another in «Shop → Steps»): the bottom of a card of
 * a set — «✓ Chosen», or the padlock with its price or condition, then a button — one look in both windows.
 */
export function stepEnd(o: { chosen?: boolean; lock?: string | HTMLElement; button?: HTMLElement | undefined }): HTMLElement {
  const foot = el('div', 'foot-end');
  if (o.chosen) {
    const on = el('span', 'foot-chosen');
    on.dataset['hud'] = 'footsteps-chosen';
    const tick = el('span', 'mark');
    tick.innerHTML = icon('tick');
    on.append(tick, t('footsteps.chosen'));
    foot.appendChild(on);
  }
  if (o.lock !== undefined) {
    const line = el('span', 'foot-lock');
    const lock = el('span', 'mark');
    lock.innerHTML = icon('padlock');
    const text = el('span', '');
    if (typeof o.lock === 'string') setRich(text, o.lock);
    else text.appendChild(o.lock);
    line.append(lock, text);
    foot.appendChild(line);
  }
  if (o.button) foot.appendChild(o.button);
  return foot;
}

export function playButton(color: string | undefined, onPlay: () => void): HTMLButtonElement {
  const b = el('button', 'foot-play');
  b.dataset['hud'] = 'footsteps-play';
  if (color) b.style.background = color;
  // MU round 5: a note — what it does is listen.
  b.innerHTML = icon('note');
  b.setAttribute('aria-label', t('footsteps.listen'));
  b.addEventListener('click', onPlay);
  return b;
}

export function renderFootstepsPanel(body: HTMLElement, m: FootstepsPanelModel, a: FootstepsPanelActions): void {
  // The volume of the steps on its own line (w4-footsteps).
  const row = el('div', 'foot-vol');
  const slider = el('input', 'foot-slider');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.step = '5';
  slider.value = String(Math.round(m.volume * 100));
  slider.dataset['hud'] = 'footsteps-volume';
  slider.setAttribute('aria-label', t('footsteps.volume'));
  const value = el('span', 'foot-value', percent(m.volume));
  value.dataset['role'] = 'footsteps-volume';
  const read = (): number => Number(slider.value) / 100;
  const paint = (): void => slider.style.setProperty('--fill', `${slider.value}%`);
  paint();
  slider.addEventListener('input', () => {
    value.textContent = percent(read());
    paint();
    a.volume(read(), false);
  });
  slider.addEventListener('change', () => a.volume(read(), true));
  row.append(el('span', 'foot-label', t('footsteps.volume')), slider, value);
  body.appendChild(row);

  const grid = el('div', 'foot-grid');
  grid.dataset['role'] = 'footsteps-grid';
  for (const c of m.cards) {
    const card = el('div', c.state === 'on' ? 'card foot-card on' : c.state === 'locked' ? 'card foot-card locked' : 'card foot-card');
    card.dataset['footsteps'] = c.id;
    card.dataset['state'] = c.state;
    card.append(playButton(c.color, () => a.preview(c.id)), el('span', 'card-name', t(`footsteps.set.${c.id}`)));
    let foot: HTMLElement;
    if (c.state === 'on') foot = stepEnd({ chosen: true });
    else if (c.state === 'locked') {
      let btn: HTMLElement | undefined;
      if (c.price) {
        btn = el('button', 'card-btn quiet', t('footsteps.toShop'));
        btn.dataset['hud'] = 'footsteps-shop';
        btn.addEventListener('click', () => a.toShop(c.id));
      }
      foot = stepEnd({ lock: c.price ?? c.lock ?? '', button: btn });
    } else {
      const ad = c.state === 'ad' || c.state === 'busy';
      const btn = el('button', ad ? 'card-btn' : 'card-btn quiet');
      setRich(btn, t(ad ? 'footsteps.ad' : 'footsteps.choose'));
      btn.dataset['hud'] = ad ? 'footsteps-ad' : 'footsteps-choose';
      btn.disabled = c.state === 'busy';
      btn.addEventListener('click', () => (ad ? a.ad(c.id) : a.choose(c.id)));
      foot = stepEnd({ button: btn });
    }
    card.appendChild(foot);
    grid.appendChild(card);
  }
  body.appendChild(grid);
}
