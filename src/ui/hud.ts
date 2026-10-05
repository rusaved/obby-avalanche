/**
 * HUD (docs/01-gdd.md 10.1, docs/02-tech.md 6.3): touch stick visual, jump button (≥ 18% of the short side),
 * pause and sound buttons, pause/settings panel with the auto-run toggle. Buttons carry data-hud so a touch on them
 * never starts the stick. Core HUD (M2-09): ice Speed plaque with the ice bolt, coin plaque under it (from the first
 * coin), mountain bar as a slope with wall and cave marks and the hero's face, the goal under it. Hint plaques, the
 * hand over the free egg and the shoes button (M2-08).
 */
import { t } from './i18n.ts';
import { icon } from './icons.ts';
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
  /** Golden gift colour (theme.json bonus.color, docs/01-gdd.md 4.9): the golden toast; absent — the plain one. */
  bonusColor?: string | undefined;
  /** «Shoes ×N · price» pressed (docs/01-gdd.md 6.2, 10.1): one tap buys. */
  onShoes: () => void;
  /** «Can» and «not yet» colours of the shoes button (theme.json ui.ok, ui.no). */
  okColor: string;
  /** Speed plaque colour and its icon id (theme.json ui.stat, ui.statIcon). */
  statColor: string;
  statIcon: string;
  /** Sound button pressed: the caller flips the setting and calls setSound. */
  onSound: () => void;
  /** A button of the right column pressed (docs/01-gdd.md 10.1: shop, pets, wardrobe …), by its id. */
  onMenu: (id: string) => void;
  /** The egg button over a stand pressed (docs/01-gdd.md 7.2). */
  onEgg: () => void;
  /** Trophy plaque colour (theme.json ui.trophies). */
  trophyColor: string;
}

/** A button of the right column: id, caption under the icon, icon id, optional counter on it («2/27»). */
export interface MenuItem {
  id: string;
  label: string;
  icon: string;
  badge?: string;
}

/** The egg button over a stand: «Snow Egg · 500», enough coins, its bottom centre in field px. */
export interface EggButtonState {
  text: string;
  can: boolean;
  x: number;
  y: number;
}

/** Mountain bar (docs/01-gdd.md 10.1): positions along the mountain are 0–1 from the camp to the summit. */
export interface MountainBar {
  zones: Array<{ from: number; to: number; color: string }>;
  walls: number[];
  caves: number[];
  /** Hero face picture (data URL) from the emotion atlas. */
  faceUrl: string;
}

/** Shoes button state: text, enough coins, share of the price collected (0–1). */
export interface ShoesButtonState {
  text: string;
  can: boolean;
  progress: number;
}

export interface Hud {
  root: HTMLElement;
  setTouchMode(touch: boolean): void;
  setAutoRun(on: boolean): void;
  setQuality(level: 'auto' | 'low' | 'medium' | 'high'): void;
  updateStick(stick: StickState, fieldLeft: number, fieldTop: number): void;
  layout(width: number, height: number): void;
  /**
   * Hint plaque near the hero (docs/01-gdd.md 6.5): `text` with an optional controls pictogram, its bottom edge at
   * (x, y) in field px; null hides it. One plaque at a time.
   */
  /** `urgent` (the wave hints): the plaque stays over a toast and the toast waits (one message near the hero at a time). */
  setHint(hint: { text: string; pict: 'keys' | 'stick' | null; x: number; y: number; urgent?: boolean } | null): void;
  /** Hand icon above the free egg (hint.egg, no text); null hides it. */
  setHand(pos: { x: number; y: number } | null): void;
  /** «Shoes ×N · price» at the bottom centre; null hides it (docs/01-gdd.md 6.4: shows from the first time coins suffice). */
  setShoes(state: ShoesButtonState | null): void;
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
  /** Short toast in the middle («Phew, made it! +15», «Snowed in!»); `gold` — the bigger golden one (docs/01-gdd.md 4.9);
   * `sub` — a smaller second line (the collection counter of a hatch, M3-13). */
  toast(text: string, sec?: number, gold?: boolean, sub?: string): void;
  /** Soft white veil when the camera is inside the snow body (docs/02-tech.md 7). */
  setVeil(on: boolean): void;
  /** Speed plaque: the number and «+N per step» under it (docs/01-gdd.md 10.1). */
  setStat(value: string, perStep: string): void;
  /** «+N» flying up over the Speed plaque on a gain. */
  popStatGain(text: string): void;
  /** A round number of Speed (docs/01-gdd.md 10.3, M2-13): the plaque flashes, the number bounces. */
  flashStat(): void;
  /** Mountain bar: built once per mountain. */
  setMountain(bar: MountainBar): void;
  /** Per frame: «Mountain 1 · 7/12», hero position, the avalanche mark (null — none), the cave mark that blinks on warn (−1 — none). */
  updateMountain(label: string, hero: number, wave: number | null, blinkCave: number): void;
  /** Goal under the bar: «Wall 2K» with «1.2K/2K» and a fill bar; `progress` null — text only («Wall open!»). */
  setGoal(text: string, progress: { text: string; frac: number } | null): void;
  setSound(on: boolean): void;
  /** Right column under pause and sound (docs/01-gdd.md 10.1, 6.4): the buttons shown now, top to bottom; on a window
   * lower than 420 px the ones that do not fit go into «More» (button id `more`, the caller opens their window). */
  setMenu(items: readonly MenuItem[]): void;
  /** The egg button over the stand the hero stands at; null hides it. */
  setEggButton(state: EggButtonState | null): void;
  /** Trophy plaque under the coins (docs/01-gdd.md 6.4: from the first summit); null hides it. */
  setTrophies(text: string | null): void;
  readonly jumpButton: HTMLButtonElement;
  /** Body of the pause and settings window (the caller opens it in the window frame). */
  readonly pausePanel: HTMLElement;
}

/** Hint plaque band: its top never above this share of the field (top HUD band; below the wave banner while it shows), its bottom never below this one. */
const HINT_TOP_MIN = 0.24;
const HINT_TOP_WAVE = 0.34;
const HINT_BOTTOM_MAX = 0.78;

/** Short window (docs/01-gdd.md 10.1): below this height the column is icons 44 px, 6 px apart, ending above 72% H. */
const SHORT_H = 420;
const SHORT_BTN = 44;
const SHORT_GAP = 6;
const MENU_EDGE = 8;
const MENU_BOTTOM = 0.72;

/** The click a browser sends after a tap comes within this many ms of the finger lifting. */
const TAP_CLICK_MS = 800;

/** How long the Speed plaque keeps its flash class (the CSS animation is shorter). */
const STAT_FLASH_MS = 1200;
/** Toasts waiting for the avalanche banner to go (playtest M2), the oldest dropped past this. */
const TOAST_QUEUE_MAX = 3;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * A tap that opens a window must not press what the window puts under the finger (its cross sits where the pause
 * button was): the click the browser sends after the tap is dropped.
 */
function dropTapClick(): void {
  const until = performance.now() + TAP_CLICK_MS;
  const drop = (e: MouseEvent): void => {
    window.removeEventListener('click', drop, true);
    if (performance.now() > until) return;
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener('click', drop, true);
  setTimeout(() => window.removeEventListener('click', drop, true), TAP_CLICK_MS);
}

/** HUD buttons fire on pointerdown of their own finger (playtest M2: with the stick held, a second finger never got
 * its pointerup); a keyboard click (detail 0) still presses them. */
function onPress(b: HTMLElement, fn: () => void): void {
  b.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.pointerType === 'touch' || ev.pointerType === 'pen') dropTapClick();
    fn();
  });
  b.addEventListener('click', (ev) => {
    if (ev.detail === 0) fn();
  });
}

export function createHud(host: HTMLElement, opts: HudOptions): Hud {
  const root = el('div', 'hud');
  root.dataset['role'] = 'hud';
  host.appendChild(root);

  const pauseBtn = el('button', 'hud-btn hud-pause', '‖');
  pauseBtn.dataset['hud'] = 'pause';
  pauseBtn.setAttribute('aria-label', t('btn.pause'));
  onPress(pauseBtn, () => opts.onPause());
  root.appendChild(pauseBtn);

  const soundBtn = el('button', 'hud-btn hud-sound');
  soundBtn.dataset['hud'] = 'sound';
  soundBtn.setAttribute('aria-label', t('settings.sfx'));
  onPress(soundBtn, () => opts.onSound());
  root.appendChild(soundBtn);

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

  // Left column (docs/01-gdd.md 10.1): the ice Speed plaque, coins under it.
  const left = el('div', 'hud-left');
  root.appendChild(left);
  const stat = el('div', 'hud-stat');
  stat.dataset['role'] = 'stat';
  stat.setAttribute('aria-label', t('hud.speed'));
  stat.style.setProperty('--stat', opts.statColor);
  const statIcon = el('span', 'hud-stat-icon');
  statIcon.innerHTML = icon(opts.statIcon);
  const statBody = el('span', 'hud-stat-body');
  const statValue = el('span', 'hud-stat-value', '0');
  const statPer = el('span', 'hud-stat-per', '');
  statBody.append(statValue, statPer);
  const statGain = el('span', 'hud-stat-gain');
  stat.append(statIcon, statBody, statGain);
  left.appendChild(stat);

  // Mountain bar at the top centre: a slope rising left to right, zone colours, wall and cave marks, the hero's face.
  const mountain = el('div', 'hud-mountain');
  mountain.dataset['role'] = 'mountain';
  const mountainLabel = el('div', 'hud-mountain-label');
  const mountainBar = el('div', 'hud-mountain-bar');
  const mountainFlag = el('span', 'hud-mountain-flag');
  mountainFlag.innerHTML = icon('flag');
  const mountainHero = el('img', 'hud-mountain-hero');
  mountainHero.alt = '';
  const mountainWave = el('span', 'hud-mountain-wave');
  mountainWave.innerHTML = icon('wave');
  // The slope (zones, wall and cave marks) is clipped to a wedge; the hero, the flag and the wave sit on top unclipped.
  const mountainSlope = el('div', 'hud-mountain-slope');
  mountain.append(mountainLabel, mountainBar);
  mountainBar.append(mountainSlope, mountainFlag, mountainWave, mountainHero);
  root.appendChild(mountain);
  let caveMarks: HTMLElement[] = [];
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  let blinking = -1;

  // Goal under the bar: what next («Wall 2K» and «1.2K/2K»).
  const goal = el('div', 'hud-goal');
  goal.dataset['role'] = 'goal';
  const goalText = el('div', 'hud-goal-text');
  const goalBar = el('div', 'hud-goal-bar');
  const goalFill = el('span', 'hud-goal-fill');
  const goalNum = el('span', 'hud-goal-num');
  goalBar.append(goalFill, goalNum);
  goal.append(goalText, goalBar);
  root.appendChild(goal);

  // Coins under the Speed plaque (docs/01-gdd.md 10.1): a coin with a snowflake and the number.
  const coins = el('div', 'hud-coins');
  coins.dataset['role'] = 'coins';
  coins.setAttribute('aria-label', t('hud.coins'));
  coins.style.setProperty('--coins', opts.coinColor);
  const coinIcon = el('span', 'hud-coin-icon', '\u2744');
  const coinValue = el('span', 'hud-coin-value', '0');
  coins.append(coinIcon, coinValue);
  left.appendChild(coins);
  const trophies = el('div', 'hud-trophies');
  trophies.dataset['role'] = 'trophies';
  trophies.setAttribute('aria-label', t('hud.trophies'));
  trophies.style.setProperty('--trophies', opts.trophyColor);
  const trophyIcon = el('span', 'hud-trophy-icon');
  trophyIcon.innerHTML = icon('trophy');
  const trophyValue = el('span', 'hud-trophy-value', '0');
  trophies.append(trophyIcon, trophyValue);
  left.appendChild(trophies);

  // Right column (docs/01-gdd.md 10.1): shop, pets, wardrobe … under pause and sound, icon with a caption.
  const menu = el('div', 'hud-menu');
  menu.dataset['role'] = 'menu';
  root.appendChild(menu);
  let menuIds = '';
  const menuButtons = new Map<string, { badge: HTMLElement }>();
  let menuAll: readonly MenuItem[] = [];
  let menuSeen = false;

  // Egg button over a stand (docs/01-gdd.md 7.2): when the hero stands next to it.
  const eggBtn = el('button', 'hud-egg');
  eggBtn.dataset['hud'] = 'egg';
  eggBtn.style.setProperty('--ok', opts.okColor);
  onPress(eggBtn, () => opts.onEgg());
  root.appendChild(eggBtn);

  // Avalanche (docs/01-gdd.md 4.8): banner, frost frame, arrow to the cave, toast, veil. Never red (docs/03, 3.2).
  root.style.setProperty('--threat', opts.threatColor);
  if (opts.bonusColor) root.style.setProperty('--gold', opts.bonusColor);
  root.style.setProperty('--stat-goal', opts.statColor);
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
  const toastMain = el('span', 'hud-toast-main');
  const toastSub = el('span', 'hud-toast-sub');
  toastSub.dataset['role'] = 'toast-sub';
  toastEl.append(toastMain, toastSub);
  root.append(frost, veil, banner, arrow, toastEl);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingToasts: Array<{ text: string; sec: number; gold: boolean; sub: string | undefined }> = [];
  let currentToast: { text: string; sec: number; gold: boolean; sub: string | undefined } | null = null;
  const showToast = (text: string, sec: number, gold: boolean, sub: string | undefined): void => {
    currentToast = { text, sec, gold, sub };
    toastMain.textContent = text;
    toastSub.textContent = sub ?? '';
    toastEl.classList.toggle('gold', gold);
    toastEl.classList.remove('shown');
    void toastEl.offsetWidth;
    toastEl.classList.add('shown');
    // The hint plaque steps aside while a toast is up: one message near the hero at a time.
    root.classList.add('toasting');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastTimer = null;
      currentToast = null;
      toastEl.classList.remove('shown');
      root.classList.remove('toasting');
      const next = banner.classList.contains('shown') ? undefined : pendingToasts.shift();
      if (next) showToast(next.text, next.sec, next.gold, next.sub);
    }, sec * 1000);
  };

  // Hint plaque (docs/01-gdd.md 6.5): one line up to 5 words, optional pictogram of the controls (WASD and arrows or the stick).
  const hint = el('div', 'hud-hint');
  hint.dataset['role'] = 'hint';
  const hintText = el('span', 'hud-hint-text');
  const pictKeys = el('span', 'hud-pict hud-pict-keys');
  for (const k of ['W', 'A', 'S', 'D', '\u2191', '\u2190', '\u2193', '\u2192']) pictKeys.appendChild(el('span', 'hud-key', k));
  const pictStick = el('span', 'hud-pict hud-pict-stick');
  hint.append(hintText, pictKeys, pictStick);
  root.appendChild(hint);
  const hand = el('div', 'hud-hand');
  hand.dataset['role'] = 'hand';
  hand.innerHTML =
    '<svg viewBox="0 0 24 24" width="40" height="40"><path d="M9 11V4.5a1.5 1.5 0 0 1 3 0V10h.5V3.5a1.5 1.5 0 0 1 3 0V10h.5V5a1.5 1.5 0 0 1 3 0v8c0 4-2.5 7.5-7 7.5-3 0-4.6-1.4-6-3.6L3.3 13.6a1.4 1.4 0 0 1 2.2-1.8L7.5 14V7a1.5 1.5 0 0 1 3 0" fill="#fff" stroke="#1b2a3a" stroke-width="1.2"/></svg>';
  root.appendChild(hand);
  const gainPool = Array.from({ length: 4 }, () => el('div', 'hud-gain'));
  let gainNext = 0;
  for (const node of gainPool) root.appendChild(node);

  // Shoes button (docs/01-gdd.md 10.1): grey with a fill bar while coins are short, green with a shine when enough.
  const shoes = el('button', 'hud-shoes');
  shoes.dataset['hud'] = 'shoes';
  shoes.style.setProperty('--ok', opts.okColor);
  const shoesFill = el('span', 'hud-shoes-fill');
  const shoesText = el('span', 'hud-shoes-text');
  shoes.append(shoesFill, shoesText);
  onPress(shoes, () => {
    if (shoes.classList.contains('can')) opts.onShoes();
  });
  root.appendChild(shoes);

  // Pause and settings (docs/01-gdd.md 10.2): the body of the «pause» window of the common frame; the frame title is
  // the game title (LOC-04), «Pause» small under it; «Continue» is the window's «next» button.
  const pausePanel = el('div', 'pause-body');
  pausePanel.dataset['role'] = 'pause';
  pausePanel.appendChild(el('div', 'panel-sub', t('settings.title')));

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
  pausePanel.appendChild(autoRow);

  const qualitySel = el('select', 'select');
  qualitySel.dataset['hud'] = 'quality';
  for (const q of ['auto', 'high', 'medium', 'low'] as const) {
    const o = document.createElement('option');
    o.value = q;
    o.textContent = t(`settings.q.${q}`);
    qualitySel.appendChild(o);
  }
  qualitySel.addEventListener('change', () => opts.onQuality(qualitySel.value as 'auto' | 'low' | 'medium' | 'high'));
  pausePanel.appendChild(row(t('settings.quality'), qualitySel));

  const howto = el('div', 'howto');
  howto.append(el('p', '', t('howto.goal')), el('p', '', t('howto.pc')), el('p', '', t('howto.touch')));
  pausePanel.appendChild(howto);

  const cont = el('button', 'btn-primary', t('btn.continue'));
  cont.dataset['hud'] = 'continue';
  cont.dataset['next'] = '1';
  cont.addEventListener('click', () => opts.onContinue());
  pausePanel.appendChild(cont);

  let touchMode = false;
  let fieldW = 1;
  let fieldH = 1;
  const hud: Hud = {
    root,
    jumpButton,
    pausePanel,
    setTouchMode(touch) {
      touchMode = touch;
      root.classList.toggle('touch', touch);
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
      fieldW = width;
      fieldH = height;
      const short = Math.min(width, height);
      const size = Math.max(44, Math.round(short * opts.jumpButtonFrac));
      jumpButton.style.width = `${size}px`;
      jumpButton.style.height = `${size}px`;
      const btn = height < 420 ? 44 : 48;
      for (const b of [pauseBtn, soundBtn]) {
        b.style.width = `${btn}px`;
        b.style.height = `${btn}px`;
      }
      soundBtn.style.marginRight = `${btn + (height < 420 ? 6 : 8)}px`;
      menu.style.top = `${8 + btn + (height < 420 ? 6 : 8)}px`;
      root.classList.toggle('short', height < 420);
      hud.setMenu(menuAll);
      const r = Math.round(short * 0.12);
      stickBase.style.width = `${r * 2}px`;
      stickBase.style.height = `${r * 2}px`;
      stickBase.style.marginLeft = `${-r}px`;
      stickBase.style.marginTop = `${-r}px`;
    },
    setHint(h) {
      hint.classList.toggle('shown', h !== null);
      root.classList.toggle('urgent', h?.urgent === true);
      if (!h) return;
      if (hintText.textContent !== h.text) hintText.textContent = h.text;
      hint.dataset['pict'] = h.pict ?? '';
      // Inside the field, below the top HUD band and above the bottom buttons (docs/01-gdd.md 6.5: never over the HUD).
      const w = hint.offsetWidth;
      const hh = hint.offsetHeight;
      const x = Math.min(fieldW - w / 2 - 8, Math.max(w / 2 + 8, h.x));
      const top = banner.classList.contains('shown') ? HINT_TOP_WAVE : HINT_TOP_MIN;
      const y = Math.min(fieldH * HINT_BOTTOM_MAX, Math.max(fieldH * top + hh, h.y));
      hint.style.transform = `translate(${Math.round(x - w / 2)}px, ${Math.round(y - hh)}px)`;
    },
    setHand(pos) {
      hand.classList.toggle('shown', pos !== null);
      if (pos) hand.style.transform = `translate(${Math.round(pos.x)}px, ${Math.round(pos.y)}px) translate(-50%, -100%)`;
    },
    setShoes(state) {
      shoes.classList.toggle('shown', state !== null);
      if (!state) return;
      if (shoesText.textContent !== state.text) shoesText.textContent = state.text;
      shoes.classList.toggle('can', state.can);
      shoesFill.style.transform = `scaleX(${state.can ? 1 : Math.max(0, Math.min(1, state.progress)).toFixed(3)})`;
    },
    setWaveBanner(text) {
      const was = banner.classList.contains('shown');
      banner.classList.toggle('shown', text !== null);
      if (text !== null && banner.textContent !== text) banner.textContent = text;
      if (text !== null && toastTimer) {
        // A toast already up when the banner comes: it steps back into the queue, the banner speaks alone.
        clearTimeout(toastTimer);
        toastTimer = null;
        if (currentToast) pendingToasts.unshift(currentToast);
        if (pendingToasts.length > TOAST_QUEUE_MAX) pendingToasts.pop();
        currentToast = null;
        toastEl.classList.remove('shown');
        root.classList.remove('toasting');
      }
      if (was && text === null && !toastTimer) {
        const next = pendingToasts.shift();
        if (next) showToast(next.text, next.sec, next.gold, next.sub);
      }
    },
    setFrost(level) {
      const v = String(Math.round(Math.max(0, Math.min(1, level)) * 100) / 100);
      if (frost.style.opacity !== v) frost.style.opacity = v;
    },
    setCaveArrow(a) {
      arrow.classList.toggle('shown', a !== null);
      if (a) arrow.style.transform = `translate(${Math.round(a.x)}px, ${Math.round(a.y)}px) translate(-50%, -50%) rotate(${a.angle.toFixed(3)}rad)`;
    },
    toast(text, sec = 2, gold = false, sub) {
      // Never over the avalanche banner (playtest M2): it waits until the banner goes, the latest few in order.
      if (banner.classList.contains('shown')) {
        pendingToasts.push({ text, sec, gold, sub });
        if (pendingToasts.length > TOAST_QUEUE_MAX) pendingToasts.shift();
        return;
      }
      showToast(text, sec, gold, sub);
    },
    setVeil(on) {
      veil.classList.toggle('shown', on);
    },
    setCoins(text) {
      if (coinValue.textContent !== text) coinValue.textContent = text;
      coins.classList.add('shown');
    },
    setStat(value, perStep) {
      if (statValue.textContent !== value) statValue.textContent = value;
      if (statPer.textContent !== perStep) statPer.textContent = perStep;
    },
    flashStat() {
      stat.classList.remove('flash');
      void stat.offsetWidth;
      stat.classList.add('flash');
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => stat.classList.remove('flash'), STAT_FLASH_MS);
    },
    popStatGain(text) {
      statGain.textContent = text;
      statGain.classList.remove('show');
      void statGain.offsetWidth;
      statGain.classList.add('show');
    },
    setMountain(bar) {
      mountainSlope.replaceChildren();
      const pct = (f: number): string => `${(Math.max(0, Math.min(1, f)) * 100).toFixed(2)}%`;
      for (const z of bar.zones) {
        const n = el('span', 'hud-mz');
        n.style.left = pct(z.from);
        n.style.width = pct(z.to - z.from);
        n.style.background = z.color;
        mountainSlope.appendChild(n);
      }
      for (const w of bar.walls) {
        const n = el('span', 'hud-mwall');
        n.style.left = pct(w);
        mountainSlope.appendChild(n);
      }
      caveMarks = bar.caves.map((c) => {
        const n = el('span', 'hud-mcave');
        n.style.left = pct(c);
        mountainSlope.appendChild(n);
        return n;
      });
      blinking = -1;
      mountainHero.src = bar.faceUrl;
    },
    updateMountain(label, hero, wave, blinkCave) {
      if (mountainLabel.textContent !== label) mountainLabel.textContent = label;
      mountainHero.style.left = `${(Math.max(0, Math.min(1, hero)) * 100).toFixed(2)}%`;
      mountainWave.classList.toggle('shown', wave !== null);
      if (wave !== null) mountainWave.style.left = `${(Math.max(0, Math.min(1, wave)) * 100).toFixed(2)}%`;
      if (blinkCave !== blinking) {
        caveMarks[blinking]?.classList.remove('blink');
        caveMarks[blinkCave]?.classList.add('blink');
        blinking = blinkCave;
      }
    },
    setGoal(text, progress) {
      if (goalText.textContent !== text) goalText.textContent = text;
      goalBar.classList.toggle('shown', progress !== null);
      if (progress) {
        if (goalNum.textContent !== progress.text) goalNum.textContent = progress.text;
        goalFill.style.transform = `scaleX(${Math.max(0, Math.min(1, progress.frac)).toFixed(3)})`;
      }
    },
    setSound(on) {
      soundBtn.innerHTML = icon(on ? 'soundOn' : 'soundOff');
      soundBtn.dataset['on'] = String(on);
    },
    setMenu(items) {
      menuAll = items;
      // Short window (< 420 px): 3 icon buttons + «More» while they fit above 72% H, otherwise one less (10.1).
      let shown: readonly MenuItem[] = items;
      if (fieldH < SHORT_H) {
        const top = MENU_EDGE + SHORT_BTN + SHORT_GAP;
        const fit = Math.max(1, Math.floor((fieldH * MENU_BOTTOM - top + SHORT_GAP) / (SHORT_BTN + SHORT_GAP)));
        if (items.length > fit) {
          const more = items.slice(fit - 1);
          const badge = more.some((i) => i.badge === '!') ? '!' : '';
          shown = [...items.slice(0, fit - 1), { id: 'more', label: t('btn.more'), icon: 'more', badge }];
        }
      }
      // Rebuilt when a button comes or goes, or its caption or icon changes (the rebirth lock → «Rebirth», M3-06).
      const ids = shown.map((i) => `${i.id}:${i.label}:${i.icon}`).join(',');
      if (ids !== menuIds) {
        menuIds = ids;
        menu.replaceChildren();
        const before = new Set(menuButtons.keys());
        menuButtons.clear();
        for (const item of shown) {
          // A new button shines once (docs/01-gdd.md 6.4), never the ones already there at the start.
          const b = el('button', menuSeen && !before.has(item.id) ? 'hud-btn hud-menu-btn glow' : 'hud-btn hud-menu-btn');
          b.dataset['hud'] = `menu-${item.id}`;
          b.setAttribute('aria-label', item.label);
          const ic = el('span', 'hud-menu-icon');
          ic.innerHTML = icon(item.icon);
          const badge = el('span', 'hud-menu-badge');
          b.append(ic, el('span', 'hud-menu-label', item.label), badge);
          onPress(b, () => opts.onMenu(item.id));
          menu.appendChild(b);
          menuButtons.set(item.id, { badge });
        }
      }
      menuSeen = true;
      for (const item of shown) {
        const badge = menuButtons.get(item.id)?.badge;
        if (badge && badge.textContent !== (item.badge ?? '')) badge.textContent = item.badge ?? '';
      }
    },
    setEggButton(state) {
      eggBtn.classList.toggle('shown', state !== null);
      if (!state) return;
      if (eggBtn.textContent !== state.text) eggBtn.textContent = state.text;
      eggBtn.classList.toggle('can', state.can);
      eggBtn.style.transform = `translate(${Math.round(state.x)}px, ${Math.round(state.y)}px) translate(-50%, -100%)`;
    },
    setTrophies(text) {
      trophies.classList.toggle('shown', text !== null);
      if (text !== null && trophyValue.textContent !== text) trophyValue.textContent = text;
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
