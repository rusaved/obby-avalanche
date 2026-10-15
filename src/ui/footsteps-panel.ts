// What: Renders the «Footsteps» window body: the footsteps volume slider (0–100%) and a card per set — choose, «▶ Ad: unlock», or a lock «soon in the shop».
// Called by: app/footsteps-view.ts.
// Keep: Pure view over FootstepsPanelModel; texts via t(), names from i18n footsteps.set.<id>; the ad button text carries the word of 03 2.3 («Реклама»); the slider applies on input without a re-render.

/**
 * «Footsteps» window body (LV-09, docs/01-gdd.md 11): the volume of the steps on its own slider, applied at once; the
 * sets as cards — an open one has «Choose» («Selected» when on; a tap chooses and plays it), one by an ad has the
 * rewarded button, one of the shop a lock with «From the shop» (no «soon»: a dev trace, docs/03 4.2).
 */
import { t } from './i18n.ts';
import { icon } from './icons.ts';

export interface FootstepCard {
  id: string;
  /** `on` — the set on; `open` — can be chosen; `ad` — opens by an ad (`busy` — the ad is running); `shop` — locked. */
  state: 'on' | 'open' | 'ad' | 'busy' | 'shop';
}

export interface FootstepsPanelModel {
  /** Volume of the steps, 0–1. */
  volume: number;
  cards: FootstepCard[];
}

export interface FootstepsPanelActions {
  choose(id: string): void;
  ad(id: string): void;
  /** The slider moved (`done` — released: the preview plays). */
  volume(v: number, done: boolean): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

const percent = (v: number): string => `${Math.round(v * 100)}%`;

export function renderFootstepsPanel(body: HTMLElement, m: FootstepsPanelModel, a: FootstepsPanelActions): void {
  const row = el('div', 'row foot-vol');
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
  slider.addEventListener('input', () => {
    value.textContent = percent(read());
    a.volume(read(), false);
  });
  slider.addEventListener('change', () => a.volume(read(), true));
  const control = el('span', 'foot-control');
  control.append(slider, value);
  row.append(el('span', 'row-label', t('footsteps.volume')), control);
  body.appendChild(row);

  const grid = el('div', 'win-grid');
  grid.dataset['role'] = 'footsteps-grid';
  for (const c of m.cards) {
    const card = el('div', c.state === 'on' ? 'card on' : c.state === 'shop' ? 'card locked' : 'card');
    card.dataset['footsteps'] = c.id;
    card.dataset['state'] = c.state;
    const pic = el('span', 'foot-pic');
    pic.innerHTML = icon('soundOn');
    card.append(pic, el('span', 'card-name', t(`footsteps.set.${c.id}`)));
    if (c.state === 'shop') {
      const lock = el('span', 'card-lock');
      const i = el('span', '');
      i.innerHTML = icon('lock');
      lock.append(i, el('span', '', t('footsteps.soon')));
      card.appendChild(lock);
    } else {
      const ad = c.state === 'ad' || c.state === 'busy';
      const btn = el('button', c.state === 'on' ? 'card-btn alt' : c.state === 'busy' ? 'card-btn off' : 'card-btn', t(ad ? 'footsteps.ad' : c.state === 'on' ? 'footsteps.chosen' : 'footsteps.choose'));
      btn.dataset['hud'] = ad ? 'footsteps-ad' : 'footsteps-choose';
      btn.disabled = c.state === 'busy';
      btn.addEventListener('click', () => (ad ? a.ad(c.id) : a.choose(c.id)));
      card.appendChild(btn);
    }
    grid.appendChild(card);
  }
  body.appendChild(grid);
}
