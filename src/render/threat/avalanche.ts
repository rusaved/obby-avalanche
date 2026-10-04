/**
 * Visual `avalanche` of the threat `wave` (docs/02-tech.md 8.3): at most 4 draw calls — the front (curved plane
 * 48 × 12 with vertex noise, white → blue gradient, light edge, DoubleSide), the snow body behind it, the crack on the
 * slope and the snow dust (warn: at the spawn point, run: over the front). All materials ignore fog and nothing is
 * culled with the level chunks: the spawn point 160 units above the hero stays visible on low quality and mountain 4.
 * Colours and height come from theme.json, feel numbers from tuning.json. Plus the lit cave marker (docs/01-gdd.md 4.3).
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  type Material,
  type Object3D,
  type Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ThemeJson, TuningJson } from '../../content/types.ts';
import type { LevelData } from '../../level/types.ts';
import type { WavePhase } from '../../sim/threat.ts';
import { NICHE_HEIGHT } from '../../level/builder.ts';

const FRONT_SEGMENTS: [number, number] = [48, 12];
/**
 * Extra front width over the track. docs/02-tech.md 8.3 asks for track + 20; the wider plane swept through the caves
 * and cut the hero in the camera frame from the cave, so the front stays within the track (docs/допущения.md).
 */
const FRONT_EXTRA = 0;
/** The body is narrower than the track: the caves at the edges stay outside it (camera frame from the cave, section 7). */
const BODY_INSET = 4;
const DUST_COUNT = 100;
const CRACK_DEPTH = 1.4;

export interface AvalancheView {
  phase: WavePhase;
  spawnZ: number;
  frontZ: number;
  shelter: number;
}

export interface AvalancheVisual {
  readonly group: Group;
  /** Every renderable of the avalanche (tests: fog off, never culled). */
  readonly parts: Array<Mesh | Points>;
  readonly marker: Mesh;
  update(view: AvalancheView, timeSec: number, cameraPos: Vector3): void;
  /** Is the point inside the snow body behind the front (camera veil, docs/02-tech.md 7). */
  insideBody(p: Vector3): boolean;
  /** Share of dust particles drawn: quality `particles` (half on low). */
  setParticles(share: number): void;
  setLevel(level: LevelData): void;
  dispose(): void;
}

const FRONT_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uNoise;
uniform float uHalfW;
varying float vH;
void main() {
  vec3 p = position;
  float nx = p.x / uHalfW;
  float h = uv.y;
  p.z -= (1.0 - nx * nx) * 3.0 + h * h * 3.0;
  p.z += sin(p.x * 0.35 + uTime * 3.1) * sin(p.y * 0.6 - uTime * 2.3) * uNoise;
  p.y += sin(p.x * 0.5 + uTime * 2.0) * 0.4 * h * uNoise;
  vH = h;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const FRONT_FRAGMENT = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uEdge;
varying float vH;
void main() {
  vec3 c = mix(uBottom, uTop, smoothstep(0.0, 0.8, vH));
  c = mix(c, uEdge, smoothstep(0.85, 1.0, vH));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createAvalancheVisual(initial: LevelData, theme: ThemeJson, tuning: TuningJson, rngNext: () => number): AvalancheVisual {
  let level = initial;
  const t = theme.threat;
  const av = tuning.avalanche;
  const group = new Group();
  group.name = 'avalanche';

  const width = level.width + FRONT_EXTRA;
  const frontGeo = new PlaneGeometry(width, t.height, FRONT_SEGMENTS[0], FRONT_SEGMENTS[1]);
  frontGeo.translate(0, t.height / 2, 0);
  const frontMat = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uNoise: { value: av.noise },
      uHalfW: { value: width / 2 },
      uTop: { value: new Color(t.front[0]) },
      uBottom: { value: new Color(t.front[1]) },
      uEdge: { value: new Color(t.edge) },
    },
    vertexShader: FRONT_VERTEX,
    fragmentShader: FRONT_FRAGMENT,
    side: DoubleSide,
    fog: false,
  });
  const front = new Mesh(frontGeo, frontMat);
  front.name = 'avalanche-front';

  const bodyGeo = new BoxGeometry(1, 1, 1);
  bodyGeo.translate(0, 0.5, 0.5);
  const body = new Mesh(bodyGeo, new MeshLambertMaterial({ color: new Color(t.body), fog: false }));
  body.name = 'avalanche-body';

  const crackGeo = new PlaneGeometry(1, CRACK_DEPTH);
  crackGeo.rotateX(-Math.PI / 2);
  const crack = new Mesh(crackGeo, new MeshBasicMaterial({ color: new Color(t.front[1]), fog: false }));
  crack.name = 'avalanche-crack';

  const dustPos = new Float32Array(DUST_COUNT * 3);
  const dustSeed = new Float32Array(DUST_COUNT * 3);
  for (let i = 0; i < dustSeed.length; i++) dustSeed[i] = rngNext();
  const dustGeo = new BufferGeometry();
  dustGeo.setAttribute('position', new BufferAttribute(dustPos, 3));
  const dust = new Points(dustGeo, new PointsMaterial({ color: new Color(t.dust), size: 1.6, fog: false, transparent: true, opacity: 0.85, depthWrite: false }));
  dust.name = 'avalanche-dust';

  // Lit cave (docs/01-gdd.md 4.3): glowing ice in the entrance and a pulsing marker above it, one draw call.
  const firstCave = level.niches[0];
  const glow = new PlaneGeometry(firstCave ? firstCave.box.max[2] - firstCave.box.min[2] : 1, NICHE_HEIGHT);
  glow.rotateY(Math.PI / 2);
  glow.translate(0, NICHE_HEIGHT / 2, 0);
  const gem = new OctahedronGeometry(1.2, 0);
  gem.scale(1, 1.6, 1);
  gem.translate(0, NICHE_HEIGHT + 3, 0);
  const markerGeo = mergeGeometries([glow.toNonIndexed(), gem.toNonIndexed()], false) ?? gem;
  glow.dispose();
  const markerMat = new MeshBasicMaterial({ color: new Color(t.front[1]), transparent: true, opacity: 0.45, side: DoubleSide, fog: false, depthWrite: false });
  const marker = new Mesh(markerGeo, markerMat);
  marker.name = 'cave-marker';

  const parts: Array<Mesh | Points> = [front, body, crack, dust];
  for (const o of [...parts, marker] as Object3D[]) {
    o.frustumCulled = false;
    o.visible = false;
    group.add(o);
  }
  let particleShare = 1;
  let bodyOn = false;
  let bodyHalf = (level.width - BODY_INSET) / 2;

  const visual: AvalancheVisual = {
    group,
    parts,
    marker,
    setParticles(share) {
      particleShare = Math.max(0, Math.min(1, share));
      dustGeo.setDrawRange(0, Math.round(DUST_COUNT * particleShare));
    },
    setLevel(next) {
      level = next;
      bodyHalf = (level.width - BODY_INSET) / 2;
    },
    insideBody(p) {
      if (!bodyOn) return false;
      const z0 = body.position.z;
      return Math.abs(p.x) <= bodyHalf && p.z >= z0 && p.z <= z0 + av.bodyLength && p.y <= body.position.y + body.scale.y;
    },
    update(view, timeSec, cameraPos) {
      const warn = view.phase === 'warn';
      const run = view.phase === 'run';
      frontMat.uniforms['uTime']!.value = timeSec;
      frontMat.uniforms['uNoise']!.value = av.noise;
      front.visible = run;
      if (run) front.position.set(0, level.floorYAt(view.frontZ) - 1, view.frontZ);
      body.visible = run;
      bodyOn = run;
      if (run) {
        const y0 = level.floorYAt(view.frontZ) - 2;
        const yTop = level.floorYAt(view.frontZ) + t.height * 0.85;
        body.position.set(0, y0, view.frontZ);
        body.scale.set(bodyHalf * 2, yTop - y0, av.bodyLength);
        // The camera inside the body: the body is not drawn, the HUD shows a soft white veil (docs/02-tech.md 7).
        if (visual.insideBody(cameraPos)) body.visible = false;
      }
      crack.visible = warn;
      if (warn) {
        crack.position.set(0, level.floorYAt(view.spawnZ) + 0.06, view.spawnZ);
        crack.scale.set(level.width, 1, 1);
      }
      dust.visible = warn || run;
      if (dust.visible) {
        const cz = warn ? view.spawnZ : view.frontZ + 4;
        const cy = level.floorYAt(cz) + (warn ? 2 : t.height * 0.8);
        for (let i = 0; i < DUST_COUNT; i++) {
          const sx = dustSeed[i * 3]!;
          const sy = dustSeed[i * 3 + 1]!;
          const sz = dustSeed[i * 3 + 2]!;
          const rise = (timeSec * (0.6 + sy) + sy * 7) % 6;
          dustPos[i * 3] = (sx - 0.5) * level.width * 1.1;
          dustPos[i * 3 + 1] = cy + rise;
          dustPos[i * 3 + 2] = cz + (sz - 0.5) * 10 + Math.sin(timeSec * 1.7 + sx * 9) * 1.5;
        }
        dustGeo.attributes['position']!.needsUpdate = true;
      }
      const cave = level.niches[view.shelter];
      marker.visible = (warn || run) && cave !== undefined;
      if (cave && marker.visible) {
        const sign = cave.side === 'left' ? -1 : 1;
        marker.position.set(sign * (level.width / 2 + 0.2), cave.y, cave.z);
        markerMat.opacity = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(timeSec * 6));
      }
    },
    dispose() {
      for (const p of [...parts, marker]) {
        p.geometry.dispose();
        (p.material as Material).dispose();
      }
      gem.dispose();
    },
  };
  visual.setParticles(1);
  return visual;
}
