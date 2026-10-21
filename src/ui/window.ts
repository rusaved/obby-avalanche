// What: Window frame: one modal window at a time over a 50% veil, a 48 px close cross, a bottom next button, body re-rendered by refresh().
// Called by: main.ts, app/handles.ts and the app/* views cosmetics, daily, footsteps, pets, quests, rebirth.
// Keep: Opened only by a player's button; never a dead end (docs/03 GD-05): close cross or next button always present; onChange pauses game and avalanche; data-hud on both.

import { icon } from './icons.ts';

/**
 * Window frame (docs/01-gdd.md 10.2): one window at a time over a 50% veil, opened only by a player's button;
 * closes by the 48 px cross at the top right, a tap on the veil or Esc (the caller routes Esc to `close`).
 * `onChange` tells the caller to pause the game and the avalanche while a window is open (pause reason `menu`).
 * Never a dead end (docs/03 GD-05; GDD-11): a «next» button at the bottom («OK» by default), or the window's own one
 * marked `data-next` («Continue», «Next», «Later», «Stay»). The pause title shrinks to fit one line (LOC-04).
 */
export interface WindowOptions {
  /** Caption of the «next» button at the bottom (default «OK», it closes); false — the body has its own `data-next`. */
  next?: string | false;
  /** The «next» button pressed (default: close). */
  onNext?: () => void;
  /** The window stops being the open one (closed, or another window opened over it). */
  onClose?: () => void;
  /** The title stays on one line: its font shrinks down to 14 px, never cut (docs/01-gdd.md 10.2, pause). */
  fitTitle?: boolean;
  /** MU-07 (docs/07-mobile-ui.md, rule 13): the line under the title (what the window is, the balance it spends). */
  sub?: string;
  /** MU-07: the panel width — 640 cards, 560 lists, 480 summaries and «More» (default 560). */
  size?: 'cards' | 'list' | 'summary';
  /** MU-07: false — no cross (a window with a single way out, «Mountain cleared»: «Next»). */
  closable?: boolean;
}

export interface WindowFrame {
  /** Id of the open window, null when none is open. */
  readonly current: string | null;
  /** Opens window `id`: `render` fills the body (called again by `refresh`). */
  open(id: string, title: string, render: (body: HTMLElement, head: HTMLElement) => void, opts?: WindowOptions): void;
  /** Re-renders the open window (after a purchase, an equip). */
  refresh(): void;
  close(): void;
}

export interface WindowFrameOptions {
  /** MU-07: the phone layout — a window without its own «next» has no «OK» at the bottom (the cross closes it). */
  mu?: boolean;
  closeLabel: string;
  /** Default caption of the «next» button («OK»). */
  okLabel: string;
  onChange(id: string | null): void;
}

/** MU-08: the width of the windows of the second wave (docs/07-mobile-ui.md, rule 13): cards 640, summaries 480. */
const SIZE_OF: Record<string, 'cards' | 'list' | 'summary'> = {
  shop: 'cards',
  pets: 'cards',
  wardrobe: 'cards',
  daily: 'cards',
  rebirth: 'cards',
  timeRewards: 'cards',
  newPet: 'summary',
  allDone: 'summary',
  communityGift: 'summary',
};

/** MU round 3: the lower edge of a scrolling middle stands this far over a control or a line it would cut (px). */
const EDGE_GAP = 1;
/** …and never comes higher than this (one row of 44 px): a middle that cannot keep it scrolls as it is. */
const EDGE_MIN = 44;
/** MU round 4: the lists of the middle — their items are its cards and rows (the same as the snap rows, styles.css). */
const LISTS = '.win-grid, .foot-grid, .qs-list, .gf-cards, .gf-tiles, .dl-cards, .tr-grid, .rb-cols, .pause-grid, .more-grid, .tp-list';
/** The shortest bar of the rail (px). */
const RAIL_THUMB_MIN = 16;
/** The rail is as wide as its circle and stands on the right border of the panel (px). */
const RAIL_W = 28;

export function createWindowFrame(host: HTMLElement, opts: WindowFrameOptions): WindowFrame {
  const dim = document.createElement('div');
  dim.className = 'dim win';
  dim.dataset['role'] = 'window';
  const panel = document.createElement('div');
  panel.className = 'panel win-panel';
  const top = document.createElement('div');
  top.className = 'win-top';
  const title = document.createElement('h1');
  title.className = 'panel-title win-title';
  const heading = document.createElement('div');
  heading.className = 'win-heading';
  const sub = document.createElement('div');
  sub.className = 'win-sub';
  sub.dataset['role'] = 'win-sub';
  heading.append(title, sub);
  const head = document.createElement('div');
  head.className = 'win-head';
  const close = document.createElement('button');
  close.className = 'win-close';
  close.dataset['hud'] = 'win-close';
  close.setAttribute('aria-label', opts.closeLabel);
  close.innerHTML = icon('close');
  top.append(heading, head, close);
  const body = document.createElement('div');
  body.className = 'win-body';
  // MU-13: the middle scrolls under a finger (the input manager lets a touch move there).
  body.dataset['scroll'] = '1';
  const foot = document.createElement('div');
  foot.className = 'win-foot';
  const next = document.createElement('button');
  next.className = 'btn-primary win-next';
  next.dataset['hud'] = 'win-next';
  next.dataset['next'] = '1';
  foot.appendChild(next);
  // MU round 3 (producer 19.10: buttons cut at 815 × 290 and at 130 %, the chevron on a button, no scrollbar on Android):
  // rows marked `data-pin` and the button rows `.rb-btns` stand under the middle, never scrolled away; the middle shows
  // its scroll on the right edge of the panel — a bar in its padding and a chevron in a circle on its border — never over
  // the content and never taking its width.
  const pin = document.createElement('div');
  pin.className = 'win-pin';
  const rail = document.createElement('div');
  rail.className = 'win-rail';
  rail.dataset['role'] = 'win-rail';
  const track = document.createElement('div');
  track.className = 'win-track';
  const thumb = document.createElement('div');
  thumb.className = 'win-thumb';
  track.appendChild(thumb);
  const cue = document.createElement('div');
  cue.className = 'win-cue';
  cue.dataset['role'] = 'win-cue';
  cue.innerHTML = icon('chevron');
  rail.append(track, cue);
  rail.hidden = true;
  pin.hidden = true;
  panel.append(top, body, pin, foot);
  dim.append(panel, rail);
  host.appendChild(dim);

  // MU round of fixes 2 (staff: a blue «Buy» on every card): one blue button in a window — its main button if it has
  // one, else the first card button that can be pressed; the other card buttons are quiet.
  const oneAccent = (): void => {
    const main = !foot.hidden || !!body.querySelector('.btn-primary');
    let kept = main;
    for (const b of Array.from(body.querySelectorAll<HTMLButtonElement>('.card-btn'))) {
      if (b.matches('.quiet, .alt, .ok, .off, :disabled')) continue;
      if (kept) b.classList.add('quiet');
      kept = true;
    }
  };
  // MU round of fixes 2: `data-more` while the middle has more below. Round 3: the bar of the rail follows the scroll.
  const markMore = (): void => {
    body.style.setProperty('--win-body-h', `${body.clientHeight}px`);
    const room = body.scrollHeight - body.clientHeight;
    body.toggleAttribute('data-more', room - body.scrollTop > 2);
    if (!opts.mu) return;
    const scrolls = body.classList.contains('win-scrolls');
    rail.hidden = !scrolls;
    if (!scrolls) return;
    const d = dim.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const b = body.getBoundingClientRect();
    rail.style.left = `${p.right - d.left - RAIL_W / 2}px`;
    rail.style.top = `${b.top - d.top}px`;
    rail.style.height = `${b.height}px`;
    rail.classList.toggle('more', room - body.scrollTop > 2);
    const h = track.clientHeight;
    const size = Math.max(RAIL_THUMB_MIN, Math.round((h * body.clientHeight) / Math.max(1, body.scrollHeight)));
    thumb.style.height = `${size}px`;
    thumb.style.transform = `translateY(${Math.round(((h - size) * body.scrollTop) / Math.max(1, room))}px)`;
  };
  /** Line boxes of the text, the boxes of the controls and of the cards with a control in the middle, in its scroll
   * coordinates. */
  const atoms = (): { lines: Array<[number, number]>; controls: Array<[number, number]>; cards: Array<[number, number]> } => {
    const base = body.getBoundingClientRect().top - body.scrollTop;
    const lines: Array<[number, number]> = [];
    const controls: Array<[number, number]> = [];
    // MU round 4 (producer 20.10: «Buy» of an egg and «Release» of a pet under the edge): a card — an item of a list of
    // the middle, or a row of its own — is seen whole with its button or not at all.
    const cards: Array<[number, number]> = [];
    for (const u of Array.from(body.querySelectorAll<HTMLElement>(`:scope > *, :scope :is(${LISTS}) > *`))) {
      // MU round 4 (reviews: a row of locked sneakers cut in the middle): every item of a list is a card; a row of its own
      // counts when it holds a control.
      if (u.matches(`:is(${LISTS})`) || u.querySelector(`:is(${LISTS})`) || (u.parentElement === body && !u.querySelector('button, input, select'))) continue;
      const r = u.getBoundingClientRect();
      if (r.height > 0 && r.width > 0) cards.push([r.top - base, r.bottom - base]);
    }
    const range = document.createRange();
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!(n.textContent ?? '').trim()) continue;
      range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) if (r.height > 0) lines.push([r.top - base, r.bottom - base]);
    }
    for (const c of Array.from(body.querySelectorAll<HTMLElement>('button, input, select'))) {
      const r = c.getBoundingClientRect();
      if (r.height > 0 && r.width > 0) controls.push([r.top - base, r.bottom - base]);
    }
    return { lines, controls, cards };
  };
  /** MU round 3: the panel is as tall as its content up to the visible height minus 16 px a side (CSS); when the middle
   * scrolls, its lower edge goes up from the room it has to a place that cuts no control and no line of text — a gap
   * between rows or the edge of the next row (the room is never less than a row of 44 px). */
  const fitMiddle = (): void => {
    if (!opts.mu || current === null) return;
    body.style.maxHeight = '';
    body.classList.remove('win-scrolls');
    panel.classList.remove('win-tall');
    if (body.scrollHeight - body.clientHeight <= 1) return;
    body.classList.add('win-scrolls');
    // MU round 5 (producer 21.10: at 815 × 290 and 130 % the window stood in the middle with 40–90 px empty around it and
    // hid the second row): a window longer than the screen is as tall as the visible height minus 8 px a side; the edge
    // chosen below shortens the middle inside the panel, never the panel.
    panel.classList.add('win-tall');
    // MU round 4: the edge in the coordinates of the list as it stands (a snap may have moved it a few px).
    const top = body.scrollTop;
    const room = top + body.clientHeight;
    const { lines, controls, cards } = atoms();
    /** The lowest edge up from the room that crosses none of `boxes`. */
    const clear = (boxes: Array<[number, number]>): number => {
      let edge = Math.floor(room);
      for (let i = 0; i < 64; i++) {
        let up = edge;
        for (const [a, b] of boxes) if (a < edge - 0.5 && b > edge + 0.1) up = Math.min(up, Math.floor(a - EDGE_GAP));
        if (up >= edge) break;
        edge = up;
      }
      return edge;
    };
    // No card with a control, no control and no line cut; a middle too dense for that cuts no control at least.
    let edge = clear([...cards, ...controls, ...lines]);
    // A card taller than the room: none would be seen — the edge falls back to cutting no control and no line.
    if (edge - top < EDGE_MIN || (cards.length > 0 && !cards.some(([a, b]) => a >= top - 0.5 && b <= edge + 0.5))) edge = clear([...controls, ...lines]);
    if (edge - top < EDGE_MIN) edge = clear(controls);
    if (edge - top < EDGE_MIN) edge = room;
    body.style.maxHeight = `${edge - top}px`;
    // Rows snap under the tabs pinned at the top of the middle.
    const tabs = body.querySelector<HTMLElement>(':scope > .win-tabs');
    // MU round 4: without tabs the first row snaps where it stands at the top (its margin) — else the snap scrolls the
    // list by that margin and the next row peeks under the edge chosen above.
    const first = body.firstElementChild;
    const lead = first ? first.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop : 0;
    body.style.scrollPaddingTop = `${tabs ? tabs.offsetHeight : Math.max(0, Math.round(lead))}px`;
  };
  /** MU round 4 (a 130 % text under load: a line cut once in a few runs): a frame later the edge is checked where the list
   * stands now — a line or a control across it fits the middle again (once). */
  const cutNow = (): boolean => {
    if (!opts.mu || current === null || !body.classList.contains('win-scrolls')) return false;
    const { lines, controls } = atoms();
    const lo = body.scrollTop;
    const hi = lo + body.clientHeight;
    return [...controls, ...lines].some(([a, b]) => b > lo + 0.5 && a < hi - 0.5 && b > hi + 0.5);
  };
  let recheck = 0;
  const fit = (): void => {
    fitMiddle();
    markMore();
    cancelAnimationFrame(recheck);
    recheck = requestAnimationFrame(() => {
      if (cutNow()) {
        fitMiddle();
        markMore();
      }
    });
  };
  body.addEventListener('scroll', markMore, { passive: true });
  const watch = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;

  let current: string | null = null;
  let render: ((body: HTMLElement, head: HTMLElement) => void) | null = null;
  let options: WindowOptions = {};
  /** Title font: 18 px, down to 14 px while it does not fit one line. */
  const fitTitle = (): void => {
    title.style.fontSize = '';
    if (!options.fitTitle) return;
    for (let px = 18; px >= 14 && title.scrollWidth > title.clientWidth; px--) title.style.fontSize = `${px}px`;
  };
  const leave = (): void => {
    const fn = options.onClose;
    options = {};
    fn?.();
  };
  const frame: WindowFrame = {
    get current() {
      return current;
    },
    open(id, text, fn, o = {}) {
      const was = current;
      if (was !== null) leave();
      current = id;
      render = fn;
      options = o;
      dim.dataset['window'] = id;
      dim.dataset['size'] = o.size ?? SIZE_OF[id] ?? 'list';
      title.textContent = text;
      title.classList.toggle('fit', !!o.fitTitle);
      sub.textContent = o.sub ?? '';
      close.hidden = o.closable === false;
      foot.hidden = o.next === false || (!!opts.mu && o.next === undefined);
      next.textContent = typeof o.next === 'string' ? o.next : opts.okLabel;
      frame.refresh();
      dim.classList.add('open');
      body.scrollTop = 0;
      fit();
      fitTitle();
      if (was !== id) opts.onChange(id);
    },
    refresh() {
      if (!render) return;
      const scroll = body.scrollTop;
      body.replaceChildren();
      head.replaceChildren();
      pin.replaceChildren();
      render(body, head);
      if (opts.mu) {
        oneAccent();
        for (const p of Array.from(body.querySelectorAll<HTMLElement>('[data-pin], :scope > .rb-btns'))) pin.appendChild(p);
      }
      pin.hidden = pin.childElementCount === 0;
      body.scrollTop = scroll;
      if (watch) {
        watch.disconnect();
        watch.observe(dim);
        watch.observe(body);
        watch.observe(pin);
        for (const c of Array.from(body.children)) watch.observe(c);
      }
      fit();
    },
    close() {
      if (current === null) return;
      current = null;
      render = null;
      delete dim.dataset['window'];
      dim.classList.remove('open');
      leave();
      // onClose may open the next window (the shop after «New pet»): the game stays paused then.
      if (current === null) opts.onChange(null);
    },
  };
  close.addEventListener('click', () => frame.close());
  next.addEventListener('click', () => (options.onNext ? options.onNext() : frame.close()));
  dim.addEventListener('pointerdown', (ev) => {
    if (ev.target === dim && options.closable !== false) frame.close();
  });
  return frame;
}
