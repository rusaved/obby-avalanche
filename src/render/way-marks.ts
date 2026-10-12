// What: Way marks of the open slope: the summit portal filled with light under a pillar of light, arrows on the snow to the portal and to the way into each element (throat, tunnel, hump).
// Called by: render/level-mesh.ts (createLevelMeshes adds the group and disposes it); test-api reads `marks` and `pillar` through LevelMeshes.wayMarks.
// Keep: Render only, no colliders; two draw calls (glow, arrows), none without theme fx.portal; colours from theme.json materials (portal, portalLight, wayArrow).

/**
 * Where to run (docs/01-gdd.md 19.8; docs/01a-content.md 18.6): the portal of the summit is filled with light and a pillar
 * of light `fx.portal.pillar` tall stands in it, seen from the start of the finish straight; `fx.portal.arrows` arrows on
 * the snow lead from the giant's line to it, and as many lead into the way of each element of the slope.
 */
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Mesh, MeshBasicMaterial, Object3D } from 'three';
import type { ThemeJson } from '../content/types.ts';
import type { LevelData } from '../level/types.ts';
import { PORTAL_WIDTH } from '../level/builder.ts';

/** Arch height and pillar width of a portal (units); the arrows: length, width, stroke, gap between them. */
export const PORTAL_HEIGHT = 10;
const PILLAR_WIDTH = 3;
const ARROW_LEN = 4;
const ARROW_WIDTH = 4;
const ARROW_STROKE = 1.2;
const ARROW_STEP = 7;
const GLOW_OPACITY = 0.55;

export interface WayMark {
  x: number;
  y: number;
  z: number;
  /** What the arrow leads to. */
  to: 'portal' | 'throat' | 'tunnel' | 'hump';
}

export interface WayMarks {
  group: Group;
  marks: WayMark[];
  /** The pillar of light of the summit portal (centre x, z; bottom and top y); null — none. */
  pillar: { x: number; z: number; y0: number; y1: number } | null;
  /** SP-01 (docs/01-gdd.md 20.2): the light is not drawn while the camera is inside the pillar; back when it is out. */
  guard(camera: { x: number; y: number; z: number }): void;
  /** Is a point inside the pillar of light (tests: the camera never is). */
  insidePillar(p: { x: number; y: number; z: number }): boolean;
  dispose(): void;
}

/** One quad as two triangles with a colour per vertex. */
function quad(pos: number[], col: number[], c: Color, a: number[], b: number[], d: number[], e: number[]): void {
  pos.push(...a, ...b, ...d, ...a, ...d, ...e);
  for (let i = 0; i < 6; i++) col.push(c.r, c.g, c.b);
}

/**
 * A portal filled with light: the plane inside its arch (`width` with 1-unit pillars, PORTAL_HEIGHT tall) in `fill`, and a
 * pillar of light `pillar` tall in `light` (4 sides). One geometry with vertex colours: one draw call with any others.
 */
export function portalGlowGeometry(x: number, y: number, z: number, width: number, pillar: number, fill: Color, light: Color, pos: number[] = [], col: number[] = []): { pos: number[]; col: number[] } {
  const hw = width / 2 - 1;
  quad(pos, col, fill, [x - hw, y, z], [x + hw, y, z], [x + hw, y + PORTAL_HEIGHT - 1, z], [x - hw, y + PORTAL_HEIGHT - 1, z]);
  if (pillar > 0) {
    const p = PILLAR_WIDTH / 2;
    const top = y + pillar;
    quad(pos, col, light, [x - p, y, z - p], [x + p, y, z - p], [x + p, top, z - p], [x - p, top, z - p]);
    quad(pos, col, light, [x - p, y, z + p], [x + p, y, z + p], [x + p, top, z + p], [x - p, top, z + p]);
    quad(pos, col, light, [x - p, y, z - p], [x - p, y, z + p], [x - p, top, z + p], [x - p, top, z - p]);
    quad(pos, col, light, [x + p, y, z - p], [x + p, y, z + p], [x + p, top, z + p], [x + p, top, z - p]);
  }
  return { pos, col };
}

/** A flat chevron pointing +z (two strokes meeting at the tip). */
export function chevronGeometry(len = ARROW_LEN, width = ARROW_WIDTH, stroke = ARROW_STROKE): BufferGeometry {
  const W = width / 2;
  const L = len;
  const T = stroke;
  const v = [-W, 0, -L / 2, -W + T, 0, -L / 2, 0, 0, L / 2 - T, -W, 0, -L / 2, 0, 0, L / 2 - T, 0, 0, L / 2,
    W, 0, -L / 2, 0, 0, L / 2, 0, 0, L / 2 - T, W, 0, -L / 2, 0, 0, L / 2 - T, W - T, 0, -L / 2];
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

/** Arrows pointing +z ending `ARROW_STEP / 2` before `zEnd` at `x`, every ARROW_STEP downhill; none over a hole. */
function arrowsTo(level: LevelData, x: number, zEnd: number, n: number, to: WayMark['to'], out: WayMark[]): void {
  for (let k = 0; k < n; k++) {
    const z = zEnd - ARROW_STEP / 2 - k * ARROW_STEP;
    const y = level.floorAt(x, z);
    if (Number.isFinite(y)) out.push({ x, y, z, to });
  }
}

export function createWayMarks(level: LevelData, theme: ThemeJson): WayMarks {
  const group = new Group();
  group.name = 'way-marks';
  const cfg = theme.fx.portal;
  const marks: WayMark[] = [];
  let pillar: WayMarks['pillar'] = null;
  // The open slope only (its sections): the classic and fast summits keep their look.
  const portal = level.sections.length > 0 ? level.points.find((p) => p.type === 'portal') : undefined;
  if (!cfg || !portal) return { group, marks, pillar, guard: () => {}, insidePillar: () => false, dispose: () => {} };
  const color = (key: string): Color => new Color(theme.materials[key]?.emissive ?? theme.materials[key]?.color ?? '#ffffff');

  const width = typeof portal['width'] === 'number' ? (portal['width'] as number) : PORTAL_WIDTH;
  const { pos, col } = portalGlowGeometry(portal.x, portal.y, portal.z, cfg.fill ? width : 0, cfg.pillar, color('portal'), color('portalLight'));
  const glowGeo = new BufferGeometry();
  glowGeo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  glowGeo.setAttribute('color', new Float32BufferAttribute(col, 3));
  const glowMat = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: GLOW_OPACITY, depthWrite: false, side: DoubleSide, fog: false });
  const glow = new Mesh(glowGeo, glowMat);
  glow.name = 'portal-glow';
  glowGeo.computeBoundingSphere();
  glow.renderOrder = 3;
  group.add(glow);
  if (cfg.pillar > 0) pillar = { x: portal.x, z: portal.z, y0: portal.y, y1: portal.y + cfg.pillar };

  // From the giant's line (the summit) to the portal, evenly; then before the way into every element.
  const summit = level.points.find((p) => p.type === 'summit');
  if (cfg.arrows > 0 && summit) {
    const z0 = summit.z + ARROW_STEP / 2;
    const z1 = portal.z - ARROW_STEP / 2;
    const step = (z1 - z0) / cfg.arrows;
    for (let i = 0; i < cfg.arrows; i++) {
      const z = z0 + step * (i + 0.5);
      marks.push({ x: portal.x, y: level.floorAt(portal.x, z), z, to: 'portal' });
    }
  }
  for (const s of level.shapes ?? []) {
    if (s.kind === 'chasm') continue;
    // A throat is entered past its funnel; a tunnel at its mouth; a hump at the foot of its ramp.
    const zIn = s.kind === 'throat' ? s.z0 + (s.funnel ?? 0) : s.z0;
    arrowsTo(level, (s.x0 + s.x1) / 2, zIn, cfg.arrows, s.kind, marks);
  }

  const arrowGeo = chevronGeometry();
  const arrowMat = new MeshBasicMaterial({ color: color('wayArrow'), side: DoubleSide, transparent: true, opacity: 0.95, depthWrite: false });
  const arrows = new InstancedMesh(arrowGeo, arrowMat, Math.max(1, marks.length));
  arrows.count = marks.length;
  arrows.name = 'way-arrows';
  arrows.frustumCulled = false;
  arrows.renderOrder = 2;
  const dummy = new Object3D();
  marks.forEach((m, i) => {
    dummy.position.set(m.x, m.y + 0.08, m.z);
    dummy.updateMatrix();
    arrows.setMatrixAt(i, dummy.matrix);
  });
  arrows.instanceMatrix.needsUpdate = true;
  if (marks.length > 0) group.add(arrows);

  return {
    group,
    marks,
    pillar,
    guard(camera) {
      glow.visible = !this.insidePillar(camera);
    },
    insidePillar(p) {
      return !!pillar && Math.abs(p.x - pillar.x) <= PILLAR_WIDTH / 2 && Math.abs(p.z - pillar.z) <= PILLAR_WIDTH / 2 && p.y >= pillar.y0 && p.y <= pillar.y1;
    },
    dispose() {
      glowGeo.dispose();
      glowMat.dispose();
      arrowGeo.dispose();
      arrowMat.dispose();
    },
  };
}
