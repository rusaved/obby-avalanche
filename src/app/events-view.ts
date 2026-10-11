// What: How the rare events of the open slope look: the trail of the rolling snowball and the ball; the blizzard — nearer fog, thick snow round the camera, the shelters of its section glowing through it.
// Called by: main.ts (createEventsView, update every frame); app/handles.ts (EventsView type, tests).
// Keep: Reads the sim, never changes it; colours from theme.json events; the trail one ribbon, the ball the 3-unit sphere of «Snowed in!»; the blizzard +2 draw calls (snow, glows) and the fog given back as it was.

/**
 * The rolling snowball (docs/01-gdd.md 18.4): from its start a ribbon trailWidth wide lies on the hero's lane from the
 * top (where the ball starts) down past him, following the floor; the ball (the same sphere as the snowball of «Snowed
 * in!», 4.5) rolls down it. Both hidden when there is no ball. The blizzard, while the hero is in its section: the fog
 * × fogMult nearer in its colour, snow × snowMult (within the snowflakes of the quality) falling round the camera, a warm gem
 * over every shelter of the section seen through the fog; it comes and goes over RAMP_SEC.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Fog,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  Points,
  PointsMaterial,
  SphereGeometry,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import type { ThemeJson } from '../content/types.ts';
import type { Sim } from '../sim/world.ts';
import type { SnowballState } from '../sim/events.ts';

/** Rows of the ribbon (one every STEP units along the slope at most) and its height over the floor. */
const ROWS = 256;
const STEP = 2;
const LIFT = 0.06;
const TRAIL_OPACITY = 0.75;
/** The blizzard: comes and goes over this long; snowflakes per 1 of snowMult (up to SNOW_MAX_MULT) in a box this big
 * round the camera, their fall and the wind; the gems over the shelters (at most GLOWS) this high over the mouth. */
const RAMP_SEC = 1;
const SNOW_PER = 220;
const SNOW_BOX: [number, number, number] = [60, 26, 60];
const SNOW_FALL = 7;
const SNOW_WIND = 5;
const SNOW_SIZE = 0.35;
const SNOW_MAX_MULT = 4;
const GLOWS = 16;
const GLOW_RISE = 5;

export interface EventsViewDeps {
  theme: ThemeJson;
  scene: Scene;
  camera(): PerspectiveCamera | null;
  /** Snowflakes of the quality level at most (render/quality.ts; 0 on a weak phone). */
  snowflakes(): number;
}

export interface EventsView {
  /** `dt` — seconds of this frame (the blizzard comes and goes over RAMP_SEC). */
  update(sim: Sim, dt: number): void;
  /** The trail is drawn now; how far the blizzard has come (0–1), its snowflakes and glows drawn, the fog's end (tests). */
  readonly trailShown: boolean;
  readonly blizzard: { k: number; snow: number; glows: number; fogFar: number };
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
  let time = 0;

  // The blizzard: snow round the camera, gems over the shelters, the fog given back as the renderer had it.
  const bz = d.theme.events?.blizzard;
  const flakes = SNOW_PER * SNOW_MAX_MULT;
  const seeds = new Float32Array(flakes * 3);
  let seed = 7;
  for (let i = 0; i < seeds.length; i++) seeds[i] = (seed = (seed * 16807) % 2147483647) / 2147483647;
  const snowPos = new Float32Array(flakes * 3);
  const snowGeo = new BufferGeometry();
  snowGeo.setAttribute('position', new BufferAttribute(snowPos, 3));
  const snow = new Points(snowGeo, new PointsMaterial({ color: new Color(bz?.snow ?? '#ffffff'), size: SNOW_SIZE, transparent: true, depthWrite: false, fog: false }));
  const glowMat = new MeshBasicMaterial({ color: new Color(bz?.glow ?? '#ffffff'), transparent: true, fog: false, depthWrite: false });
  const glows = new InstancedMesh(new OctahedronGeometry(1.2, 0), glowMat, GLOWS);
  for (const o of [snow, glows]) {
    o.frustumCulled = false;
    o.visible = false;
  }
  d.scene.add(snow, glows);
  const fogColor = new Color();
  const blizzardFog = new Color(bz?.fog ?? '#ffffff');
  const m = new Matrix4();
  let k = 0;
  let base: { near: number; far: number; color: Color } | null = null;
  let applied = { near: -1, far: -1 };
  const info = { k: 0, snow: 0, glows: 0, fogFar: 0 };

  const weather = (sim: Sim, dt: number, timeSec: number): void => {
    const cfg = sim.rare?.cfg.blizzard;
    const on = !!cfg && (sim.rare?.speedMultAt(sim.hero.pos.z) ?? 1) < 1;
    k = Math.max(0, Math.min(1, k + (on ? dt : -dt) / RAMP_SEC));
    const fog = d.scene.fog instanceof Fog ? d.scene.fog : null;
    // The renderer set the fog anew (quality) or the blizzard has not touched it: that is the fog to give back.
    if (fog && (fog.near !== applied.near || fog.far !== applied.far)) base = { near: fog.near, far: fog.far, color: fog.color.clone() };
    info.k = k;
    snow.visible = glows.visible = k > 0 && !!cfg;
    if (fog && base) {
      const f = 1 - k * (1 - (cfg?.fogMult ?? 1));
      fog.near = base.near * f;
      fog.far = base.far * f;
      fog.color.copy(fogColor.copy(base.color).lerp(blizzardFog, k));
      applied = { near: fog.near, far: fog.far };
      info.fogFar = fog.far;
    }
    if (!snow.visible || !cfg) {
      info.snow = info.glows = 0;
      return;
    }
    const n = Math.round(Math.min(flakes, d.snowflakes(), SNOW_PER * cfg.snowMult) * k);
    const cam = d.camera();
    const [cx, cy, cz] = cam ? [cam.position.x, cam.position.y, cam.position.z] : [sim.hero.pos.x, sim.hero.pos.y, sim.hero.pos.z];
    const [bx, by, bzz] = SNOW_BOX;
    for (let i = 0; i < n; i++) {
      const [sx, sy, sz] = [seeds[i * 3]!, seeds[i * 3 + 1]!, seeds[i * 3 + 2]!];
      const fall = (sy * by + timeSec * SNOW_FALL * (0.7 + 0.6 * sx)) % by;
      const wind = (sx * bx + timeSec * SNOW_WIND) % bx;
      snowPos.set([cx - bx / 2 + ((wind - cx + bx * 1000) % bx), cy + by / 2 - fall, cz - bzz / 2 + ((sz * bzz - cz + bzz * 1000) % bzz)], i * 3);
    }
    snowGeo.setDrawRange(0, n);
    snowGeo.attributes['position']!.needsUpdate = true;
    info.snow = n;
    // The shelters of the blizzard's section: a warm gem over each mouth, pulsing.
    const b = sim.rare!.state.blizzard;
    let g = 0;
    for (const c of sim.level.niches) {
      if (!b || g >= GLOWS || c.z < b.z0 || c.z >= b.z1) continue;
      const x = c.side === 'left' ? c.box.max[0] : c.box.min[0];
      const pulse = 1 + 0.15 * Math.sin(timeSec * 5 + g);
      glows.setMatrixAt(g++, m.makeScale(pulse, pulse * 1.6, pulse).setPosition(x, c.y + GLOW_RISE, c.z));
    }
    glows.count = g;
    glows.instanceMatrix.needsUpdate = true;
    glowMat.opacity = 0.9 * k;
    info.glows = g;
  };

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
    blizzard: info,
    update(sim, dt) {
      time += dt;
      weather(sim, dt, time);
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
