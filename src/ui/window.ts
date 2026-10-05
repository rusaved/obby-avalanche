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
  closeLabel: string;
  /** Default caption of the «next» button («OK»). */
  okLabel: string;
  onChange(id: string | null): void;
}

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
  const head = document.createElement('div');
  head.className = 'win-head';
  const close = document.createElement('button');
  close.className = 'win-close';
  close.dataset['hud'] = 'win-close';
  close.setAttribute('aria-label', opts.closeLabel);
  close.textContent = '✕';
  top.append(title, head, close);
  const body = document.createElement('div');
  body.className = 'win-body';
  const foot = document.createElement('div');
  foot.className = 'win-foot';
  const next = document.createElement('button');
  next.className = 'btn-primary win-next';
  next.dataset['hud'] = 'win-next';
  next.dataset['next'] = '1';
  foot.appendChild(next);
  panel.append(top, body, foot);
  dim.appendChild(panel);
  host.appendChild(dim);

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
      title.textContent = text;
      title.classList.toggle('fit', !!o.fitTitle);
      foot.hidden = o.next === false;
      next.textContent = typeof o.next === 'string' ? o.next : opts.okLabel;
      frame.refresh();
      dim.classList.add('open');
      body.scrollTop = 0;
      fitTitle();
      if (was !== id) opts.onChange(id);
    },
    refresh() {
      if (!render) return;
      const scroll = body.scrollTop;
      body.replaceChildren();
      head.replaceChildren();
      render(body, head);
      body.scrollTop = scroll;
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
    if (ev.target === dim) frame.close();
  });
  return frame;
}
