// What: Draws bots on screen: blocky figures, a snowball while one rolls and a DOM name label over the head (pool moved by transform only).
// Called by: main.ts (createBotsView); app/handles.ts (BotsView and HudMode types).
// Keep: Reads the sim only; names stay hidden with showNames false, in HUD modes shots/promo and in the photo studio; distances and fades come from content bots.

/**
 * Bots on screen (docs/01-gdd.md 7.12): blocky figures of the same instanced generator in their own colours, a
 * snowball while one rolls, and a small grey name over the head — a DOM pool like «+1», moved only by transform.
 * Names: full up to `label.nearDist` from the camera, faded over `label.fadeDist`; none at all with
 * `showNames: false`, in the HUD modes `shots` and `promo` and in the photo studio. Reads the simulation only.
 */
import { Vector3, type Camera, type Scene } from 'three';
import type { BotsJson } from '../content/types.ts';
import type { Sim } from '../sim/world.ts';
import type { Characters, CharacterInstance } from '../render/characters.ts';
import { createSnowball, tumbleClip, type Snowball } from '../render/threat/snowball.ts';
import { HERO_HEIGHT } from '../sim/controller.ts';
import { t } from '../ui/i18n.ts';

/** Label over the head, units above the feet. */
const LABEL_LIFT = HERO_HEIGHT + 0.6;
/** Label font: 12 px on a 360 px high field, up to 14 px on big screens (docs/01-gdd.md 7.12). */
const FONT_MIN = 12;
const FONT_MAX = 14;
const FONT_FROM_H = 360;
const FONT_TO_H = 1080;
const LABEL_OPACITY = 0.8;
/** K-01: px kept clear between two bot names. */
const LABEL_GAP = 2;

export type HudMode = 'normal' | 'shots' | 'promo';

export interface BotsViewDeps {
  cfg: BotsJson;
  characters: Characters;
  scene: Scene;
  ui: HTMLElement;
  snowColor: string;
  getSim(): Sim;
  camera(): Camera | null;
  /** The bot at these feet stands too close to the camera or in front of the hero: hidden (playtest M2). */
  hides(feet: Vector3): boolean;
  field(): { width: number; height: number };
  /** HUD mode of the shots and the promo video, and the photo studio: names hidden. */
  hudMode(): HudMode;
  studio: boolean;
  /** Strides a second × this at a run speed (SP-03: render/characters.ts runCadence); absent — 1. */
  cadence?(speed: number): number;
  /** Round of fixes MU (docs/07-mobile-ui.md, rule 19): is a name's box (field px) clear of the phone HUD; absent — yes. */
  clear?(r: { x0: number; y0: number; x1: number; y1: number }): boolean;
}

export interface BotLabelState {
  text: string;
  shown: boolean;
}

export interface BotsView {
  /** Every frame after the simulation: positions (interpolated between ticks), poses, balls and labels. */
  update(alpha: number, timeSec: number): void;
  /** For __TEST__.state(): per bot slot, what its label shows. */
  labels(): BotLabelState[];
}

export function createBotsView(d: BotsViewDeps): BotsView {
  const slots: Array<{ ch: CharacterInstance; ball: Snowball; label: HTMLElement; text: string; width: number; shown: boolean; painted: string; prev: Vector3; cur: Vector3; tick: number }> = [];
  const most = Math.max(d.cfg.count.high, d.cfg.count.medium, d.cfg.count.low);
  const layer = document.createElement('div');
  layer.className = 'bot-labels';
  d.ui.prepend(layer);
  for (let i = 0; i < most; i++) {
    const ch = d.characters.create('');
    ch.visible = false;
    const ball = createSnowball(d.snowColor);
    d.scene.add(ball.mesh);
    const label = document.createElement('div');
    label.className = 'bot-label';
    label.dataset['role'] = 'bot-label';
    layer.appendChild(label);
    slots.push({ ch, ball, label, text: '', width: 0, shown: false, painted: '', prev: new Vector3(), cur: new Vector3(), tick: -1 });
  }
  const pos = new Vector3();
  const head = new Vector3();
  let lastSim: Sim | null = null;
  let fontPx = 0;
  const placed: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];

  return {
    update(alpha, timeSec) {
      const sim = d.getSim();
      const list = sim.bots?.list ?? [];
      const cam = d.camera();
      const f = d.field();
      const namesOn = d.cfg.showNames && d.hudMode() === 'normal' && !d.studio;
      const font = Math.round(FONT_MIN + (FONT_MAX - FONT_MIN) * Math.min(1, Math.max(0, (f.height - FONT_FROM_H) / (FONT_TO_H - FONT_FROM_H))));
      if (font !== fontPx) {
        fontPx = font;
        layer.style.fontSize = `${font}px`;
      }
      const newSim = sim !== lastSim;
      lastSim = sim;
      // K-01 (review D20: names over a heap of bots ran into each other): a name that would cover one already placed this
      // frame stays hidden (the one placed first keeps his).
      placed.length = 0;
      slots.forEach((s, i) => {
        const b = list[i];
        const out = b !== undefined && b.mode !== 'away' && b.mode !== 'off';
        if (!b || !out) {
          s.ch.visible = false;
          s.ball.update(null, pos, s.ch, timeSec);
          s.tick = -1;
          if (s.shown) {
            s.shown = false;
            s.label.style.opacity = '0';
          }
          return;
        }
        // Look: the bot's colours and hat (repainted when the slot gets another bot or a new look).
        const key = `${b.look.head}${b.look.jacket}${b.look.pants}${b.look.hat}${b.look.face}`;
        if (key !== s.painted) {
          s.painted = key;
          d.characters.paint(s.ch, { head: b.look.head, torso: b.look.jacket, arms: b.look.jacket, legs: b.look.pants, hat: d.cfg.palette.hat, hatColor: b.look.hat, face: b.look.face, cut: 'jacket' });
        }
        // Interpolation between the last two ticks (docs/02-tech.md 4.2).
        if (newSim || s.tick < 0) {
          s.prev.set(b.x, b.y, b.z);
          s.cur.set(b.x, b.y, b.z);
        } else if (s.tick !== sim.tick) {
          s.prev.copy(s.cur);
          s.cur.set(b.x, b.y, b.z);
        }
        s.tick = sim.tick;
        pos.copy(s.prev).lerp(s.cur, alpha);
        s.ch.visible = !d.hides(pos);
        s.ch.position.copy(pos);
        s.ch.yaw = b.yaw;
        s.ch.pose = b.moving ? 'run' : 'idle';
        s.ch.speedFactor = b.moving ? 1 : 0;
        // The legs by the bot's own speed: its way from the last tick to this one.
        s.ch.cadence = d.cadence && b.moving ? d.cadence(Math.hypot(s.cur.x - s.prev.x, s.cur.z - s.prev.z) * 60) : 1;
        // Hit by the rolling snowball (docs/01-gdd.md 18.4): the same ball round him on the spot.
        const tumbleSec = sim.rare?.cfg.snowball?.tumbleSec ?? 0;
        s.ball.update(b.ball ?? (b.tumble > 0 && tumbleSec > 0 ? tumbleClip(tumbleSec - b.tumble, tumbleSec, pos) : null), pos, s.ch, timeSec);
        // The name over the head.
        const text = t(b.name);
        if (text !== s.text) {
          s.text = text;
          s.label.textContent = text;
          s.width = 0;
        }
        let opacity = 0;
        let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
        if (namesOn && cam && !b.ball) {
          head.set(pos.x, pos.y + LABEL_LIFT, pos.z);
          const dist = head.distanceTo(cam.position);
          const fade = d.cfg.label.fadeDist;
          opacity = dist <= d.cfg.label.nearDist ? 1 : fade > 0 ? Math.max(0, 1 - (dist - d.cfg.label.nearDist) / fade) : 0;
          if (opacity > 0) {
            head.project(cam);
            const x = (head.x * 0.5 + 0.5) * f.width;
            const y = (0.5 - head.y * 0.5) * f.height;
            if (s.width === 0) s.width = s.label.offsetWidth;
            const r = { x0: x - s.width / 2, y0: y - fontPx, x1: x + s.width / 2, y1: y };
            box = r;
            if (head.z >= 1 || Math.abs(head.x) > 1.1 || Math.abs(head.y) > 1.1) opacity = 0;
            // Round of fixes MU (staff 19.10: names showed through the tiles and the strip): not within 8 px of the HUD.
            else if (d.clear && !d.clear(r)) opacity = 0;
            else if (placed.some((p) => r.x0 < p.x1 + LABEL_GAP && r.x1 > p.x0 - LABEL_GAP && r.y0 < p.y1 + LABEL_GAP && r.y1 > p.y0 - LABEL_GAP)) opacity = 0;
            else s.label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
          }
        }
        const shown = opacity > 0;
        if (shown && box) placed.push(box);
        if (shown || s.shown) s.label.style.opacity = shown ? (LABEL_OPACITY * opacity).toFixed(2) : '0';
        s.shown = shown;
      });
    },
    labels() {
      return slots.map((s) => ({ text: s.shown ? s.text : '', shown: s.shown }));
    },
  };
}
