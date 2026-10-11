// What: The snowball of the caught state: a 3-unit ball around the curled-up hero that grows, rolls with him and pops in the cave.
// Called by: main.ts; app/bots-view.ts (the snowball of «Snowed in!» and the tumble of the rolling ball, tumbleClip).
// Keep: One mesh, hidden when nobody is caught; saves and restores the hero's face, drives hero pose, speedFactor and face while caught; colour from theme.json.

/**
 * The snowball of «Snowed in!» (docs/01-gdd.md 4.5; theme fx.caught = "ball"): a 3-unit ball around the curled-up hero,
 * hat and blinking eyes on top; it grows in while forming, rolls with the hero and pops (shrinks) in the cave.
 * One mesh, hidden when nobody is caught. Colour from theme.json threat.body.
 */
import { Color, Mesh, MeshLambertMaterial, SphereGeometry, type Vector3 } from 'three';
import type { CaughtState } from '../../sim/caught.ts';
import { FACES, type CharacterInstance } from '../characters.ts';

const RADIUS = 1.5;
const BLINK_PERIOD = 0.9;
const BLINK_SHUT = 0.15;
const FACE_OPEN = FACES.indexOf('wow');
const FACE_SHUT = FACES.indexOf('sleep');

export interface Snowball {
  readonly mesh: Mesh;
  /** Every frame: follows the hero while `caught` is set, restores the hero's face after. */
  update(caught: CaughtState | null, pos: Vector3, hero: CharacterInstance, timeSec: number): void;
}

/** The tumble of the rolling snowball (docs/01-gdd.md 18.4) as a clip of this ball on the spot: it forms and pops in
 * TUMBLE_FORM of its seconds each; `t` — seconds of it gone. */
const TUMBLE_FORM = 0.15;
export function tumbleClip(t: number, sec: number, at: { x: number; y: number; z: number }): CaughtState {
  return { t, formSec: TUMBLE_FORM * sec, rollSec: (1 - 2 * TUMBLE_FORM) * sec, popSec: TUMBLE_FORM * sec, from: at, to: at, via: at, niche: -1 };
}

export function createSnowball(color: string): Snowball {
  const mesh = new Mesh(new SphereGeometry(RADIUS, 16, 12), new MeshLambertMaterial({ color: new Color(color) }));
  mesh.name = 'snowball';
  mesh.visible = false;
  let savedFace: number | null = null;
  let lastX = 0;
  let lastZ = 0;
  return {
    mesh,
    update(caught, pos, hero, timeSec) {
      if (!caught) {
        mesh.visible = false;
        if (savedFace !== null) {
          hero.face = savedFace;
          savedFace = null;
        }
        return;
      }
      if (savedFace === null) savedFace = hero.face;
      const popAt = caught.formSec + caught.rollSec;
      const grow = Math.min(1, caught.t / Math.max(1e-3, caught.formSec));
      const pop = caught.popSec > 0 ? Math.max(0, (caught.t - popAt) / caught.popSec) : caught.t >= popAt ? 1 : 0;
      const k = grow * (1 - pop) + (pop > 0 ? 0.3 * Math.sin(pop * Math.PI) : 0);
      mesh.visible = k > 0.02;
      mesh.scale.setScalar(Math.max(0.01, k));
      mesh.position.set(pos.x, pos.y + RADIUS * k, pos.z);
      // Rolling: turn around the axis across the motion.
      const dx = pos.x - lastX;
      const dz = pos.z - lastZ;
      mesh.rotation.x += dz / RADIUS;
      mesh.rotation.z -= dx / RADIUS;
      lastX = pos.x;
      lastZ = pos.z;
      hero.pose = pop >= 1 ? 'idle' : 'ball';
      hero.speedFactor = 0;
      hero.face = timeSec % BLINK_PERIOD < BLINK_SHUT ? FACE_SHUT : FACE_OPEN;
    },
  };
}
