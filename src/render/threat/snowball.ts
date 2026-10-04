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
