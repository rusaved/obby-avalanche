/**
 * HUD at M1 (docs/01-gdd.md 10.1, docs/02-tech.md 6.3): touch stick visual, jump button (≥ 18% of the short side),
 * pause button, pause/settings panel with the auto-run toggle, keys hint on PC. Buttons carry data-hud so a touch on
 * them never starts the stick. Coin plaque from the first coin (M2-04); the rest of the HUD (stat, goal, wave) at M2–M3.
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
  /** Coin plaque colour (theme.json ui.coins). */
  coinColor: string;
  /** Avalanche colour for the banner outline, frost frame and cave arrow (theme.json threat.front[1]). */
  threatColor: string;
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
  /** «+N» floating up from a field position in px (docs/01-gdd.md 10.3); the caller limits the rate. */
  popGain(text: string, x: number, y: number): void;
  /** Coin plaque (docs/01-gdd.md 6.4, 10.1): hidden until the first coin, then slides in from the left and stays. */
  setCoins(text: string): void;
  /** «Avalanche in N» at the top centre (docs/01-gdd.md 4.8); null hides it. */
  setWaveBanner(text: string | null): void;
  /** Frost frame at the screen edges: 0 off, warn ≈ 0.4, front near 1 (docs/01-gdd.md 4.8). */
  setFrost(level: number): void;
  /** Arrow at the field edge towards the lit cave when it is off screen (x, y in px, angle in rad); null hides it. */
  setCaveArrow(arrow: { x: number; y: number; angle: number } | null): void;
  /** Short toast in the middle («Phew, made it! +15», «Snowed in!»); `gold` for the bigger golden one later. */
  toast(text: string, sec?: number): void;
  /** Soft white veil when the camera is inside the snow body (docs/02-tech.md 7). */
  setVeil(on: boolean): void;
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

  // Coins under the Speed plaque (docs/01-gdd.md 10.1): a coin with a snowflake and the number.
  const coins = el('div', 'hud-coins');
  coins.dataset['role'] = 'coins';
  coins.setAttribute('aria-label', t('hud.coins'));
  coins.style.setProperty('--coins', opts.coinColor);
  const coinIcon = el('span', 'hud-coin-icon', '\u2744');
  const coinValue = el('span', 'hud-coin-value', '0');
  coins.append(coinIcon, coinValue);
  root.appendChild(coins);

  // Avalanche (docs/01-gdd.md 4.8): banner, frost frame, arrow to the cave, toast, veil. Never red (docs/03, 3.2).
  root.style.setProperty('--threat', opts.threatColor);
  const frost = el('div', 'hud-frost');
  frost.dataset['role'] = 'frost';
  const veil = el('div', 'hud-veil');
  veil.dataset['role'] = 'veil';
  const banner = el('div', 'hud-wave');
  banner.dataset['role'] = 'wave-banner';
  const arrow = el('div', 'hud-cave-arrow', '\u27a4');
  arrow.dataset['role'] = 'cave-arrow';
  const toastEl = el('div', 'hud-toast');
  toastEl.dataset['role'] = 'toast';
  root.append(frost, veil, banner, arrow, toastEl);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  const hint = el('div', 'hud-hint', t('howto.pc'));
  const gainPool = Array.from({ length: 4 }, () => el('div', 'hud-gain'));
  let gainNext = 0;
  hint.dataset['role'] = 'keys-hint';
  root.appendChild(hint);
  for (const node of gainPool) root.appendChild(node);

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
    setWaveBanner(text) {
      banner.classList.toggle('shown', text !== null);
      if (text !== null && banner.textContent !== text) banner.textContent = text;
    },
    setFrost(level) {
      const v = String(Math.round(Math.max(0, Math.min(1, level)) * 100) / 100);
      if (frost.style.opacity !== v) frost.style.opacity = v;
    },
    setCaveArrow(a) {
      arrow.classList.toggle('shown', a !== null);
      if (a) arrow.style.transform = `translate(${Math.round(a.x)}px, ${Math.round(a.y)}px) translate(-50%, -50%) rotate(${a.angle.toFixed(3)}rad)`;
    },
    toast(text, sec = 2) {
      toastEl.textContent = text;
      toastEl.classList.remove('shown');
      void toastEl.offsetWidth;
      toastEl.classList.add('shown');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('shown'), sec * 1000);
    },
    setVeil(on) {
      veil.classList.toggle('shown', on);
    },
    setCoins(text) {
      if (coinValue.textContent !== text) coinValue.textContent = text;
      coins.classList.add('shown');
    },
    popGain(text, x, y) {
      const node = gainPool[gainNext % gainPool.length]!;
      gainNext++;
      node.textContent = text;
      node.style.left = `${Math.round(x)}px`;
      node.style.top = `${Math.round(y)}px`;
      node.classList.remove('show');
      void node.offsetWidth; // restart the CSS animation
      node.classList.add('show');
    },
  };
  hud.setTouchMode(false);
  return hud;
}
