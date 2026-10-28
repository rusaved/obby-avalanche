// What: K-04 the start menu of the VK and OK build — «Play · Sound on/off · Help» (and the settings) in the common window frame, open at launch and from the pause button or the menu button of any window; «Help» — how to play in 4 lines and the community (VK) or group (OK) as the support channel with the join button.
// Called by: main.ts (VK build only, behind __PLATFORM__ === 'vk').
// Keep: texts from content/vk.json by site (OK never names VK and back); no link at all (K-10: VK 4.2.3, OK 5.1 — VK's own documents); the window frame holds the `menu` pause while it is open.

import type { WindowFrame } from './window.ts';
import type { VkSite } from '../platform/types.ts';
import { vkText } from '../content/vk.ts';

export const VK_MENU = 'vkmenu';

export interface VkMenuDeps {
  site: VkSite;
  windows: WindowFrame;
  title: string;
  sound(): boolean;
  setSound(on: boolean): void;
  openSettings(): void;
  /** K-08: the join button — null when the community id is not filled (no button); `done` — the gift is taken. */
  join: { done(): boolean; press(): Promise<void> } | null;
}

export interface VkMenu {
  open(page?: 'main' | 'help'): void;
}

const button = (cls: string, action: string, text: string): HTMLButtonElement => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.dataset['vk'] = action;
  b.textContent = text;
  return b;
};

export function createVkMenu(d: VkMenuDeps): VkMenu {
  const vt = (key: string): string => vkText(d.site, key);
  let page: 'main' | 'help' = 'main';
  const render = (body: HTMLElement): void => {
    body.replaceChildren();
    const box = document.createElement('div');
    box.className = `vk-menu vk-${page}`;
    box.dataset['role'] = 'vk-menu';
    box.dataset['page'] = page;
    if (page === 'main') {
      const play = button('btn-primary vk-play', 'play', vt('menu.play'));
      play.dataset['next'] = '1';
      play.addEventListener('click', () => d.windows.close());
      const row = document.createElement('div');
      row.className = 'vk-row';
      const sound = button('card-btn vk-btn', 'sound', vt(d.sound() ? 'menu.soundOn' : 'menu.soundOff'));
      sound.setAttribute('aria-pressed', String(d.sound()));
      sound.addEventListener('click', () => {
        d.setSound(!d.sound());
        d.windows.refresh();
      });
      const help = button('card-btn vk-btn', 'help', vt('menu.help'));
      help.addEventListener('click', () => show('help'));
      const settings = button('card-btn vk-btn', 'settings', vt('menu.settings'));
      settings.addEventListener('click', () => d.openSettings());
      row.append(sound, help, settings);
      box.append(play, row);
    } else {
      const how = document.createElement('ul');
      how.className = 'vk-how';
      for (const k of ['help.how1', 'help.how2', 'help.how3', 'help.how4']) {
        const li = document.createElement('li');
        li.textContent = vt(k);
        how.appendChild(li);
      }
      const side = document.createElement('div');
      side.className = 'vk-side';
      const support = document.createElement('p');
      support.className = 'vk-support';
      support.textContent = vt('help.support');
      side.appendChild(support);
      if (d.join) {
        const j = d.join;
        const b = j.done() ? button('card-btn vk-btn off', 'joined', vt('join.done')) : button('card-btn vk-btn', 'join', vt('join.button'));
        if (j.done()) b.setAttribute('aria-disabled', 'true');
        else b.addEventListener('click', () => void j.press().then(() => d.windows.refresh()));
        side.appendChild(b);
      }
      const back = button('btn-primary vk-back', 'back', vt('help.back'));
      back.dataset['next'] = '1';
      back.addEventListener('click', () => show('main'));
      side.appendChild(back);
      box.append(how, side);
    }
    body.appendChild(box);
  };
  // R-05 («Лавина 23»): «Help» has its own title «How to play»; the menu the game's.
  const show = (p: 'main' | 'help'): void => {
    page = p;
    d.windows.open(VK_MENU, p === 'help' ? vt('help.title') : d.title, render, { next: false, size: 'summary' });
  };
  return {
    open(p = 'main') {
      show(p);
    },
  };
}

/** K-07: «Loading N%» under the spinner (index.html of the VK build has the line); the number never goes back. */
export function bootProgress(site: VkSite, n: number): void {
  const p = document.querySelector<HTMLElement>('[data-boot-progress]');
  if (!p) return;
  const pct = Math.max(Number(p.dataset['bootProgress'] || 0), Math.min(100, Math.round(n)));
  p.dataset['bootProgress'] = String(pct);
  p.textContent = vkText(site, 'boot.loading', { n: pct });
}
