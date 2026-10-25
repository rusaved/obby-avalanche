// What: Visual of the avalanche threat: curved front with its shadow on the slope ahead, snow body (the slope crack on warn), rolling snow clumps and snow dust (at most 4 draw calls), plus the lit cave marker.
// Called by: main.ts; app/handles.ts, app/wave-view.ts; tests/render/avalanche.test.ts.
// Keep: Materials ignore fog and are never culled with chunks (spawn point 160 units up stays visible); front stays within the track; colours and the look of each mountain from theme, feel from tuning.

/**
 * Visual `avalanche` of the threat `wave` (docs/02-tech.md 8.3): at most 4 draw calls — the front (curved plane
 * 48 × 12 with vertex noise, white → blue gradient, light edge, DoubleSide) with its soft shadow on the slope ahead in
 * the same mesh, the snow body behind it (on warn the same box lies flat as the crack on the slope), the snow clumps
 * rolling off the front (one InstancedMesh, half on low) and the snow dust (warn: at the spawn point, run: over the
 * front). All materials ignore fog and nothing is culled with the level chunks: the spawn point 160 units above the hero
 * stays visible on low quality and mountain 4. Colours, height and the look of each mountain (M5-02: colours, number
 * of clumps, the pitch of the rumble — theme.json threat.worlds by the mountain id) come from theme.json, feel numbers
 * from tuning.json. Plus the lit cave marker (docs/01-gdd.md 4.3).
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedMesh,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  type Material,
  type Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ThemeJson, ThreatLook, TuningJson } from '../../content/types.ts';
import type { LevelData } from '../../level/types.ts';
import type { WavePhase } from '../../sim/threat.ts';
import { NICHE_HEIGHT } from '../../level/builder.ts';
import { entranceX } from '../../sim/shelter.ts';

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
/** Height of the flat crack box over the slope on warn. */
const CRACK_HEIGHT = 0.12;
/** The shadow ahead of the front: its length on the slope, its lift off the snow (no z-fight), its grid. */
const SHADOW_LEN = 12;
const SHADOW_LIFT = 0.12;
const SHADOW_ROWS = 3;
/** Snow clumps: the most instances of any mountain (docs/02-tech.md 8.3: 150–300), their sizes and how far ahead they roll. */
const CLUMP_MAX = 300;
const CLUMP_SIZE: [number, number] = [0.5, 1.5];
const CLUMP_ROLL = 7;
/** Defaults of tuning avalanche: the inner glow of the clumps (shade never turns them grey), the ridge on warn (× clump
 * size: a snow ridge seen from 160 units, docs/02-tech.md 8.3), the dust size. */
const CLUMP_GLOW = 0.75;
const CLUMP_WARN_SCALE = 5;
const DUST_SIZE = 2.4;
/** Clumps by default, when a mountain does not say (theme.json threat.clumps). */
const CLUMPS_DEFAULT = 160;

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
  /** The look of the current mountain (theme.json threat + threat.worlds[id]): the rumble pitch for the sound. */
  readonly look: Required<ThreatLook>;
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
uniform float uSlope;
attribute float aShadow;
varying float vH;
varying float vShadow;
varying float vFade;
void main() {
  vec3 p = position;
  float nx = p.x / uHalfW;
  float h = uv.y;
  vShadow = aShadow;
  vFade = 0.0;
  if (aShadow > 0.5) {
    // The shadow lies on the slope ahead of the front (local z < 0, the slope by uSlope), darker closer to the front.
    vFade = (1.0 - clamp(-p.z / ${SHADOW_LEN.toFixed(1)}, 0.0, 1.0)) * (1.0 - nx * nx * 0.7);
    p.z -= (1.0 - nx * nx) * 3.0;
    p.y = 1.0 + ${SHADOW_LIFT.toFixed(2)} + uSlope * p.z;
    h = 0.0;
  } else {
    p.z -= (1.0 - nx * nx) * 3.0 + h * h * 3.0;
    p.z += sin(p.x * 0.35 + uTime * 3.1) * sin(p.y * 0.6 - uTime * 2.3) * uNoise;
    p.y += sin(p.x * 0.5 + uTime * 2.0) * 0.4 * h * uNoise;
  }
  vH = h;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const FRONT_FRAGMENT = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uEdge;
uniform vec3 uShadow;
uniform float uShadowAlpha;
varying float vH;
varying float vShadow;
varying float vFade;
void main() {
  if (vShadow > 0.5) {
    gl_FragColor = vec4(uShadow, uShadowAlpha * vFade);
  } else {
    vec3 c = mix(uBottom, uTop, smoothstep(0.0, 0.8, vH));
    c = mix(c, uEdge, smoothstep(0.85, 1.0, vH));
    gl_FragColor = vec4(c, 1.0);
  }
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** The look of a mountain: the theme's avalanche with that mountain's own values over it (theme.json threat.worlds). */
export function threatLook(theme: ThemeJson, worldId: string): Required<ThreatLook> {
  const t = theme.threat;
  const own = t.worlds?.[worldId] ?? {};
  return {
    front: own.front ?? t.front,
    edge: own.edge ?? t.edge,
    body: own.body ?? t.body,
    dust: own.dust ?? t.dust,
    clump: own.clump ?? t.clump ?? t.body,
    shadow: own.shadow ?? t.shadow ?? t.front[1],
    clumps: Math.min(CLUMP_MAX, Math.max(0, Math.round(own.clumps ?? t.clumps ?? CLUMPS_DEFAULT))),
    rumble: own.rumble ?? t.rumble ?? 0,
  };
}

export function createAvalancheVisual(initial: LevelData, theme: ThemeJson, tuning: TuningJson, rngNext: () => number): AvalancheVisual {
  let level = initial;
  const t = theme.threat;
  const av = tuning.avalanche;
  const group = new Group();
  group.name = 'avalanche';
  let look = threatLook(theme, level.worldId);

  const width = level.width + FRONT_EXTRA;
  // The front and its shadow ahead on the slope: one mesh, the shadow rows marked by aShadow (one draw call).
  const frontPlane = new PlaneGeometry(width, t.height, FRONT_SEGMENTS[0], FRONT_SEGMENTS[1]);
  frontPlane.translate(0, t.height / 2, 0);
  const shadowPlane = new PlaneGeometry(width, SHADOW_LEN, FRONT_SEGMENTS[0], SHADOW_ROWS);
  shadowPlane.rotateX(-Math.PI / 2);
  shadowPlane.translate(0, 0, -SHADOW_LEN / 2);
  frontPlane.setAttribute('aShadow', new Float32BufferAttribute(new Float32Array(frontPlane.attributes['position']!.count), 1));
  shadowPlane.setAttribute('aShadow', new Float32BufferAttribute(new Float32Array(shadowPlane.attributes['position']!.count).fill(1), 1));
  const frontGeo = mergeGeometries([frontPlane, shadowPlane], false) ?? frontPlane;
  if (frontGeo !== frontPlane) frontPlane.dispose();
  shadowPlane.dispose();
  const frontMat = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uNoise: { value: av.noise },
      uHalfW: { value: width / 2 },
      uSlope: { value: 0 },
      uTop: { value: new Color(look.front[0]) },
      uBottom: { value: new Color(look.front[1]) },
      uEdge: { value: new Color(look.edge) },
      uShadow: { value: new Color(look.shadow) },
      uShadowAlpha: { value: 0.55 },
    },
    vertexShader: FRONT_VERTEX,
    fragmentShader: FRONT_FRAGMENT,
    side: DoubleSide,
    transparent: true,
    fog: false,
  });
  const front = new Mesh(frontGeo, frontMat);
  front.name = 'avalanche-front';

  // The body behind the front; on warn the same box lies flat across the slope as the crack (no draw call of its own).
  const bodyGeo = new BoxGeometry(1, 1, 1);
  bodyGeo.translate(0, 0.5, 0.5);
  const bodyMat = new MeshLambertMaterial({ color: new Color(look.body), fog: false });
  const body = new Mesh(bodyGeo, bodyMat);
  body.name = 'avalanche-body';

  // Snow clumps rolling off the front (docs/02-tech.md 8.3): low-poly balls, one InstancedMesh.
  const clumpGeo = new IcosahedronGeometry(1, 0);
  // Lit from within a little: in the shade of the slope a clump stays snow, not a grey stone.
  const clumpMat = new MeshLambertMaterial({ color: new Color(look.clump), emissive: new Color(look.clump), emissiveIntensity: av.clumpGlow ?? CLUMP_GLOW, fog: false });
  const clumps = new InstancedMesh(clumpGeo, clumpMat, CLUMP_MAX);
  clumps.name = 'avalanche-clumps';
  const clumpSeed = new Float32Array(CLUMP_MAX * 4);
  for (let i = 0; i < clumpSeed.length; i++) clumpSeed[i] = rngNext();
  const dummy = new Object3D();

  const dustPos = new Float32Array(DUST_COUNT * 3);
  const dustSeed = new Float32Array(DUST_COUNT * 3);
  for (let i = 0; i < dustSeed.length; i++) dustSeed[i] = rngNext();
  const dustGeo = new BufferGeometry();
  dustGeo.setAttribute('position', new BufferAttribute(dustPos, 3));
  const dustMat = new PointsMaterial({ color: new Color(look.dust), size: av.dustSize ?? DUST_SIZE, fog: false, transparent: true, opacity: 0.85, depthWrite: false });
  const dust = new Points(dustGeo, dustMat);
  dust.name = 'avalanche-dust';

  // Lit cave (docs/01-gdd.md 4.3): glowing ice in the entrance and a pulsing marker above it, one draw call.
  const firstCave = level.niches[0];
  const glowLength = firstCave ? firstCave.box.max[2] - firstCave.box.min[2] : 1;
  const glow = new PlaneGeometry(glowLength, NICHE_HEIGHT);
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

  const parts: Array<Mesh | Points> = [front, body, clumps, dust];
  for (const o of [...parts, marker] as Object3D[]) {
    o.frustumCulled = false;
    o.visible = false;
    group.add(o);
  }
  let particleShare = 1;
  let bodyOn = false;
  let bodyHalf = (level.width - BODY_INSET) / 2;
  const bodyColor = new Color();
  const crackColor = new Color();
  const clumpColor = new Color();
  const applyLook = (): void => {
    frontMat.uniforms['uTop']!.value.set(look.front[0]);
    frontMat.uniforms['uBottom']!.value.set(look.front[1]);
    frontMat.uniforms['uEdge']!.value.set(look.edge);
    frontMat.uniforms['uShadow']!.value.set(look.shadow);
    bodyColor.set(look.body);
    // The crack and the ridge on warn: the shadow colour of the mountain reads on pale snow and fog (art review M5).
    crackColor.set(look.shadow);
    clumpColor.set(look.clump);
    dustMat.color.set(look.dust);
  };
  applyLook();

  const visual: AvalancheVisual = {
    group,
    parts,
    marker,
    get look() {
      return look;
    },
    setParticles(share) {
      particleShare = Math.max(0, Math.min(1, share));
      dustGeo.setDrawRange(0, Math.round(DUST_COUNT * particleShare));
      clumps.count = Math.round(look.clumps * particleShare);
    },
    setLevel(next) {
      level = next;
      bodyHalf = (level.width - BODY_INSET) / 2;
      look = threatLook(theme, level.worldId);
      applyLook();
      visual.setParticles(particleShare);
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
      if (run) {
        const y = level.floorYAt(view.frontZ);
        front.position.set(0, y - 1, view.frontZ);
        frontMat.uniforms['uSlope']!.value = (y - level.floorYAt(view.frontZ - SHADOW_LEN)) / SHADOW_LEN;
      }
      body.visible = run || warn;
      bodyOn = run;
      if (run) {
        const y0 = level.floorYAt(view.frontZ) - 2;
        const yTop = level.floorYAt(view.frontZ) + t.height * 0.85;
        bodyMat.color.copy(bodyColor);
        body.position.set(0, y0, view.frontZ);
        body.scale.set(bodyHalf * 2, yTop - y0, av.bodyLength);
        // The camera inside the body: the body is not drawn, the HUD shows a soft white veil (docs/02-tech.md 7).
        if (visual.insideBody(cameraPos)) body.visible = false;
      } else if (warn) {
        // The crack across the slope where the wave will start.
        bodyMat.color.copy(crackColor);
        body.position.set(0, level.floorYAt(view.spawnZ) + 0.06 - CRACK_HEIGHT / 2, view.spawnZ - CRACK_DEPTH / 2);
        body.scale.set(level.width, CRACK_HEIGHT, CRACK_DEPTH);
      }
      clumps.visible = (run || warn) && clumps.count > 0;
      // On warn the ridge takes the shadow colour of the mountain: white on white snow is lost at 160 units.
      clumpMat.color.copy(warn ? crackColor : clumpColor);
      clumpMat.emissive.copy(warn ? crackColor : clumpColor);
      if (clumps.visible) {
        const half = (level.width - BODY_INSET) / 2;
        for (let i = 0; i < clumps.count; i++) {
          const sx = clumpSeed[i * 4]!;
          const sy = clumpSeed[i * 4 + 1]!;
          const sz = clumpSeed[i * 4 + 2]!;
          const sr = clumpSeed[i * 4 + 3]!;
          if (warn) {
            // The snow breaks loose along the crack: clumps heave up and settle, a white ridge where the wave will start.
            const size = (CLUMP_SIZE[0] + (CLUMP_SIZE[1] - CLUMP_SIZE[0]) * sy) * (av.warnRidgeScale ?? CLUMP_WARN_SCALE);
            const z = view.spawnZ + (sz - 0.5) * 4;
            dummy.position.set((sx * 2 - 1) * half, level.floorYAt(z) + size * 0.4 + Math.abs(Math.sin(timeSec * (1.5 + sr * 2) + sr * 6)) * 3 * sy, z);
            dummy.rotation.set(sr * 6 + timeSec * 0.5, sx * 6, sz * 6);
            dummy.scale.setScalar(size);
            dummy.updateMatrix();
            clumps.setMatrixAt(i, dummy.matrix);
            continue;
          }
          // Each clump drops off the crest, rolls ahead of the front and comes back in: a loop of its own pace.
          const u = (timeSec * (0.45 + sz * 0.5) + sr) % 1;
          const size = CLUMP_SIZE[0] + (CLUMP_SIZE[1] - CLUMP_SIZE[0]) * sy * sy;
          const z = view.frontZ - 1 - u * CLUMP_ROLL * (0.5 + sx * 0.5);
          const fall = Math.max(0, 1 - u * 2.2);
          const y = level.floorYAt(z) + size * 0.8 + fall * t.height * (0.4 + sy * 0.4) + Math.abs(Math.sin(u * Math.PI * 3)) * 0.8;
          dummy.position.set((sx * 2 - 1) * half, y, z);
          dummy.rotation.set(timeSec * (2 + sr * 3), sx * 6, sz * 6);
          dummy.scale.setScalar(size);
          dummy.updateMatrix();
          clumps.setMatrixAt(i, dummy.matrix);
        }
        clumps.instanceMatrix.needsUpdate = true;
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
        // At its mouth: the edge where it stands (SP-04), a rock grotto's face towards the camp.
        // SD-02 (docs/01-gdd.md 23.2): a rock grotto opens to −z — its glow turned across its mouth and as wide as it
        // (producer 15.10: a big blue plate stuck out of the rock, the glow across the slope).
        if (cave.kind === 'island') {
          marker.position.set((cave.box.min[0] + cave.box.max[0]) / 2, cave.y, cave.box.min[2] - 0.2);
          marker.rotation.y = Math.PI / 2;
          marker.scale.set(1, 1, (cave.box.max[0] - cave.box.min[0]) / glowLength);
        } else {
          marker.position.set(entranceX(level, cave) + sign * 0.2, cave.y, cave.z);
          marker.rotation.y = 0;
          marker.scale.set(1, 1, 1);
        }
        markerMat.opacity = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(timeSec * 6));
      }
    },
    dispose() {
      for (const p of [...parts, marker]) {
        p.geometry.dispose();
        (p.material as Material).dispose();
      }
      clumps.dispose();
      gem.dispose();
    },
  };
  visual.setParticles(1);
  return visual;
}
