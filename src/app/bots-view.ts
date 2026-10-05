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
import { createSnowball, type Snowball } from '../render/threat/snowball.ts';
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
  const slots: Array<{ ch: CharacterInstance; ball: Snowball; label: HTMLElement; text: string; shown: boolean; painted: string; prev: Vector3; cur: Vector3; tick: number }> = [];
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
    slots.push({ ch, ball, label, text: '', shown: false, painted: '', prev: new Vector3(), cur: new Vector3(), tick: -1 });
  }
  const pos = new Vector3();
  const head = new Vector3();
  let lastSim: Sim | null = null;
  let fontPx = 0;

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
          d.characters.paint(s.ch, { head: b.look.head, torso: b.look.jacket, arms: b.look.jacket, legs: b.look.pants, hat: d.cfg.palette.hat, hatColor: b.look.hat, face: b.look.face });
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
        s.ball.update(b.ball, pos, s.ch, timeSec);
        // The name over the head.
        let opacity = 0;
        if (namesOn && cam && !b.ball) {
          head.set(pos.x, pos.y + LABEL_LIFT, pos.z);
          const dist = head.distanceTo(cam.position);
          const fade = d.cfg.label.fadeDist;
          opacity = dist <= d.cfg.label.nearDist ? 1 : fade > 0 ? Math.max(0, 1 - (dist - d.cfg.label.nearDist) / fade) : 0;
          if (opacity > 0) {
            head.project(cam);
            if (head.z >= 1 || Math.abs(head.x) > 1.1 || Math.abs(head.y) > 1.1) opacity = 0;
            else s.label.style.transform = `translate(${((head.x * 0.5 + 0.5) * f.width).toFixed(1)}px, ${((0.5 - head.y * 0.5) * f.height).toFixed(1)}px) translate(-50%, -100%)`;
          }
        }
        const text = t(b.name);
        if (text !== s.text) {
          s.text = text;
          s.label.textContent = text;
        }
        const shown = opacity > 0;
        if (shown || s.shown) s.label.style.opacity = shown ? (LABEL_OPACITY * opacity).toFixed(2) : '0';
        s.shown = shown;
      });
    },
    labels() {
      return slots.map((s) => ({ text: s.shown ? s.text : '', shown: s.shown }));
    },
  };
}
