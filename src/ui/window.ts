/**
 * Window frame (docs/01-gdd.md 10.2): one window at a time over a 50% veil, opened only by a player's button;
 * closes by the 48 px cross at the top right, a tap on the veil or Esc (the caller routes Esc to `close`).
 * `onChange` tells the caller to pause the game and the avalanche while a window is open (pause reason `menu`).
 * The windows of M3 (pets, shop, wardrobe) fill the body; the full set of windows arrives with M3-09.
 */
export interface WindowFrame {
  /** Id of the open window, null when none is open. */
  readonly current: string | null;
  /** Opens window `id`: `render` fills the body (called again by `refresh`). */
  open(id: string, title: string, render: (body: HTMLElement, head: HTMLElement) => void): void;
  /** Re-renders the open window (after a purchase, an equip). */
  refresh(): void;
  close(): void;
}

export interface WindowFrameOptions {
  closeLabel: string;
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
  panel.append(top, body);
  dim.appendChild(panel);
  host.appendChild(dim);

  let current: string | null = null;
  let render: ((body: HTMLElement, head: HTMLElement) => void) | null = null;
  const frame: WindowFrame = {
    get current() {
      return current;
    },
    open(id, text, fn) {
      const was = current;
      current = id;
      render = fn;
      dim.dataset['window'] = id;
      title.textContent = text;
      frame.refresh();
      dim.classList.add('open');
      body.scrollTop = 0;
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
      opts.onChange(null);
    },
  };
  close.addEventListener('click', () => frame.close());
  dim.addEventListener('pointerdown', (ev) => {
    if (ev.target === dim) frame.close();
  });
  return frame;
}
