// What: Renders the calendar window body: 7 reward cards (past ticked, today glowing, future locked) and the Claim button or the next-reward timer; exports rewardIcon.
// Called by: app/daily-view.ts; ui/quests-panel.ts and ui/summit-panel.ts (rewardIcon).
// Keep: Pure view over DailyPanelModel, no game rules; data-role/data-hud hooks daily-card, daily-claim, daily-next are used by e2e/daily.spec.ts.

/**
 * Calendar window body (docs/01-gdd.md 7.6, 10.2): 7 cards in a row (4 + 3 on a phone) — past ones with a tick, today's
 * bigger and glowing, future ones with a lock; «Claim» while today's reward waits, otherwise «Next reward in 14:20».
 */
import { icon } from './icons.ts';

/** MU round 4: the smallest font a day's name gets to fit its card (px). */
const DAY_NAME_MIN = 9;

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

/** Round of fixes MU (art review: filled and line marks mixed in one window): the phone layout draws the rewards and
 * the locks in line marks — set once at boot. */
let lineMarks = false;
const LINE: Record<string, string> = { wardrobe: 'shirt', gift: 'giftLine', trophy: 'cup', pets: 'paw', iceBolt: 'bolt', calendar: 'calendarLine', shop: 'bag', lock: 'padlock' };
export function setLineMarks(on: boolean): void {
  lineMarks = on;
}
/** The mark `id`, its line twin on the phone layout. */
export function markIcon(id: string): string {
  return icon(lineMarks ? (LINE[id] ?? id) : id);
}

/** A reward picture: an icon of the set, or the coin snowflake of the HUD plaque. */
export function rewardIcon(id: string): HTMLElement {
  const i = el('span', `rw-icon rw-${id}`);
  i.innerHTML = markIcon(id);
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
      mark.innerHTML = markIcon(c.state === 'past' ? 'check' : 'lock');
      card.appendChild(mark);
    }
    row.appendChild(card);
  }
  body.appendChild(row);
  const foot = el('div', 'rb-btns dl-foot');
  if (m.claim) {
    const b = el('button', 'btn-primary rb-go ok', m.claim);
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
  // MU round 4 (producer 20.10: 7 days in a row at any size; reviews: «»» alone on a line at 130 %): on the phone a name
  // wider than its card gets a smaller font, half a pixel at a time, never a word broken in two.
  if (typeof ResizeObserver !== 'undefined' && body.closest('#ui.mu')) {
    const fit = (): void => {
      for (const n of Array.from(row.querySelectorAll<HTMLElement>('.card-name'))) {
        let px = Number.parseFloat(getComputedStyle(n).fontSize);
        for (let i = 0; i < 12 && n.scrollWidth > n.clientWidth + 0.5 && px > DAY_NAME_MIN; i++) {
          px -= 0.5;
          n.style.fontSize = `${px}px`;
        }
      }
    };
    const ro = new ResizeObserver(() => row.isConnected && fit());
    for (const n of Array.from(row.querySelectorAll<HTMLElement>('.card-name'))) ro.observe(n);
  }
  // A name wider than its card (one long word at a large text size of the phone): 4 + 3 cards, not a word cut in two.
  if (typeof ResizeObserver !== 'undefined' && !body.closest('#ui.mu')) {
    const ro = new ResizeObserver(() => {
      if (!row.isConnected) return;
      // A name wider than the inside of its card (its padding kept, MU round 3: «Skin "Penguin"» ran 1.5 px into it).
      const inner = (e: HTMLElement | null): number => (e ? e.clientWidth - Number.parseFloat(getComputedStyle(e).paddingLeft) - Number.parseFloat(getComputedStyle(e).paddingRight) : 0);
      // A word longer than its line shows in scrollWidth, not in offsetWidth.
      if (Array.from(row.querySelectorAll<HTMLElement>('.card-name')).some((n) => Math.max(n.offsetWidth, n.scrollWidth) > inner(n.parentElement) + 1)) {
        row.classList.add('dl-fit4');
        // MU round of fixes 2 (staff: at 130 % day 7 was under the fold): «Take» in the free eighth cell of 4 + 3. MU round 3
        // (reviews: at 815 × 290 that cell went under the edge of the scrolling middle): a «Take» standing under the
        // middle of the phone window (window.ts, `win-pin`) stays there.
        if (!foot.parentElement?.classList.contains('win-pin')) row.appendChild(foot);
        ro.disconnect();
      }
    });
    ro.observe(row);
    // MU round 3 (full verify: under load a name grown by a larger text went unseen — the row kept its size): the names too.
    for (const n of Array.from(row.querySelectorAll<HTMLElement>('.card-name'))) ro.observe(n);
  }
}
