// What: How the rare events of the open slope look: the glowing trail of the rolling snowball on the hero's lane and the ball itself rolling down it.
// Called by: main.ts (createEventsView, update every frame); app/handles.ts (EventsView type, tests).
// Keep: Reads the sim, never changes it; colours from theme.json events; the trail is one ribbon mesh over the floor, the ball the 3-unit sphere of «Snowed in!».

/**
 * The rolling snowball (docs/01-gdd.md 18.4): from its start a ribbon trailWidth wide lies on the hero's lane from the
 * top (where the ball starts) down past him, following the floor; the ball (the same sphere as the snowball of «Snowed
 * in!», 4.5) rolls down it. Both hidden when there is no ball.
 */
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, MeshBasicMaterial, MeshLambertMaterial, SphereGeometry, type Scene } from 'three';
import type { ThemeJson } from '../content/types.ts';
import type { Sim } from '../sim/world.ts';
import type { SnowballState } from '../sim/events.ts';

/** Rows of the ribbon (one every STEP units along the slope at most) and its height over the floor. */
const ROWS = 256;
const STEP = 2;
const LIFT = 0.06;
const TRAIL_OPACITY = 0.75;

export interface EventsViewDeps {
  theme: ThemeJson;
  scene: Scene;
}

export interface EventsView {
  update(sim: Sim): void;
  /** The trail is drawn now (tests). */
  readonly trailShown: boolean;
}

export function createEventsView(d: EventsViewDeps): EventsView {
  const look = d.theme.events?.snowball;
  const pos = new Float32Array(ROWS * 2 * 3);
  const index: number[] = [];
  for (let i = 0; i < ROWS - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setIndex(index);
  const trail = new Mesh(geo, new MeshBasicMaterial({ color: new Color(look?.trail ?? '#ffffff'), transparent: true, opacity: TRAIL_OPACITY, depthWrite: false, side: DoubleSide }));
  trail.frustumCulled = false;
  trail.visible = false;
  trail.renderOrder = 1;
  const ball = new Mesh(new SphereGeometry(1, 16, 12), new MeshLambertMaterial({ color: new Color(look?.ball ?? '#ffffff') }));
  ball.visible = false;
  d.scene.add(trail, ball);
  let laid: SnowballState | null = null;
  let lastZ = 0;

  // The ribbon from z0 down to z1 on lane x, row by row on the floor.
  const lay = (sim: Sim, s: SnowballState, half: number): void => {
    const rows = Math.min(ROWS, Math.max(2, Math.ceil((s.z0 - s.z1) / STEP) + 1));
    for (let i = 0; i < ROWS; i++) {
      const z = s.z0 - ((s.z0 - s.z1) * Math.min(i, rows - 1)) / (rows - 1);
      for (let k = 0; k < 2; k++) {
        const x = s.x + (k === 0 ? -half : half);
        pos.set([x, sim.level.floorAt(x, z) + LIFT, z], (i * 2 + k) * 3);
      }
    }
    geo.attributes['position']!.needsUpdate = true;
    geo.computeBoundingSphere();
  };

  return {
    get trailShown() {
      return trail.visible;
    },
    update(sim) {
      const s = sim.rare?.state.snowball ?? null;
      const cfg = sim.rare ? sim.rare.cfg.snowball : undefined;
      trail.visible = ball.visible = !!s && !!cfg;
      if (!s || !cfg) {
        laid = null;
        return;
      }
      if (laid !== s) {
        lay(sim, s, cfg.trailWidth / 2);
        laid = s;
        lastZ = s.z;
      }
      const r = cfg.size / 2;
      ball.scale.setScalar(r);
      ball.position.set(s.x, sim.level.floorAt(s.x, s.z) + r, s.z);
      // Rolling down the slope: turns around the axis across it.
      ball.rotation.x -= (lastZ - s.z) / r;
      lastZ = s.z;
    },
  };
}
