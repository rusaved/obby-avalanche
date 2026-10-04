/**
 * HUD at M1 (docs/01-gdd.md 10.1, docs/02-tech.md 6.3): touch stick visual, jump button (≥ 18% of the short side),
 * pause button, pause/settings panel with the auto-run toggle, keys hint on PC. Buttons carry data-hud so a touch on
 * them never starts the stick. The full HUD (stat, coins, goal, wave) arrives at M2–M3.
 */
import { t } from './i18n.ts';
import type { StickState } from '../input/types.ts';

export interface HudOptions {
  jumpButtonFrac: number;
  onJumpDown: () => void;
  onPause: () => void;
  onContinue: () => void;
  onAutoRun: (on: boolean) => void;
  onQuality: (level: 'auto' | 'low' | 'medium' | 'high') => void;
}

export interface Hud {
  root: HTMLElement;
  setTouchMode(touch: boolean): void;
  setPaused(paused: boolean): void;
  setAutoRun(on: boolean): void;
  setQuality(level: 'auto' | 'low' | 'medium' | 'high'): void;
  updateStick(stick: StickState, fieldLeft: number, fieldTop: number): void;
  layout(width: number, height: number): void;
  showKeysHint(show: boolean): void;
  readonly jumpButton: HTMLButtonElement;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function createHud(host: HTMLElement, opts: HudOptions): Hud {
  const root = el('div', 'hud');
  root.dataset['role'] = 'hud';
  host.appendChild(root);

  const pauseBtn = el('button', 'hud-btn hud-pause', '‖');
  pauseBtn.dataset['hud'] = 'pause';
  pauseBtn.setAttribute('aria-label', t('btn.pause'));
  pauseBtn.addEventListener('pointerup', (ev) => {
    ev.preventDefault();
    opts.onPause();
  });
  root.appendChild(pauseBtn);

  const jumpButton = el('button', 'hud-btn hud-jump', '↑');
  jumpButton.dataset['hud'] = 'jump';
  jumpButton.setAttribute('aria-label', t('btn.jump'));
  jumpButton.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    opts.onJumpDown();
  });
  root.appendChild(jumpButton);

  const stickBase = el('div', 'hud-stick');
  stickBase.dataset['role'] = 'stick';
  const stickKnob = el('div', 'hud-stick-knob');
  stickBase.appendChild(stickKnob);
  root.appendChild(stickBase);

  const hint = el('div', 'hud-hint', t('howto.pc'));
  hint.dataset['role'] = 'keys-hint';
  root.appendChild(hint);

  // Pause and settings panel (docs/01-gdd.md 10.2): title is the game title (LOC-04), never a dead end.
  const dim = el('div', 'dim');
  dim.dataset['role'] = 'pause';
  const panel = el('div', 'panel');
  const title = el('h1', 'panel-title', t('game.title'));
  const sub = el('div', 'panel-sub', t('settings.title'));
  panel.append(title, sub);

  const row = (label: string, control: HTMLElement): HTMLElement => {
    const r = el('div', 'row');
    r.append(el('span', 'row-label', label), control);
    return r;
  };
  const toggle = (name: string, initial: boolean, onChange: (v: boolean) => void): HTMLButtonElement => {
    const b = el('button', 'toggle');
    b.dataset['hud'] = name;
    b.dataset['on'] = String(initial);
    b.textContent = initial ? t('settings.on') : t('settings.off');
    b.addEventListener('click', () => {
      const v = b.dataset['on'] !== 'true';
      b.dataset['on'] = String(v);
      b.textContent = v ? t('settings.on') : t('settings.off');
      onChange(v);
    });
    return b;
  };
  const autoRunToggle = toggle('autorun', false, (v) => opts.onAutoRun(v));
  const autoRow = row(`${t('settings.autorun')} · ${t('settings.autorunHint')}`, autoRunToggle);
  panel.appendChild(autoRow);

  const qualitySel = el('select', 'select');
  qualitySel.dataset['hud'] = 'quality';
  for (const q of ['auto', 'high', 'medium', 'low'] as const) {
    const o = document.createElement('option');
    o.value = q;
    o.textContent = t(`settings.q.${q}`);
    qualitySel.appendChild(o);
  }
  qualitySel.addEventListener('change', () => opts.onQuality(qualitySel.value as 'auto' | 'low' | 'medium' | 'high'));
  panel.appendChild(row(t('settings.quality'), qualitySel));

  const howto = el('div', 'howto');
  howto.append(el('p', '', t('howto.goal')), el('p', '', t('howto.pc')), el('p', '', t('howto.touch')));
  panel.appendChild(howto);

  const cont = el('button', 'btn-primary', t('btn.continue'));
  cont.dataset['hud'] = 'continue';
  cont.addEventListener('click', () => opts.onContinue());
  panel.appendChild(cont);
  dim.appendChild(panel);
  dim.addEventListener('pointerdown', (ev) => {
    if (ev.target === dim) opts.onContinue();
  });
  root.appendChild(dim);

  let touchMode = false;
  const hud: Hud = {
    root,
    jumpButton,
    setTouchMode(touch) {
      touchMode = touch;
      root.classList.toggle('touch', touch);
      hint.textContent = touch ? t('howto.touch') : t('howto.pc');
    },
    setPaused(paused) {
      dim.classList.toggle('open', paused);
    },
    setAutoRun(on) {
      autoRunToggle.dataset['on'] = String(on);
      autoRunToggle.textContent = on ? t('settings.on') : t('settings.off');
    },
    setQuality(level) {
      qualitySel.value = level;
    },
    updateStick(stick, fieldLeft, fieldTop) {
      if (!touchMode || !stick.active) {
        stickBase.style.opacity = '0';
        return;
      }
      stickBase.style.opacity = '1';
      stickBase.style.transform = `translate(${stick.originX - fieldLeft}px, ${stick.originY - fieldTop}px)`;
      stickKnob.style.transform = `translate(${stick.x - stick.originX}px, ${stick.y - stick.originY}px)`;
    },
    layout(width, height) {
      const short = Math.min(width, height);
      const size = Math.max(44, Math.round(short * opts.jumpButtonFrac));
      jumpButton.style.width = `${size}px`;
      jumpButton.style.height = `${size}px`;
      const btn = height < 420 ? 44 : 48;
      pauseBtn.style.width = `${btn}px`;
      pauseBtn.style.height = `${btn}px`;
      const r = Math.round(short * 0.12);
      stickBase.style.width = `${r * 2}px`;
      stickBase.style.height = `${r * 2}px`;
      stickBase.style.marginLeft = `${-r}px`;
      stickBase.style.marginTop = `${-r}px`;
    },
    showKeysHint(show) {
      hint.classList.toggle('hidden', !show);
    },
  };
  hud.setTouchMode(false);
  return hud;
}
