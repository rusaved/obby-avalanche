// What: In-game HUD DOM: stick, jump/pause/sound buttons, Speed and coin plaques, mountain bar, goal, wave banner, hints, toasts, menu column, egg/shoes buttons.
// Called by: main.ts and 13 app/* modules (hud-view, wave-view, way-view, fun-view, ftue-view, rewards and the other views); tests/meta/*.
// Keep: data-hud elements never start the stick; buttons fire on pointerdown and drop the follow-up tap click; no balance numbers, texts or theme colours (HudOptions, t()).

/**
 * HUD (docs/01-gdd.md 10.1, docs/02-tech.md 6.3): touch stick visual, jump button (≥ 18% of the short side),
 * pause and sound buttons, pause/settings panel with the auto-run toggle. Buttons carry data-hud so a touch on them
 * never starts the stick. Core HUD (M2-09): ice Speed plaque with the ice bolt, coin plaque under it (from the first
 * coin), mountain bar as a slope with wall and cave marks and the hero's face, the goal under it. Hint plaques, the
 * hand over the free egg and the shoes button (M2-08).
 */
import { t } from './i18n.ts';
import { icon, setRich } from './icons.ts';
import { nudge } from './nudge.ts';
import type { StickState } from '../input/types.ts';

export interface HudOptions {
  jumpButtonFrac: number;
  onJumpDown: () => void;
  onPause: () => void;
  onContinue: () => void;
  /** The channels of the game by the side of the pause window (docs/01-gdd.md 19.10, Q-054): their ids in order
   * (telegram, vk), a button each; `open` — the press; absent or empty — no block. */
  community?: { ids: readonly string[]; open: (id: string) => void; gifts?: CommunityGiftCards };
  onAutoRun: (on: boolean) => void;
  onQuality: (level: 'auto' | 'low' | 'medium' | 'high') => void;
  /** «Footsteps» row of the pause window pressed (LV-09): the caller opens its window; absent — no row. */
  onFootsteps?: () => void;
  /** Coin plaque colour (theme.json ui.coins). */
  coinColor: string;
  /** Stages pace (docs/01-gdd.md 22.8, balance.json currency trophies): the coin plaque shows trophies. */
  coinsAsTrophies?: boolean;
  /** The teleport label of the camp tapped (docs/01-gdd.md 22.12). */
  onPadLabel?: () => void;
  /** Avalanche colour for the banner outline, frost frame and cave arrow (theme.json threat.front[1]). */
  threatColor: string;
  /** Golden gift colour (theme.json bonus.color, docs/01-gdd.md 4.9): the golden toast; absent — the plain one. */
  bonusColor?: string | undefined;
  /** «Shoes ×N · price» pressed (docs/01-gdd.md 6.2, 10.1): one tap buys. */
  onShoes: () => void;
  /** MU round 5: the shoes button pressed while short — it shakes, the caller says what is missing. */
  onShoesShort?: () => void;
  /** A «▶ Ad: …» button released (docs/01-gdd.md 9.1, 10.1): the id of its place (stat_now, continue_here, …). */
  onAd?: (id: string) => void;
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
  /** The button over a point of the base pressed (docs/01-gdd.md 19.3: the shop counter …); absent — none. */
  onStand?: () => void;
  /** Trophy plaque colour (theme.json ui.trophies). */
  trophyColor: string;
  /** Dark see-through plaque under the avalanche banner and the small arrows, and its text (theme.json ui.plaque,
   * ui.plaqueAlpha, ui.plaqueText; docs/01-gdd.md 16.7). */
  plaqueColor: string;
  plaqueAlpha: number;
  plaqueText: string;
  /** FM-04 (docs/01-gdd.md 19.8): the plaque under the toasts (theme.json ui.toastPlate); absent — no plaque. */
  toastPlate?: { bg: string; alpha: number; radius: number; padX: number; padY: number } | undefined;
  /** FM-04: «+N» size and dark outline (theme.json ui.gainText), in the Speed colour; absent — as before. */
  gainText?: { scale: number; outline: number } | undefined;
  /** FM-04: the arrow to the shelter this many times its old size (tuning avalanche.arrowScale); absent — 1. */
  arrowScale?: number | undefined;
  /** MU-02 (docs/07-mobile-ui.md): the phone layout of the mockups — counters in a row, the 2×2 column, the stage strip,
   * one message slot, «N Speed» over the bar; absent — the layout of docs/01-gdd.md 10.1 (the comparison paces). */
  mu?: boolean;
  /** The gift plaque under pause and sound pressed (docs/07-mobile-ui.md: the «Gifts» window). */
  onGift?: () => void;
  /** MU-07 (w3-pause): the «Sounds» slider moved (0–1) and its value at the start. */
  onVolume?: (v: number) => void;
  volume?: number;
  /** MU-07: «Enter a code» of the pause window. */
  onPromo?: () => void;
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
  /** MU round 4: the caption when the frame is squeezed («+2 · 150»); absent — the full one. */
  short?: string;
  /** MU round 5: the small word over the button («Sneakers»), not shown with the short caption. */
  cap?: string;
  can: boolean;
  progress: number;
}

/** FM-16: the cards «Egg for subscribing» (one a channel) and «Chest for a review» under the channels, hidden until
 * setCommunityGifts shows them. */
export interface CommunityGiftCards {
  subscribe: boolean;
  review: boolean;
  onSubscribe(id: string): void;
  onReview(): void;
}

export interface Hud {
  root: HTMLElement;
  /** FM-16: which gift cards stand by the pause window: channels whose gift is not given yet, the review card. */
  setCommunityGifts(s: { subscribe: readonly string[]; review: boolean }): void;
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
  /** `arrow` — a small arrow in the plaque turned to this screen angle (rad, 0 — right, π/2 — down): the way to the belt
   * of hint.stuck (docs/01-gdd.md 16.6). */
  setHint(hint: { text: string; pict: 'keys' | 'stick' | null; x: number; y: number; urgent?: boolean; arrow?: number | null } | null): void;
  /** Hand icon above the free egg (hint.egg, no text); null hides it. */
  setHand(pos: { x: number; y: number } | null): void;
  /** «Shoes ×N · price» at the bottom centre; null hides it (docs/01-gdd.md 6.4: shows from the first time coins suffice). */
  setShoes(state: ShoesButtonState | null): void;
  /** «+N» floating up from a field position in px (docs/01-gdd.md 10.3); the caller limits the rate. */
  popGain(text: string, x: number, y: number): void;
  /** Coin plaque (docs/01-gdd.md 6.4, 10.1): hidden until the first coin, then slides in from the left and stays. */
  setCoins(text: string): void;
  /** «+N» by the coin plaque and its pulse (docs/01-gdd.md 16.5: the coins of a gate arrive). */
  popCoinGain(text: string): void;
  /** Centre of the coin icon in field px: where the coins of a gate fly (docs/01-gdd.md 16.5). */
  coinTarget(): { x: number; y: number };
  /** «Avalanche in N» at the top centre on a dark plaque (docs/01-gdd.md 4.8, 16.7); null hides it. */
  setWaveBanner(text: string | null): void;
  /** The banner box in field px while it shows, null otherwise (gate signs under it hide, docs/01-gdd.md 16.7). */
  waveBannerRect(): { x0: number; y0: number; x1: number; y1: number } | null;
  /** Round of fixes MU (docs/07-mobile-ui.md, rule 19; staff 19.10: names, «Stage reward» and the ridge sign showed
   * through the tiles, the strip and the slot): is a world label's box (field px) at least 8 px off every block of the
   * phone HUD shown now. Always true off the phone layout. */
  clearOfHud(r: { x0: number; y0: number; x1: number; y1: number }): boolean;
  /** «Wrong way» arrow by the hero (docs/01-gdd.md 16.7): centre in field px and the screen angle; null hides it. */
  setWayArrow(arrow: { x: number; y: number; angle: number } | null): void;
  /** Frost frame at the screen edges: 0 off, warn ≈ 0.4, front near 1 (docs/01-gdd.md 4.8). */
  setFrost(level: number): void;
  /** Arrow at the field edge towards the lit cave when it is off screen (x, y in px, angle in rad); null hides it. */
  setCaveArrow(arrow: { x: number; y: number; angle: number } | null): void;
  /** Short toast in the middle («Phew, made it! +15», «Snowed in!»); `gold` — the bigger golden one (docs/01-gdd.md 4.9);
   * `sub` — a smaller second line (the collection counter of a hatch, M3-13); `onShow` — called when it is on screen
   * (it may wait for the avalanche banner: the egg of the first wave comes after «Phew, made it!», docs/01-gdd.md 16.6). */
  toast(text: string, sec?: number, gold?: boolean, sub?: string, onShow?: () => void): void;
  /** Soft white veil when the camera is inside the snow body (docs/02-tech.md 7). */
  setVeil(on: boolean): void;
  /** Speed plaque: the number and «+N per step» under it (docs/01-gdd.md 10.1). */
  /** Speed and «+N per step»; `section` — «×N this section» of the open slope (docs/01-gdd.md 17.4), null hides it. */
  setStat(value: string, perStep: string, section?: string | null): void;
  /** «Slowed» on the Speed plaque (docs/01-gdd.md 18.5): «×0,85» while it lasts; null — hidden. */
  setSlow(text: string | null): void;
  /** «+N» flying up over the Speed plaque on a gain. */
  popStatGain(text: string): void;
  /** A round number of Speed (docs/01-gdd.md 10.3, M2-13): the plaque flashes, the number bounces. */
  flashStat(): void;
  /** Mountain bar: built once per mountain. */
  setMountain(bar: MountainBar): void;
  /** The mountain bar on or off (docs/01-gdd.md 19.4: hidden on the base). */
  setMountainShown(on: boolean): void;
  /** MU round 3: the stage strip slides in for a moment (the giant's zone; a new stage and a ridge show it by themselves). */
  peekStrip(): void;
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
  /** The button over a point of the base the hero stands at (docs/01-gdd.md 19.3), like the egg button; null hides it. */
  setStandButton(state: { text: string; x: number; y: number } | null): void;
  /** The hand over a point of the base with something to take there (the shop: enough coins); null hides it. */
  setStandHand(pos: { x: number; y: number } | null): void;
  /** A plaque over a point of the base (the gift of the day: «!» or «in 14:20»), not a button; null hides it. */
  setStandLabel(state: { text: string; x: number; y: number } | null): void;
  /** «▶ Ad: …» buttons shown now (docs/01-gdd.md 9.1, 10.1: PC — left middle, touch — top centre under the goal);
   * `busy` — waiting for the ad, the button is locked. An empty list hides the row. */
  setAdButtons(list: ReadonlyArray<{ id: string; text: string; busy: boolean }>): void;
  /** Trophy plaque under the coins (docs/01-gdd.md 6.4: from the first summit); null hides it. */
  setTrophies(text: string | null): void;
  /** Level bar at the bottom centre (docs/01-gdd.md 22.2, pace stages): «Level N · x / need» with the Speed plaque moved
   * over it; null — no bar (the other paces), the plaque stays in the left column. */
  setLevel(state: { title: string; progress: string; frac: number } | null): void;
  /** «yours 7 / need 8» under the goal by a ridge of the stages pace (docs/01-gdd.md 22.3); null — hidden. */
  setNeed(state: { text: string; ok: boolean; arrow?: number | null } | null): void;
  /** The step of the stage tutorial under the goal (docs/01-gdd.md 22.12); null — none. MU round 5: `arrow` — a small
   * arrow at the start of the plaque turned to this screen angle (rad, 0 — right), the way to what it names. */
  setTutor(text: string | null, urgent?: boolean, arrow?: number | null): void;
  /** Round of fixes MU (l5-camp): the light plaques of the portals of the base — «where» over «level · open» or a lock
   * and its condition — hung by their bottom middle at (x, y), nearest first; one within 8 px of the HUD or of a plaque
   * placed before it is not drawn; nor one over the hero's box `hero` (rule 3). An empty list hides them all. */
  setPortalLabels(list: ReadonlyArray<{ text: string; sub: string; locked: boolean; x: number; y: number }>, hero?: { x0: number; y0: number; x1: number; y1: number }): void;
  /** MU round of fixes 2: the board of the nearest ridge ahead, «LEVEL NEEDED» over the number, its bottom middle at
   * (x, y) — the post top on screen; not drawn off the field or within 8 px of the HUD; null — hidden. */
  setGateSign(state: { text: string; x: number; y: number } | null): void;
  /** «+N» with a trophy over the trophy button of a stage (docs/01-gdd.md 22.8); null — hidden. */
  setPadLabel(state: { text: string; x: number; y: number; tap?: boolean; sub?: string; hero?: { x0: number; y0: number; x1: number; y1: number }; pad?: { x0: number; y0: number; x1: number; y1: number } } | null): void;
  /** The portrait of a phone (the game is landscape, docs/03): «Turn your phone» over everything; false — hidden. */
  setRotate(on: boolean): void;
  /** MU-02: the gift plaque under pause and sound — a timer, or «Take» in gold when a gift is ready; null hides it. */
  setGift(state: { text: string; ready: boolean } | null): void;
  /** MU-07 (w3-pause): the name of the set of steps on, by «Steps» of the pause window. */
  setPauseSteps(name: string): void;
  /** MU-06 (l5-camp): the hero is in the camp or on the base — no shoes button there. */
  setCamp(on: boolean): void;
  /** MU-02: who holds the message slot now ('' — nobody): wave, toast, ads, need, tutor, hint. */
  readonly slot: string;
  readonly jumpButton: HTMLButtonElement;
  /** Body of the pause and settings window (the caller opens it in the window frame). */
  readonly pausePanel: HTMLElement;
}

/** Hint plaque band: its top never above this share of the field (top HUD band; below the wave banner while it shows), its bottom never below this one. */
const HINT_TOP_MIN = 0.24;
const HINT_TOP_WAVE = 0.34;
/** Gap between the bottom of the avalanche plaque and a hint under it (px). */
const HINT_UNDER_BANNER = 6;
const HINT_BOTTOM_MAX = 0.78;

/** Short window (docs/01-gdd.md 10.1): below this height the column is icons 44 px, 6 px apart, ending above 72% H. */
const SHORT_H = 420;
const SHORT_BTN = 44;
const SHORT_GAP = 6;
const MENU_EDGE = 8;
const MENU_BOTTOM = 0.72;

/** Round of fixes MU (docs/07-mobile-ui.md, rule 19): a world label keeps this far off the HUD blocks (px); the blocks
 * are read this often (ms). */
const LABEL_GAP = 8;
const RECTS_MS = 150;
/** MU round 4 (producer 20.10: the world labels shook and stood in the top middle): a label glides to its place at this
 * rate (1/s); the top middle of the frame — this share of its height, the middle half of its width — is no place for it. */
const LABEL_GLIDE = 10;
const TOP_MID_H = 0.3;
const LABEL_FLIP_SEC = 0.5;
/** …and «Stage reward» keeps this far off the hero (px). */
const HERO_GAP = 12;
/** …and its places left of the pad's corner step this far further (px). */
const PAD_SIDE = 24;
/** MU round 5: …and keeps this far off the pad itself on screen (px). */
const PAD_GAP = 4;
/** The side margin of the phone frame (docs/07-mobile-ui.md, «Поля кадра»); the top of the message slot; the letters
 * of Rubik are this many em tall (ascent and descent). */
const EDGE_MU = 16;
const SLOT_TOP_MU = 50;
const GLYPH_EM = 1.2;
/** MU-02 (l1-run-hud-a): the stick ring 84 px, its centre 76 px from the left edge. */
const MU_STICK = 84;
const MU_STICK_X = 76;
/** MU round 3: a field this low or lower is a phone under browser panels (815 × 290) — compact cards in the windows. */
const LOW_H = 340;
/** MU round 3 (producer: the HUD compact): the stage strip shows this long on a new stage, a ridge or the giant (ms). */
const STRIP_PEEK_MS = 2500;
/** MU round 3: the level bar (320, never under 160) and the shoes button on one line between the stick and the jump. */
const ROW_GAP = 8;
const BAR_W = 320;
const BAR_MIN = 160;
const MU_JUMP = 64;
/** Rule 2 of docs/07: the shoes button (paid) keeps this far from the jump when the line has room; MU round 4 (A66): in a
 * frame squeezed by a banner never closer than the second one. */
const SHOES_THUMB_CLEAR = 100;
const SHOES_THUMB_MIN = 24;
/** MU round 4 (A66): the resting stick's ring 16 px over the bottom edge and 24 under the column of tiles — on a low
 * frame (815 × 290) it gets smaller for that, down to the second number (px). */
const STICK_BOTTOM = 16;
const COLUMN_GAP = 24;
const STICK_MIN = 64;
/** MU round 3: where the ridge board may stand around the top of its post, in its own widths and heights, nearest first. */
const GATE_SIGN_SHIFTS: ReadonlyArray<[number, number]> = [[0, 0], [0, 0.5], [0.5, 0], [-0.5, 0], [0.5, 0.5], [-0.5, 0.5], [0, 1], [1, 0], [-1, 0]];

/** The click a browser sends after a tap comes within this many ms of the finger lifting. */
const TAP_CLICK_MS = 800;

/** How long the Speed plaque keeps its flash class (the CSS animation is shorter). */
const STAT_FLASH_MS = 1200;
/** Toasts waiting for the avalanche banner to go (playtest M2), the oldest dropped past this. */
const TOAST_QUEUE_MAX = 3;

/** «#RRGGBB» and an alpha → «rgba(r, g, b, a)». */
function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** A white arrow pointing right (turned by the caller), for the dark round plaques. */
const ARROW_SVG = '<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M4 10h9V5.5L21 12l-8 6.5V14H4z" fill="currentColor"/></svg>';

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

/** MU round 5: shows the arrow of a slot plaque turned to `angle` (rad), or hides it. */
function turnArrow(a: HTMLElement, angle: number | null): void {
  a.classList.toggle('shown', angle !== null);
  if (angle !== null) a.style.transform = `rotate(${angle.toFixed(2)}rad)`;
}

export function createHud(host: HTMLElement, opts: HudOptions): Hud {
  const root = el('div', opts.mu ? 'hud mu' : 'hud');
  root.dataset['role'] = 'hud';
  host.appendChild(root);

  const pauseBtn = el('button', 'hud-btn hud-pause');
  pauseBtn.innerHTML = icon('pause');
  // MU-02: the gift plaque under pause and sound — the «Gifts» window (rewards for the time in the game).
  const giftBtn = el('button', 'hud-btn hud-gift');
  giftBtn.dataset['hud'] = 'gift';
  const giftIcon = el('span', 'hud-gift-icon');
  giftIcon.innerHTML = icon('giftLine');
  const giftText = el('span', 'hud-gift-text');
  giftBtn.append(giftIcon, giftText);
  onPress(giftBtn, () => opts.onGift?.());
  if (opts.mu) root.appendChild(giftBtn);
  pauseBtn.dataset['hud'] = 'pause';
  pauseBtn.setAttribute('aria-label', t('btn.pause'));
  onPress(pauseBtn, () => opts.onPause());
  root.appendChild(pauseBtn);

  const soundBtn = el('button', 'hud-btn hud-sound');
  soundBtn.dataset['hud'] = 'sound';
  soundBtn.setAttribute('aria-label', t('settings.sfx'));
  onPress(soundBtn, () => opts.onSound());
  root.appendChild(soundBtn);

  const jumpButton = el('button', 'hud-btn hud-jump');
  jumpButton.innerHTML = icon('jump');
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
  // Open slope (docs/01-gdd.md 17.4): the multiplier of the section by «+N per step».
  const statSection = el('span', 'hud-stat-section', '');
  statSection.dataset['role'] = 'section-mult';
  const statSlow = el('span', 'hud-stat-slow', '');
  statSlow.dataset['role'] = 'slow';
  statBody.append(statValue, statPer, statSection, statSlow);
  const statGain = el('span', 'hud-stat-gain');
  // MU-02: «N Speed» — the word after the number (the phone layout only).
  statValue.after(el('span', 'hud-stat-word', t('hud.speed')));
  stat.append(statIcon, statBody, statGain);
  left.appendChild(stat);

  // Level bar (docs/01-gdd.md 22.2): bottom centre, the Speed plaque moves over it while it shows.
  const levelBox = el('div', 'hud-level');
  levelBox.dataset['role'] = 'level';
  const levelBar = el('div', 'hud-level-bar');
  const levelFill = el('div', 'hud-level-fill');
  levelFill.style.setProperty('--stat', opts.statColor);
  const levelText = el('div', 'hud-level-text');
  const levelTitle = el('span', 'hud-level-title');
  const levelProgress = el('span', 'hud-level-progress');
  levelText.append(levelTitle, levelProgress);
  levelBar.append(levelFill, levelText);
  // The stage tutorial (docs/01-gdd.md 22.12): one step at a time over the Speed plaque (LV-12: under the goal it met the
  // toasts and hints).
  const tutor = el('div', 'hud-tutor');
  tutor.dataset['role'] = 'tutor';
  // MU round 5 (producer 21.10): the slot plaques point the way — to the gold pad, to the treadmill.
  const slotArrow = (): HTMLElement => {
    const a = el('span', 'hud-slot-arrow');
    a.dataset['role'] = 'slot-arrow';
    a.innerHTML = ARROW_SVG;
    return a;
  };
  const tutorArrow = slotArrow();
  const tutorText = el('span', 'hud-slot-text');
  tutor.append(tutorArrow, tutorText);
  levelBox.append(tutor, levelBar);
  root.appendChild(levelBox);
  // MU-02: the tutorial step is a message of the slot on the phone layout.
  if (opts.mu) root.appendChild(tutor);

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
  // MU-02: the strip filled in the Speed colour up to the hero's face.
  const mountainFill = el('span', 'hud-mfill');
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
  // Stages pace (docs/01-gdd.md 22.3): «yours 7 / need 8» by a closed ridge — red short, green enough; a pill, not a board.
  const need = el('div', 'hud-need');
  need.dataset['role'] = 'need';
  const needArrow = slotArrow();
  const needText = el('span', 'hud-slot-text');
  need.append(needArrow, needText);
  goal.append(goalText, goalBar, need);
  root.appendChild(goal);
  // MU-03: the gate plaque is a message of the slot on the phone layout (the goal line is gone there).
  if (opts.mu) root.appendChild(need);

  // Coins under the Speed plaque (docs/01-gdd.md 10.1): a coin with a snowflake and the number.
  const coins = el('div', 'hud-coins');
  coins.dataset['role'] = 'coins';
  coins.setAttribute('aria-label', t('hud.coins'));
  coins.style.setProperty('--coins', opts.coinColor);
  const coinIcon = el('span', 'hud-coin-icon');
  coinIcon.innerHTML = icon('coin');
  // Stages pace (docs/01-gdd.md 22.8): the wallet is trophies — the cup on the trophy colour, the old trophy plaque off.
  if (opts.coinsAsTrophies) {
    coinIcon.innerHTML = icon('cup');
    coins.style.setProperty('--coins', opts.trophyColor);
    coins.setAttribute('aria-label', t('hud.trophies'));
  }
  const coinValue = el('span', 'hud-coin-value', '0');
  const coinGain = el('span', 'hud-coin-gain');
  coinGain.dataset['role'] = 'coin-gain';
  coins.append(coinIcon, coinValue, coinGain);
  left.appendChild(coins);
  const trophies = el('div', 'hud-trophies');
  trophies.dataset['role'] = 'trophies';
  trophies.setAttribute('aria-label', t('hud.trophies'));
  trophies.style.setProperty('--trophies', opts.trophyColor);
  const trophyIcon = el('span', 'hud-trophy-icon');
  trophyIcon.innerHTML = icon('cup');
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
  // The button and the hand over a point of the base (docs/01-gdd.md 19.3): the look of the egg button and the hand.
  const standBtn = el('button', 'hud-egg can');
  standBtn.dataset['hud'] = 'stand';
  standBtn.style.setProperty('--ok', opts.okColor);
  onPress(standBtn, () => opts.onStand?.());
  root.appendChild(standBtn);
  const standLabel = el('div', 'hud-egg');
  standLabel.dataset['role'] = 'stand-label';
  standLabel.style.pointerEvents = 'none';
  root.appendChild(standLabel);
  // The reward button of a stage finish (docs/01-gdd.md 22.8): «+N ❄» over it on the coin colour — it pays coins (SD-11,
  // Q-088: trophies are only those of summits); the teleport of the camp — the plain plaque, no currency mark.
  const padLabel = el('div', 'hud-egg hud-pad');
  padLabel.dataset['role'] = 'pad-label';
  // The teleport label of the camp is a button too (LV-12: it looked like one).
  padLabel.addEventListener('pointerdown', (ev) => {
    if (!padLabel.classList.contains('tap')) return;
    ev.preventDefault();
    ev.stopPropagation();
    opts.onPadLabel?.();
  });
  padLabel.style.setProperty('--coins', opts.coinColor);
  const padIcon = el('span', 'hud-pad-icon');
  padIcon.innerHTML = icon('coin');
  const padText = el('span', 'hud-pad-text');
  // MU-04: the second line of the stage finish plaque («you can run past»).
  const padSub = el('span', 'hud-pad-sub');
  padLabel.append(padText, padIcon, padSub);
  root.appendChild(padLabel);
  const gateBoard = el('div', 'hud-gate-sign');
  gateBoard.dataset['role'] = 'gate-sign';
  const gateNum = el('span', 'hud-gate-num');
  gateBoard.append(el('span', 'hud-gate-word', t('gate.needLevel')), gateNum);
  root.appendChild(gateBoard);
  let gateSize = { text: '', w: 0, h: 0 };
  // MU-09 (p1-rotate): a dark screen, the phone with an arc arrow, the title and one line.
  const rotate = el('div', 'hud-rotate');
  rotate.dataset['role'] = 'rotate';
  const phone = el('div', 'hud-rotate-phone');
  if (opts.mu) phone.innerHTML = icon('rotatePhone');
  rotate.append(phone, el('div', 'hud-rotate-title', t('hud.rotate')));
  if (opts.mu) rotate.appendChild(el('div', 'hud-rotate-line', t('hud.rotateLine')));
  root.appendChild(rotate);

  // Avalanche (docs/01-gdd.md 4.8): banner, frost frame, arrow to the cave, toast, veil. Never red (docs/03, 3.2).
  root.style.setProperty('--threat', opts.threatColor);
  if (opts.bonusColor) root.style.setProperty('--gold', opts.bonusColor);
  root.style.setProperty('--stat-goal', opts.statColor);
  root.style.setProperty('--plaque', rgba(opts.plaqueColor, opts.plaqueAlpha));
  root.style.setProperty('--plaque-text', opts.plaqueText);
  // Readability (FM-04): the toast plaque, «+N» in the Speed colour with a dark outline, the bigger shelter arrow.
  if (opts.toastPlate) {
    const tp = opts.toastPlate;
    root.classList.add('plated');
    root.style.setProperty('--toast-plate', rgba(tp.bg, tp.alpha));
    root.style.setProperty('--toast-radius', `${tp.radius}px`);
    root.style.setProperty('--toast-pad', `${tp.padY}px ${tp.padX}px`);
  }
  if (opts.gainText) {
    root.classList.add('gain-outlined');
    root.style.setProperty('--gain-scale', String(opts.gainText.scale));
    root.style.setProperty('--gain-outline', `${opts.gainText.outline}px`);
    root.style.setProperty('--gain-outline-color', opts.plaqueColor);
  }
  root.style.setProperty('--arrow-scale', String(opts.arrowScale ?? 1));
  const frost = el('div', 'hud-frost');
  frost.dataset['role'] = 'frost';
  const veil = el('div', 'hud-veil');
  veil.dataset['role'] = 'veil';
  const banner = el('div', 'hud-wave');
  banner.dataset['role'] = 'wave-banner';
  const arrow = el('div', 'hud-cave-arrow');
  arrow.innerHTML = ARROW_SVG;
  arrow.dataset['role'] = 'cave-arrow';
  const wayArrow = el('div', 'hud-way');
  wayArrow.dataset['role'] = 'way-arrow';
  wayArrow.innerHTML = ARROW_SVG;
  const toastEl = el('div', 'hud-toast');
  toastEl.dataset['role'] = 'toast';
  const toastMain = el('span', 'hud-toast-main');
  const toastSub = el('span', 'hud-toast-sub');
  toastSub.dataset['role'] = 'toast-sub';
  toastEl.append(toastMain, toastSub);
  root.append(frost, veil, wayArrow, banner, arrow, toastEl);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let stripTimer: ReturnType<typeof setTimeout> | null = null;
  // MU round 3: the stage strip hides between its moments.
  if (opts.mu) root.classList.add('strip-off');
  const peekStrip = (): void => {
    if (!opts.mu) return;
    root.classList.remove('strip-off');
    // The slot moves with the strip: the boxes of the HUD the world labels keep off are read anew.
    rectsAt = 0;
    if (stripTimer) clearTimeout(stripTimer);
    stripTimer = setTimeout(() => {
      stripTimer = null;
      root.classList.add('strip-off');
      rectsAt = 0;
    }, STRIP_PEEK_MS);
  };
  /** MU round 3: «N Speed» over the level bar, the bar and the shoes button on one line at the bottom, between the stick
   * and the jump. */
  const placeRow = (): void => {
    if (!opts.mu) return;
    const shoesOn = shoes.classList.contains('shown') && !root.classList.contains('camp');
    // The ring is placed by its margin of −size / 2; its border makes it wider than its size.
    const lo = MU_STICK_X - stickD / 2 + (stickBase.offsetWidth || stickD) + ROW_GAP;
    // MU round 4 (Q-MU-16: the platform squeezes the frame by its banner; A66): the level bar comes first and keeps its
    // width; the shoes button gives way first — its short caption — then its distance to the jump (100 → 24 px); only
    // then the bar narrows (never under 160).
    const jumpX = fieldW - EDGE_MU - MU_JUMP;
    const setShort = (on: boolean): number => {
      if (shoes.classList.contains('short') !== on) {
        shoes.classList.toggle('short', on);
        setRich(shoesText, on && shoesShort ? shoesShort : shoesFull);
        shoesCap.textContent = on && shoesShort ? '' : shoesCapText;
      }
      return shoesOn ? shoes.offsetWidth : 0;
    };
    const roomFor = (clear: number, sw: number): number => jumpX - clear - lo - (shoesOn ? sw + ROW_GAP : 0);
    let sw = setShort(false);
    let clear = SHOES_THUMB_CLEAR;
    if (shoesOn && roomFor(clear, sw) < BAR_W) sw = setShort(true);
    if (shoesOn && roomFor(clear, sw) < BAR_W) clear = SHOES_THUMB_MIN;
    const hi = jumpX - (shoesOn ? clear : ROW_GAP);
    const bw = Math.max(BAR_MIN, Math.min(BAR_W, hi - lo - (shoesOn ? sw + ROW_GAP : 0)));
    const total = bw + (shoesOn ? ROW_GAP + sw : 0);
    const x0 = Math.max(lo, Math.min(hi - total, Math.round(fieldW / 2 - total / 2)));
    levelBox.style.width = `${bw}px`;
    levelBox.style.left = `${x0}px`;
    shoes.style.left = `${x0 + bw + ROW_GAP}px`;
  };
  type Toast = { text: string; sec: number; gold: boolean; sub: string | undefined; onShow?: (() => void) | undefined };
  const pendingToasts: Toast[] = [];
  let currentToast: Toast | null = null;
  // Round of fixes MU (staff 19.10: «+150» and «LEVEL UP!» at 130 % text lay on the stage strip): the phone toast's
  // letters start 8 px under the strip as it is now (it grows with the text) — its line box is tighter than the letters.
  const placeMuToast = (): void => {
    if (!opts.mu) return;
    const strip = mountain.getBoundingClientRect().bottom - root.getBoundingClientRect().top;
    const cs = getComputedStyle(toastMain);
    const fs = Number.parseFloat(cs.fontSize) || 0;
    const lh = Number.parseFloat(cs.lineHeight) || fs;
    toastEl.style.top = `${Math.ceil(Math.max(SLOT_TOP_MU, strip + LABEL_GAP) + Math.max(0, (fs * GLYPH_EM - lh) / 2))}px`;
  };
  const showToast = (text: string, sec: number, gold: boolean, sub: string | undefined, onShow?: () => void): void => {
    currentToast = { text, sec, gold, sub };
    setRich(toastMain, text);
    toastSub.textContent = sub ?? '';
    placeMuToast();
    toastEl.classList.toggle('gold', gold);
    toastEl.classList.remove('shown');
    void toastEl.offsetWidth;
    toastEl.classList.add('shown');
    onShow?.();
    // The hint plaque steps aside while a toast is up: one message near the hero at a time.
    root.classList.add('toasting');
    updateSlot();
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastTimer = null;
      currentToast = null;
      toastEl.classList.remove('shown');
      root.classList.remove('toasting');
      const next = banner.classList.contains('shown') ? undefined : pendingToasts.shift();
      if (next) showToast(next.text, next.sec, next.gold, next.sub, next.onShow);
      else updateSlot();
    }, sec * 1000);
  };

  // Hint plaque (docs/01-gdd.md 6.5): one line up to 5 words, optional pictogram of the controls (WASD and arrows or the stick).
  const hint = el('div', 'hud-hint');
  hint.dataset['role'] = 'hint';
  const hintText = el('span', 'hud-hint-text');
  const pictKeys = el('span', 'hud-pict hud-pict-keys');
  for (const k of ['W', 'A', 'S', 'D', '\u2191', '\u2190', '\u2193', '\u2192']) pictKeys.appendChild(el('span', 'hud-key', k));
  const pictStick = el('span', 'hud-pict hud-pict-stick');
  const hintArrow = el('span', 'hud-hint-arrow');
  hintArrow.dataset['role'] = 'hint-arrow';
  hintArrow.innerHTML = ARROW_SVG;
  hint.append(hintText, pictKeys, pictStick, hintArrow);
  root.appendChild(hint);
  const hand = el('div', 'hud-hand');
  hand.dataset['role'] = 'hand';
  hand.innerHTML =
    '<svg viewBox="0 0 24 24" width="40" height="40"><path d="M9 11V4.5a1.5 1.5 0 0 1 3 0V10h.5V3.5a1.5 1.5 0 0 1 3 0V10h.5V5a1.5 1.5 0 0 1 3 0v8c0 4-2.5 7.5-7 7.5-3 0-4.6-1.4-6-3.6L3.3 13.6a1.4 1.4 0 0 1 2.2-1.8L7.5 14V7a1.5 1.5 0 0 1 3 0" fill="#fff" stroke="#1b2a3a" stroke-width="1.2"/></svg>';
  root.appendChild(hand);
  const standHand = el('div', 'hud-hand');
  standHand.dataset['role'] = 'stand-hand';
  standHand.innerHTML = hand.innerHTML;
  root.appendChild(standHand);
  const gainPool = Array.from({ length: 4 }, () => el('div', 'hud-gain'));
  let gainNext = 0;
  for (const node of gainPool) root.appendChild(node);

  // «▶ Ad: …» buttons (docs/01-gdd.md 9.1, 10.1): a row, no sound and no lure animation.
  const ads = el('div', 'hud-ads');
  ads.dataset['role'] = 'ads';
  ads.dataset['hud'] = 'ads';
  const adBtns: HTMLButtonElement[] = [];
  root.appendChild(ads);

  // Shoes button (docs/01-gdd.md 10.1): grey with a fill bar while coins are short, green with a shine when enough.
  const shoes = el('button', 'hud-shoes');
  shoes.dataset['hud'] = 'shoes';
  shoes.style.setProperty('--ok', opts.okColor);
  const shoesFill = el('span', 'hud-shoes-fill');
  const shoesText = el('span', 'hud-shoes-text');
  /** MU round 4: the shoes caption in full and short (for a squeezed frame). */
  let shoesFull = '';
  let shoesShort = '';
  // MU round 5 (producer 21.10): the small «Sneakers» over the button (a space keeps the words apart in the text).
  const shoesCap = el('span', 'hud-shoes-cap');
  let shoesCapText = '';
  shoes.append(shoesFill, shoesCap, document.createTextNode(' '), shoesText);
  onPress(shoes, () => {
    if (shoes.classList.contains('can')) opts.onShoes();
    else {
      // MU round 5 (producer 21.10: everything answers a tap): a short shake and a toast of what is missing.
      nudge(shoes);
      opts.onShoesShort?.();
    }
  });
  root.appendChild(shoes);

  // Pause and settings (docs/01-gdd.md 10.2): the body of the «pause» window of the common frame; the frame title is
  // the game title (LOC-04), «Pause» small under it; «Continue» is the window's «next» button.
  const pausePanel = el('div', 'pause-body');
  pausePanel.dataset['role'] = 'pause';
  // The settings in a column; the channels of the game beside it (below it on a narrow screen).
  const pauseMain = el('div', 'pause-main');
  pausePanel.appendChild(pauseMain);
  pauseMain.appendChild(el('div', 'panel-sub', t('settings.title')));

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
  pauseMain.appendChild(autoRow);

  const qualitySel = el('select', 'select');
  qualitySel.dataset['hud'] = 'quality';
  for (const q of ['auto', 'high', 'medium', 'low'] as const) {
    const o = document.createElement('option');
    o.value = q;
    o.textContent = t(`settings.q.${q}`);
    qualitySel.appendChild(o);
  }
  qualitySel.addEventListener('change', () => opts.onQuality(qualitySel.value as 'auto' | 'low' | 'medium' | 'high'));
  pauseMain.appendChild(row(t('settings.quality'), qualitySel));

  // Footsteps (LV-09): the row opens the «Footsteps» window (sets and their volume).
  const onFootsteps = opts.onFootsteps;
  if (onFootsteps) {
    const b = el('button', 'toggle', t('footsteps.open'));
    b.dataset['hud'] = 'footsteps';
    b.addEventListener('click', () => onFootsteps());
    pauseMain.appendChild(row(t('footsteps.title'), b));
  }

  const howto = el('div', 'howto');
  howto.append(el('p', '', t('howto.goal')), el('p', '', t('howto.pc')), el('p', '', t('howto.touch')));
  pauseMain.appendChild(howto);

  // «Promo codes and bonuses in the channel» (docs/01-gdd.md 19.10, Q-054): a button a channel, a new tab, nothing given.
  // FM-16: under each its card «Egg for subscribing», under them «Chest for a review» (hidden until setCommunityGifts).
  const giftCards = new Map<string, HTMLElement>();
  const gifts = opts.community?.gifts;
  if (opts.community && (opts.community.ids.length > 0 || gifts?.review)) {
    const side = el('div', 'pause-side');
    side.dataset['role'] = 'community';
    side.appendChild(el('div', 'pause-side-cap', t('community.caption')));
    for (const id of opts.community.ids) {
      const b = el('button', `card-btn community ${id}`, t(`community.${id}`));
      b.dataset['hud'] = `community-${id}`;
      b.addEventListener('click', () => opts.community?.open(id));
      side.appendChild(b);
      if (gifts?.subscribe) {
        const c = el('button', `card-btn community community-gift ${id}`, t('communityGift.subscribe'));
        c.dataset['hud'] = `gift-sub-${id}`;
        c.hidden = true;
        c.addEventListener('click', () => gifts.onSubscribe(id));
        side.appendChild(c);
        giftCards.set(`sub-${id}`, c);
      }
    }
    if (gifts?.review) {
      const c = el('button', 'card-btn community community-gift review', t('communityGift.review'));
      c.dataset['hud'] = 'gift-review';
      c.hidden = true;
      c.addEventListener('click', () => gifts.onReview());
      side.appendChild(c);
      giftCards.set('review', c);
    }
    pausePanel.appendChild(side);
  }
  // RL-11 (producer 14.10): the same cards on the base without the pause — a column by the shop side of the screen;
  // never on a mountain run (setMountainShown). A card says its channel: there is no channel button above it here.
  const baseGifts = el('div', 'base-gifts off');
  baseGifts.dataset['role'] = 'base-gifts';
  if (opts.community && gifts) {
    const card = (key: string, hud: string, top: string | null, text: string, on: () => void): void => {
      const c = el('button', 'card-btn community community-gift');
      c.dataset['hud'] = hud;
      if (top) c.appendChild(el('span', 'base-gift-from', top));
      c.appendChild(el('span', 'base-gift-what', text));
      c.hidden = true;
      c.addEventListener('click', on);
      baseGifts.appendChild(c);
      giftCards.set(`base-${key}`, c);
    };
    if (gifts.subscribe) for (const id of opts.community.ids) card(`sub-${id}`, `base-gift-sub-${id}`, t(`community.${id}`), t('communityGift.subscribe'), () => gifts.onSubscribe(id));
    if (gifts.review) card('review', 'base-gift-review', null, t('communityGift.review'), () => gifts.onReview());
    root.appendChild(baseGifts);
  }

  const cont = el('button', 'btn-primary', t('btn.continue'));
  cont.dataset['hud'] = 'continue';
  cont.dataset['next'] = '1';
  cont.addEventListener('click', () => opts.onContinue());
  pauseMain.appendChild(cont);

  // MU-07 (w3-pause): the phone layout of the pause window — two columns of rows (Auto-run, Graphics, Sounds, Steps),
  // the blue «Continue», «Promo codes and bonuses in the group» and three quiet buttons: the groups and «Enter a code».
  const QUALITY: Array<'auto' | 'high' | 'medium' | 'low'> = ['auto', 'high', 'medium', 'low'];
  let quality: 'auto' | 'high' | 'medium' | 'low' = 'auto';
  const muSwitch = el('button', 'mu-switch');
  const muQuality = el('button', 'card-btn quiet mu-select');
  const muVolume = el('input', 'foot-slider mu-volume');
  const muSteps = el('span', 'mu-row-value');
  if (opts.mu) {
    pausePanel.replaceChildren();
    pausePanel.className = 'pause-body pause-mu';
    const grid = el('div', 'pause-grid');
    const muRow = (label: string, ...rest: HTMLElement[]): HTMLElement => {
      const r = el('div', 'mu-row');
      r.append(el('span', 'mu-row-label', label), ...rest);
      grid.appendChild(r);
      return r;
    };
    muSwitch.dataset['hud'] = 'autorun';
    muSwitch.dataset['on'] = 'false';
    muSwitch.setAttribute('role', 'switch');
    muSwitch.setAttribute('aria-label', t('settings.autorun'));
    muSwitch.addEventListener('click', () => {
      const v = muSwitch.dataset['on'] !== 'true';
      muSwitch.dataset['on'] = String(v);
      opts.onAutoRun(v);
    });
    muRow(t('settings.autorun'), muSwitch);
    muQuality.dataset['hud'] = 'quality';
    muQuality.addEventListener('click', () => {
      quality = QUALITY[(QUALITY.indexOf(quality) + 1) % QUALITY.length]!;
      hud.setQuality(quality);
      opts.onQuality(quality);
    });
    muRow(t('settings.quality'), muQuality);
    muVolume.type = 'range';
    muVolume.min = '0';
    muVolume.max = '100';
    muVolume.step = '5';
    muVolume.value = String(Math.round((opts.volume ?? 1) * 100));
    muVolume.style.setProperty('--fill', `${muVolume.value}%`);
    muVolume.dataset['hud'] = 'volume';
    muVolume.setAttribute('aria-label', t('settings.sfx'));
    muVolume.addEventListener('input', () => {
      muVolume.style.setProperty('--fill', `${muVolume.value}%`);
      opts.onVolume?.(Number(muVolume.value) / 100);
    });
    muRow(t('settings.sfx'), muVolume);
    if (onFootsteps) {
      const b = el('button', 'card-btn quiet', t('footsteps.open'));
      b.dataset['hud'] = 'footsteps';
      b.addEventListener('click', () => onFootsteps());
      muRow(t('settings.steps'), muSteps, b);
    }
    pausePanel.appendChild(grid);
    const go = el('button', 'btn-primary mu-continue', t('btn.continue'));
    go.dataset['hud'] = 'continue';
    go.dataset['next'] = '1';
    go.addEventListener('click', () => opts.onContinue());
    pausePanel.append(go, el('div', 'mu-caption', t('community.caption')));
    const links = el('div', 'mu-links');
    links.dataset['role'] = 'community';
    for (const id of opts.community?.ids ?? []) {
      const b = el('button', `card-btn quiet community ${id}`);
      b.dataset['hud'] = `community-${id}`;
      const i = el('span', 'mark');
      i.innerHTML = icon(id === 'telegram' ? 'telegram' : 'vk');
      b.append(i, t(`community.${id}`));
      b.addEventListener('click', () => opts.community?.open(id));
      links.appendChild(b);
    }
    if (opts.onPromo) {
      const b = el('button', 'card-btn quiet');
      b.dataset['hud'] = 'promo';
      const i = el('span', 'mark');
      i.innerHTML = icon('key');
      b.append(i, t('promo.enter'));
      const onPromo = opts.onPromo;
      b.addEventListener('click', () => onPromo());
      links.appendChild(b);
    }
    pausePanel.appendChild(links);
  }

  /**
   * MU-02 (docs/07-mobile-ui.md, rule 11): one message slot under the stage strip — the avalanche banner, a toast, the
   * ad button of the camp, an urgent tutorial step (jump, the wave), the gate plaque, the other tutorial steps or a hint; the first of them that is up holds it, the rest
   * wait hidden.
   */
  const slotOwner = (): string => {
    if (banner.classList.contains('shown')) return 'wave';
    if (toastEl.classList.contains('shown')) return 'toast';
    if (ads.classList.contains('shown')) return 'ads';
    // An urgent tutorial step (jump, hide from the wave) goes before the gate plaque, the others after it.
    if (tutor.classList.contains('shown') && tutor.classList.contains('urgent')) return 'tutor';
    if (need.classList.contains('shown')) return 'need';
    if (tutor.classList.contains('shown')) return 'tutor';
    if (hint.classList.contains('shown')) return 'hint';
    return '';
  };
  const updateSlot = (): void => {
    if (!opts.mu) return;
    const o = slotOwner();
    if (root.dataset['slot'] !== o) root.dataset['slot'] = o;
  };
  /** Round of fixes MU (rule 19): a mark of the world hung at (x, y) by its bottom middle — not drawn within 8 px of the HUD. */
  const offHud = (e: HTMLElement, x: number, y: number): void => {
    if (!opts.mu) return;
    const w = e.offsetWidth;
    const h = e.offsetHeight;
    const v = hud.clearOfHud({ x0: x - w / 2, y0: y - h, x1: x + w / 2, y1: y }) ? '' : 'hidden';
    if (e.style.visibility !== v) e.style.visibility = v;
  };
  /** MU round 4: where a label stands now and when it moved (glides there, snaps when it shows again); the place it took
   * last (tried first: the label keeps its side instead of flipping between two). */
  type Glide = { x: number; y: number; t: number; shown: boolean; pick: number; vis: boolean; flipAt: number };
  /** A label seen or not keeps that at least LABEL_FLIP_SEC (no blinking when its place comes and goes for a moment). */
  const steady = (g: Glide, want: boolean): boolean => {
    const now = performance.now() / 1000;
    if (want !== g.vis && now - g.flipAt >= LABEL_FLIP_SEC) {
      g.vis = want;
      g.flipAt = now;
    }
    return g.vis;
  };
  const drop = (g: Glide): void => {
    if (g.vis) g.flipAt = performance.now() / 1000;
    g.vis = false;
    g.shown = false;
  };
  const glideTo = (g: Glide, x: number, y: number, fits?: (x: number, y: number) => boolean): { x: number; y: number } => {
    const now = performance.now() / 1000;
    const k = 1 - Math.exp(-Math.min(0.1, Math.max(0, now - g.t)) * LABEL_GLIDE);
    const gx = g.x + (x - g.x) * k;
    const gy = g.y + (y - g.y) * k;
    // On its way it never crosses the hero or the HUD: there it jumps to its place.
    if (!g.shown || Math.hypot(x - g.x, y - g.y) > fieldW / 3 || (fits && !fits(gx, gy))) {
      g.x = x;
      g.y = y;
    } else {
      g.x = gx;
      g.y = gy;
    }
    g.t = now;
    g.shown = true;
    return { x: Math.round(g.x), y: Math.round(g.y) };
  };
  const topMid = (q: { x0: number; y0: number; x1: number }): boolean => q.y0 < fieldH * TOP_MID_H && q.x1 > fieldW / 4 && q.x0 < (fieldW * 3) / 4;
  const portalLabels: Array<{ el: HTMLElement; name: HTMLElement; sub: HTMLElement; key: string; w: number; h: number; g: Glide }> = [];
  let padKey = '';
  let padSize = { w: 0, h: 0 };
  const padGlide: Glide = { x: 0, y: 0, t: 0, shown: false, pick: 0, vis: false, flipAt: -Infinity };
  // Round of fixes MU: the blocks of the phone HUD shown now (field px), read at most every RECTS_MS (they move rarely).
  let rectsAt = -Infinity;
  let rects: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  const hudRects = (): typeof rects => {
    if (!opts.mu) return [];
    const now = performance.now();
    if (now - rectsAt < RECTS_MS) return rects;
    rectsAt = now;
    const f = root.getBoundingClientRect();
    rects = [];
    for (const e of [left, menu, mountain, soundBtn, pauseBtn, giftBtn, levelBox, shoes, jumpButton, stickBase, hint, need, tutor, banner, ads, toastEl]) {
      const b = e.getBoundingClientRect();
      if (b.width <= 0 || b.height <= 0) continue;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue;
      rects.push({ x0: b.left - f.left, y0: b.top - f.top, x1: b.right - f.left, y1: b.bottom - f.top });
      // MU round of fixes 2 (staff: «Stage reward» hung under the stick): the thumb zones of the stick and the jump run
      // to the bottom and the side edges of the field.
      if (e === stickBase) rects.push({ x0: 0, y0: b.top - f.top, x1: b.right - f.left, y1: f.height });
      if (e === jumpButton) rects.push({ x0: b.left - f.left, y0: b.top - f.top, x1: f.width, y1: f.height });
    }
    return rects;
  };
  /** The single «+N» of the phone layout (docs/07-mobile-ui.md, rule 18): one number at a time. */
  const muGain = gainPool[0]!;

  let touchMode = false;
  let fieldW = 1;
  /** MU round 4: the resting stick's size and the y of its centre (layout). */
  let stickD = MU_STICK;
  let stickY = 0;
  let fieldH = 1;
  const hud: Hud = {
    root,
    jumpButton,
    pausePanel,
    get slot() {
      return root.dataset['slot'] ?? '';
    },
    setCamp(on) {
      if (root.classList.contains('camp') === on) return;
      root.classList.toggle('camp', on);
      placeRow();
    },
    setGift(state) {
      giftBtn.classList.toggle('shown', state !== null);
      if (!state) return;
      if (giftText.textContent !== state.text) giftText.textContent = state.text;
      giftBtn.classList.toggle('ready', state.ready);
    },
    setCommunityGifts(s) {
      for (const [key, c] of giftCards) {
        const k = key.startsWith('base-') ? key.slice(5) : key;
        c.hidden = k === 'review' ? !s.review : !s.subscribe.includes(k.slice(4));
      }
    },
    setTouchMode(touch) {
      const was = touchMode;
      touchMode = touch;
      root.classList.toggle('touch', touch);
      if (opts.mu && was !== touch) hud.layout(fieldW, fieldH);
    },
    setAutoRun(on) {
      autoRunToggle.dataset['on'] = String(on);
      autoRunToggle.textContent = on ? t('settings.on') : t('settings.off');
      muSwitch.dataset['on'] = String(on);
    },
    setQuality(level) {
      qualitySel.value = level;
      quality = level;
      muQuality.replaceChildren(t(`settings.q.${level}`));
      const chev = el('span', 'mark');
      chev.innerHTML = icon('chevron');
      muQuality.appendChild(chev);
    },
    setPauseSteps(name) {
      if (muSteps.textContent !== name) muSteps.textContent = name;
    },
    updateStick(stick, fieldLeft, fieldTop) {
      if (opts.mu && touchMode && !stick.active) {
        // MU-02 (l1-run-hud-a): the stick rests at the bottom left, its ring from y 216, visible on the snow.
        stickBase.style.opacity = '1';
        stickBase.style.transform = `translate(${MU_STICK_X}px, ${stickY}px)`;
        stickKnob.style.transform = 'translate(0px, 0px)';
        return;
      }
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
      if (opts.mu) {
        // MU-02: fixed sizes of docs/07-mobile-ui.md (jump 64, round buttons 44, stick 84). MU round 3: no bottom band —
        // the field is already the visible part of the window (main.ts, visualViewport).
        // A low screen (Yandex Browser under its panels, 815 × 290): the windows take their compact cards.
        host.classList.toggle('mu-low', height <= LOW_H);
        jumpButton.style.width = jumpButton.style.height = '';
        for (const b of [pauseBtn, soundBtn]) b.style.width = b.style.height = '';
        soundBtn.style.marginRight = '';
        menu.style.top = '';
        // MU round 4 (A66): the ring 16 px over the bottom, 24 under the column; smaller on a low frame for that.
        stickBase.style.width = stickBase.style.height = `${MU_STICK}px`;
        const border = stickBase.offsetWidth - MU_STICK;
        const col = menu.getBoundingClientRect().bottom - root.getBoundingClientRect().top;
        stickD = Math.round(Math.max(STICK_MIN, Math.min(MU_STICK, height - STICK_BOTTOM - col - COLUMN_GAP - border)));
        // The ring is offset by −size / 2 only: its border hangs over the right and the bottom.
        stickY = height - STICK_BOTTOM - stickD / 2 - border;
        stickBase.style.width = stickBase.style.height = `${stickD}px`;
        stickBase.style.marginLeft = stickBase.style.marginTop = `${-stickD / 2}px`;
        hud.setMenu(menuAll);
        placeRow();
        return;
      }
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
      updateSlot();
      if (!h) return;
      if (hintText.textContent !== h.text) hintText.textContent = h.text;
      hint.dataset['pict'] = h.pict ?? '';
      const turn = h.arrow ?? null;
      hintArrow.classList.toggle('shown', turn !== null);
      if (turn !== null) hintArrow.style.transform = `rotate(${turn.toFixed(3)}rad)`;
      // The phone layout: the hint is the text of the slot, not a plaque by the hero.
      if (opts.mu) return;
      // Inside the field, below the top HUD band and above the bottom buttons (docs/01-gdd.md 6.5: never over the HUD).
      const w = hint.offsetWidth;
      const hh = hint.offsetHeight;
      const x = Math.min(fieldW - w / 2 - 8, Math.max(w / 2 + 8, h.x));
      // Under the banner plaque whatever its size on this screen (PR-08: the plaque is taller than the bare text).
      const top = banner.classList.contains('shown')
        ? Math.max(fieldH * HINT_TOP_WAVE, banner.offsetTop + banner.offsetHeight + HINT_UNDER_BANNER)
        : fieldH * HINT_TOP_MIN;
      const y = Math.min(fieldH * HINT_BOTTOM_MAX, Math.max(top + hh, h.y));
      hint.style.transform = `translate(${Math.round(x - w / 2)}px, ${Math.round(y - hh)}px)`;
    },
    setHand(pos) {
      hand.classList.toggle('shown', pos !== null);
      if (pos) hand.style.transform = `translate(${Math.round(pos.x)}px, ${Math.round(pos.y)}px) translate(-50%, -100%)`;
    },
    setShoes(state) {
      const was = shoes.classList.contains('shown');
      shoes.classList.toggle('shown', state !== null);
      if (!state) {
        if (was) placeRow();
        return;
      }
      const before = `${shoesFull}|${shoesShort}`;
      shoesFull = state.text;
      shoesShort = state.short ?? '';
      shoesCapText = state.cap ?? '';
      const short = shoes.classList.contains('short') && !!shoesShort;
      setRich(shoesText, short ? shoesShort : shoesFull);
      shoesCap.textContent = short ? '' : shoesCapText;
      shoes.classList.toggle('capped', !!shoesCapText);
      if (!was || `${shoesFull}|${shoesShort}` !== before) placeRow();
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
        if (next) showToast(next.text, next.sec, next.gold, next.sub, next.onShow);
      }
      if (was !== (text !== null)) updateSlot();
    },
    clearOfHud(r) {
      return !hudRects().some((b) => r.x0 < b.x1 + LABEL_GAP && b.x0 < r.x1 + LABEL_GAP && r.y0 < b.y1 + LABEL_GAP && b.y0 < r.y1 + LABEL_GAP);
    },
    waveBannerRect() {
      if (!banner.classList.contains('shown')) return null;
      const b = banner.getBoundingClientRect();
      const r = root.getBoundingClientRect();
      return { x0: b.left - r.left, y0: b.top - r.top, x1: b.right - r.left, y1: b.bottom - r.top };
    },
    setWayArrow(a) {
      wayArrow.classList.toggle('shown', a !== null);
      if (a) wayArrow.style.transform = `translate(${Math.round(a.x)}px, ${Math.round(a.y)}px) translate(-50%, -50%) rotate(${a.angle.toFixed(3)}rad)`;
    },
    setFrost(level) {
      const v = String(Math.round(Math.max(0, Math.min(1, level)) * 100) / 100);
      if (frost.style.opacity !== v) frost.style.opacity = v;
    },
    setCaveArrow(a) {
      arrow.classList.toggle('shown', a !== null);
      if (a) arrow.style.transform = `translate(${Math.round(a.x)}px, ${Math.round(a.y)}px) translate(-50%, -50%) rotate(${a.angle.toFixed(3)}rad)`;
    },
    toast(text, sec = 2, gold = false, sub, onShow) {
      // Never over the avalanche banner (playtest M2): it waits until the banner goes, the latest few in order.
      if (banner.classList.contains('shown')) {
        pendingToasts.push({ text, sec, gold, sub, onShow });
        if (pendingToasts.length > TOAST_QUEUE_MAX) pendingToasts.shift();
        return;
      }
      showToast(text, sec, gold, sub, onShow);
    },
    setVeil(on) {
      veil.classList.toggle('shown', on);
    },
    setCoins(text) {
      if (coinValue.textContent !== text) coinValue.textContent = text;
      coins.classList.add('shown');
    },
    popCoinGain(text) {
      coinGain.textContent = text;
      coinGain.classList.remove('show');
      coins.classList.remove('pulse');
      void coinGain.offsetWidth;
      coinGain.classList.add('show');
      coins.classList.add('pulse');
    },
    coinTarget() {
      const b = coinIcon.getBoundingClientRect();
      const r = root.getBoundingClientRect();
      return { x: b.left + b.width / 2 - r.left, y: b.top + b.height / 2 - r.top };
    },
    setStat(value, perStep, section = null) {
      if (statValue.textContent !== value) statValue.textContent = value;
      if (statPer.textContent !== perStep) statPer.textContent = perStep;
      const text = section ?? '';
      if (statSection.textContent !== text) statSection.textContent = text;
      statSection.classList.toggle('shown', section !== null);
    },
    setSlow(text) {
      if (statSlow.textContent !== (text ?? '')) statSlow.textContent = text ?? '';
      statSlow.classList.toggle('shown', text !== null);
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
      mountainSlope.replaceChildren(mountainFill);
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
    peekStrip,
    setMountainShown(on) {
      // MU-06: the phone layout keeps the strip on the base too («Camp · mountain N»).
      mountain.classList.toggle('off', !on && !opts.mu);
      baseGifts.classList.toggle('off', on);
    },
    updateMountain(label, hero, wave, blinkCave) {
      if (mountainLabel.textContent !== label) {
        mountainLabel.textContent = label;
        peekStrip();
      }
      mountainHero.style.left = `${(Math.max(0, Math.min(1, hero)) * 100).toFixed(2)}%`;
      if (opts.mu) mountainFill.style.width = mountainHero.style.left;
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
      if (fieldH < SHORT_H && !opts.mu) {
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
    setAdButtons(list) {
      if (ads.classList.contains('shown') !== list.length > 0) {
        ads.classList.toggle('shown', list.length > 0);
        updateSlot();
      }
      while (adBtns.length < list.length) {
        const b = el('button', 'hud-ad');
        let down: { x: number; y: number } | null = null;
        // Fires on release when the finger moved under 10 px (docs/01-gdd.md 10.1); never starts the stick.
        b.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          down = { x: ev.clientX, y: ev.clientY };
        });
        b.addEventListener('pointerup', (ev) => {
          ev.stopPropagation();
          if (ev.pointerType === 'touch' || ev.pointerType === 'pen') dropTapClick();
          const ok = down !== null && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 10;
          down = null;
          if (ok && !b.disabled && b.dataset['ad']) opts.onAd?.(b.dataset['ad']);
        });
        b.addEventListener('click', (ev) => {
          if (ev.detail === 0 && !b.disabled && b.dataset['ad']) opts.onAd?.(b.dataset['ad']);
        });
        ads.appendChild(b);
        adBtns.push(b);
      }
      adBtns.forEach((b, i) => {
        const item = list[i];
        b.hidden = !item;
        if (!item) return;
        b.dataset['ad'] = item.id;
        b.dataset['hud'] = `ad-${item.id}`;
        setRich(b, item.text);
        b.disabled = item.busy;
      });
    },
    setStandButton(state) {
      standBtn.classList.toggle('shown', state !== null);
      if (!state) return;
      if (standBtn.textContent !== state.text) standBtn.textContent = state.text;
      standBtn.style.transform = `translate(${Math.round(state.x)}px, ${Math.round(state.y)}px) translate(-50%, -100%)`;
    },
    setPortalLabels(list, hero) {
      while (portalLabels.length < list.length) {
        const e = el('div', 'hud-egg hud-pad two hud-portal');
        e.dataset['role'] = 'portal-label';
        const name = el('span', 'hud-pad-text');
        const sub = el('span', 'hud-pad-sub');
        e.append(name, sub);
        root.appendChild(e);
        portalLabels.push({ el: e, name, sub, key: '', w: 0, h: 0, g: { x: 0, y: 0, t: 0, shown: false, pick: 0, vis: false, flipAt: -Infinity } });
      }
      const placed: Array<{ x0: number; y0: number; x1: number; y1: number }> = hero ? [hero] : [];
      portalLabels.forEach((p, i) => {
        const s = list[i];
        p.el.classList.toggle('shown', !!s);
        if (!s) {
          drop(p.g);
          return;
        }
        const key = `${s.text}|${s.sub}|${s.locked}`;
        if (p.key !== key) {
          p.key = key;
          p.name.textContent = s.text;
          p.sub.replaceChildren();
          if (s.locked) {
            const lock = el('span', 'mark');
            lock.innerHTML = icon('padlock');
            p.sub.append(lock, ' ');
          }
          p.sub.append(s.sub);
          p.el.classList.toggle('locked', s.locked);
          p.w = p.el.offsetWidth;
          p.h = p.el.offsetHeight;
        }
        // Over its arch; else slid aside of the hero, not farther than its own width from the arch.
        // MU round 4: also under the arch's point, never in the top middle; the place taken last is tried first.
        const xs = [s.x, ...(hero ? [hero.x0 - LABEL_GAP - p.w / 2, hero.x1 + LABEL_GAP + p.w / 2] : [])].filter((x) => Math.abs(x - s.x) <= p.w);
        const cands = [s.y - p.h, s.y + LABEL_GAP, s.y - 2 * p.h].flatMap((y0) => xs.map((x) => ({ x0: x - p.w / 2, y0, x1: x + p.w / 2, y1: y0 + p.h })));
        const ok = (q: (typeof cands)[number]): boolean =>
          q.x0 >= EDGE_MU && q.x1 <= fieldW - EDGE_MU && q.y0 >= 0 && q.y1 <= fieldH && !topMid(q) && hud.clearOfHud(q) && !placed.some((b) => q.x0 < b.x1 + LABEL_GAP && b.x0 < q.x1 + LABEL_GAP && q.y0 < b.y1 + LABEL_GAP && b.y0 < q.y1 + LABEL_GAP);
        const last = cands[p.g.pick];
        const pick = last && ok(last) ? p.g.pick : cands.findIndex(ok);
        const r = cands[pick];
        const vis = steady(p.g, !!r);
        p.el.style.visibility = vis ? '' : 'hidden';
        if (!vis) p.g.shown = false;
        if (!vis || !r) return;
        p.g.pick = pick;
        placed.push(r);
        const at = glideTo(p.g, r.x0, r.y0, (x, y) => ok({ x0: x, y0: y, x1: x + p.w, y1: y + p.h }));
        p.el.style.transform = `translate(${at.x}px, ${at.y}px)`;
      });
    },
    setStandLabel(state) {
      standLabel.classList.toggle('shown', state !== null);
      if (!state) return;
      if (standLabel.textContent !== state.text) standLabel.textContent = state.text;
      standLabel.style.transform = `translate(${Math.round(state.x)}px, ${Math.round(state.y)}px) translate(-50%, -100%)`;
      offHud(standLabel, state.x, state.y);
    },
    setStandHand(pos) {
      standHand.classList.toggle('shown', pos !== null);
      if (!pos) return;
      standHand.style.transform = `translate(${Math.round(pos.x)}px, ${Math.round(pos.y)}px) translate(-50%, -100%)`;
      offHud(standHand, pos.x, pos.y);
    },
    setEggButton(state) {
      eggBtn.classList.toggle('shown', state !== null);
      if (!state) return;
      if (eggBtn.textContent !== state.text) eggBtn.textContent = state.text;
      eggBtn.classList.toggle('can', state.can);
      eggBtn.style.transform = `translate(${Math.round(state.x)}px, ${Math.round(state.y)}px) translate(-50%, -100%)`;
    },
    setRotate(on) {
      rotate.classList.toggle('shown', on);
    },
    setGateSign(state) {
      if (gateBoard.classList.contains('shown') !== (state !== null)) gateBoard.classList.toggle('shown', state !== null);
      if (!state) return;
      if (gateSize.text !== state.text) {
        gateNum.textContent = state.text;
        gateSize = { text: state.text, w: gateBoard.offsetWidth, h: gateBoard.offsetHeight };
      }
      // MU round 3 (reviews: at 815 × 290 the board hid under the slot just as the ridge came): by the top of its post, else
      // the nearest free place around it — lower, aside — 8 px off the HUD; hidden only when there is none.
      const { w, h } = gateSize;
      let r: { x0: number; y0: number; x1: number; y1: number } | undefined;
      for (const [dx, dy] of GATE_SIGN_SHIFTS) {
        const x0 = state.x - w / 2 + dx * w;
        const y0 = state.y - h + dy * h;
        const q = { x0, y0, x1: x0 + w, y1: y0 + h };
        if (q.x0 >= EDGE_MU && q.x1 <= fieldW - EDGE_MU && q.y0 >= 0 && q.y1 <= fieldH && hud.clearOfHud(q)) {
          r = q;
          break;
        }
      }
      gateBoard.style.visibility = r ? '' : 'hidden';
      if (r) gateBoard.style.transform = `translate(${Math.round(r.x0)}px, ${Math.round(r.y0)}px)`;
    },
    setPadLabel(state) {
      padLabel.classList.toggle('shown', state !== null);
      padLabel.classList.toggle('tap', !!state?.tap);
      if (state?.tap) padLabel.dataset['hud'] = 'pad';
      else delete padLabel.dataset['hud'];
      if (!state || state.tap) drop(padGlide);
      if (!state) return;
      setRich(padText, state.text);
      padLabel.classList.toggle('two', !!state.sub);
      if (padSub.textContent !== (state.sub ?? '')) padSub.textContent = state.sub ?? '';
      // The phone places «Stage reward» (with or without its second line) by the rule below; the camp «Teleport» — here.
      if (!opts.mu || state.tap) {
        padLabel.style.transform = `translate(${Math.round(state.x)}px, ${Math.round(state.y)}px) translate(-50%, -100%)`;
        // Round of fixes MU (rule 19): the «Teleport» plaque of the camp pad is not drawn within 8 px of the HUD either.
        const w = opts.mu ? padLabel.offsetWidth : 0;
        const h = opts.mu ? padLabel.offsetHeight : 0;
        padLabel.style.visibility = !opts.mu || hud.clearOfHud({ x0: state.x - w / 2, y0: state.y - h, x1: state.x + w / 2, y1: state.y }) ? '' : 'hidden';
        return;
      }
      // Round of fixes MU (l3-stage-finish): «Stage reward» right of the pad — (x, y) is its right top corner — over it,
      // else level with it, else under its edge: the first place inside the field and 8 px off every HUD block (rule 19).
      const key = `${state.text}|${state.sub}`;
      if (padKey !== key) {
        padKey = key;
        padSize = { w: padLabel.offsetWidth, h: padLabel.offsetHeight };
      }
      // MU round of fixes 2 (staff: the plaque of a pad behind stuck to the left edge): the pad's corner off the field —
      // no plaque; over the hero on the pad the HUD around him leaves room higher up or further right.
      if (state.x < 0 || state.x > fieldW || state.y < 0 || state.y > fieldH) {
        padLabel.style.visibility = 'hidden';
        drop(padGlide);
        return;
      }
      const { w, h } = padSize;
      // MU round 3 (producer's frame: the plaque in the middle over the hero): never on the hero — over his head at most.
      // MU round 4: never in the top middle either; the place taken last is tried first, and the plaque glides there.
      const hero = state.hero;
      const offHero = (x: number, y: number): boolean => !hero || x >= hero.x1 + HERO_GAP || x + w <= hero.x0 - HERO_GAP || y >= hero.y1 + HERO_GAP || y + h <= hero.y0 - HERO_GAP;
      const ys = [state.y - h, state.y - h / 2, state.y, state.y - 1.5 * h, state.y - 2 * h, state.y + h, ...(hero ? [hero.y0 - LABEL_GAP - h] : []), ...(state.pad ? [state.pad.y0 - PAD_GAP - h] : [])];
      // MU round 4: also left of the corner (over the pad itself) — the pad ahead of the hero puts the right side high up.
      // MU round 4 (reviews: the plaque read as the hero's name): the places nearest the pad's corner first.
      const cands = [LABEL_GAP, LABEL_GAP + w / 3, -w - LABEL_GAP, -w - 2 * PAD_SIDE]
        .flatMap((dx) => {
          const x = Math.max(EDGE_MU, Math.min(fieldW - EDGE_MU - w, state.x + dx));
          return ys.map((y) => ({ x, y }));
        })
        .sort((a, b) => Math.hypot(a.x + w / 2 - state.x, a.y + h / 2 - state.y) - Math.hypot(b.x + w / 2 - state.x, b.y + h / 2 - state.y));
      // MU round 5 (producer 21.10: «Stage reward» covered the pad): never over the pad's box on screen either.
      const pad = state.pad;
      const offPad = (x: number, y: number): boolean => !pad || x >= pad.x1 + PAD_GAP || x + w <= pad.x0 - PAD_GAP || y >= pad.y1 + PAD_GAP || y + h <= pad.y0 - PAD_GAP;
      const ok = (c: { x: number; y: number }): boolean => {
        const q = { x0: c.x, y0: c.y, x1: c.x + w, y1: c.y + h };
        return c.y >= 0 && c.y + h <= fieldH && offHero(c.x, c.y) && offPad(c.x, c.y) && !topMid(q) && hud.clearOfHud(q);
      };
      const last = cands[padGlide.pick];
      const pick = last && ok(last) ? padGlide.pick : cands.findIndex(ok);
      const at = cands[pick];
      const vis = steady(padGlide, !!at);
      padLabel.style.visibility = vis ? '' : 'hidden';
      if (!vis) padGlide.shown = false;
      if (!vis || !at) return;
      padGlide.pick = pick;
      const g = glideTo(padGlide, at.x, at.y, (x, y) => ok({ x, y }));
      padLabel.style.transform = `translate(${g.x}px, ${g.y}px)`;
    },
    setTutor(text, urgent = false, arrow = null) {
      if (tutor.classList.contains('shown') !== (text !== null) || tutor.classList.contains('urgent') !== urgent) {
        tutor.classList.toggle('shown', text !== null);
        tutor.classList.toggle('urgent', urgent);
        updateSlot();
      }
      if (text !== null && tutorText.textContent !== text) tutorText.textContent = text;
      turnArrow(tutorArrow, text !== null ? arrow : null);
    },
    setNeed(state) {
      if (need.classList.contains('shown') !== (state !== null)) {
        need.classList.toggle('shown', state !== null);
        updateSlot();
        if (state) peekStrip();
      }
      root.classList.toggle('need-on', state !== null);
      if (!state) return turnArrow(needArrow, null);
      if (needText.textContent !== state.text) needText.textContent = state.text;
      need.classList.toggle('ok', state.ok);
      turnArrow(needArrow, state.arrow ?? null);
    },
    setLevel(state) {
      const on = state !== null;
      if (on !== levelBox.classList.contains('shown')) {
        levelBox.classList.toggle('shown', on);
        root.classList.toggle('levels', on);
        if (on) levelBox.insertBefore(stat, levelBar);
        else left.insertBefore(stat, left.firstChild);
      }
      if (!state) return;
      if (levelTitle.textContent !== state.title) levelTitle.textContent = state.title;
      if (levelProgress.textContent !== state.progress) levelProgress.textContent = state.progress;
      levelFill.style.width = `${Math.round(Math.max(0, Math.min(1, state.frac)) * 1000) / 10}%`;
    },
    setTrophies(text) {
      if (opts.coinsAsTrophies) text = null;
      trophies.classList.toggle('shown', text !== null);
      if (text !== null && trophyValue.textContent !== text) trophyValue.textContent = text;
    },
    popGain(text, x, y) {
      const node = opts.mu ? muGain : gainPool[gainNext % gainPool.length]!;
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
