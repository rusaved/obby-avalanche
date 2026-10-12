// What: The points of the base in the world (docs/01-gdd.md 19.3): the hero near a stand and standing — its button over it; the hand over a stand with something to take; a plaque over a stand (the gift's timer); one button at a time, at the nearest stand.
// Called by: main.ts (createStandsView, per frame; the HUD stand button calls press); app/handles.ts (type).
// Keep: Reads the sim, never changes it; what a stand does and when it is there comes from its behaviour in main.ts; a window opens only by the button (10.2).

import { Vector3 } from 'three';
import type { Sim } from '../sim/world.ts';
import type { Hud } from '../ui/hud.ts';
import type { CameraRig } from '../render/camera.ts';

/** The hero counts as standing below this speed (units/s), as at an egg stand. */
const STAND_SPEED = 1.5;
/** The button and the hand float this high over a stand (units). */
const BUTTON_ABOVE = 3.4;
const HAND_ABOVE = 5.6;

/** What a stand of the base does (its kind in base.json `stands`). */
export interface StandBehaviour {
  /** The stand is there now (the shop: with the «Shop» button of the HUD, 180 s). */
  due(): boolean;
  /** The text of its button; null — no button now. */
  text(): string | null;
  /** Something to take there now: the hand over it. */
  hand(): boolean;
  /** A plaque over it while its button is not up (the gift: «!» or «in 14:20»); absent or null — none. */
  label?(): string | null;
  press(): void;
}

export interface StandsViewDeps {
  getSim(): Sim;
  hud: Hud;
  camera: CameraRig;
  field(): { width: number; height: number };
  onBase(): boolean;
  windowOpen(): boolean;
  stands: Partial<Record<string, StandBehaviour>>;
}

export interface StandsView {
  update(dt: number): void;
  /** The stand button pressed. */
  press(): void;
  /** For __TEST__.state(): the kind of the stand whose button is up, and the stands with a hand. */
  readonly button: string | null;
  readonly hands: string[];
  /** The text of the stand plaque up now (null — none). */
  readonly label: string | null;
}

export function createStandsView(d: StandsViewDeps): StandsView {
  const p = new Vector3();
  let stood = 0;
  let at: string | null = null;
  const project = (x: number, y: number, z: number): { x: number; y: number } | null => {
    p.set(x, y, z).project(d.camera.camera);
    if (p.z >= 1) return null;
    const f = d.field();
    return { x: (p.x * 0.5 + 0.5) * f.width, y: (0.5 - p.y * 0.5) * f.height };
  };
  const view: StandsView & { button: string | null; hands: string[]; label: string | null } = {
    button: null,
    hands: [],
    label: null,
    update(dt) {
      const sim = d.getSim();
      const stands = d.onBase() ? sim.level.points.filter((q) => q.type === 'stand' && d.stands[String(q['kind'])]?.due()) : [];
      const busy = d.windowOpen();
      // The hand over each stand with something to take (the first one only: one hand on the screen).
      const handAt = busy ? undefined : stands.find((q) => d.stands[String(q['kind'])]!.hand());
      view.hands = handAt ? [String(handAt['kind'])] : [];
      d.hud.setStandHand(handAt ? project(handAt.x, HAND_ABOVE, handAt.z) : null);
      // The nearest stand within its radius; standing there its `standSec` — its button.
      const h = sim.hero.pos;
      let near: (typeof stands)[number] | undefined;
      for (const q of stands) {
        const dist = Math.hypot(h.x - q.x, h.z - q.z);
        if (dist <= Number(q['radius'] ?? 0) && (!near || dist < Math.hypot(h.x - near.x, h.z - near.z))) near = q;
      }
      const kind = near ? String(near['kind']) : null;
      if (kind !== at) stood = 0;
      at = kind;
      stood = near && sim.hero.speed < STAND_SPEED ? stood + dt : 0;
      const text = near && !busy && stood >= Number(near['standSec'] ?? 0) ? d.stands[kind!]!.text() : null;
      const pos = text && near ? project(near.x, BUTTON_ABOVE, near.z) : null;
      view.button = text && pos ? kind : null;
      d.hud.setStandButton(text && pos ? { text, x: pos.x, y: pos.y } : null);
      // The plaque of a stand (one: the first with one), not under its own button.
      let label: { text: string; x: number; y: number } | null = null;
      for (const q of stands) {
        const k = String(q['kind']);
        const l = busy || k === view.button ? null : (d.stands[k]!.label?.() ?? null);
        const lp = l ? project(q.x, BUTTON_ABOVE, q.z) : null;
        if (l && lp) {
          label = { text: l, ...lp };
          break;
        }
      }
      view.label = label?.text ?? null;
      d.hud.setStandLabel(label);
    },
    press() {
      if (view.button) d.stands[view.button]?.press();
    },
  };
  return view;
}
