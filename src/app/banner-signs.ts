// What: Hides gate signs that sit under the avalanche banner or between the camera and the hero (back when the overlap ends), and for good once the hero has passed the gate; hides the record flag and the arches of the base in the way of the camera; fades the tall walls in its way (RL-09).
// Called by: main.ts (guardBannerSigns, guardRecordFlag, guardBaseArches, guardSeeThrough each frame); test-api/index.ts (segmentMeetsBox, flagInTheWay).
// Keep: Only toggles sign visibility - reads the camera, never changes sim or level data; the banner must never end up under a sign (docs/01-gdd.md 16.7, PR-11).

/**
 * The avalanche banner is never under a gate sign (docs/01-gdd.md 16.7; playtest M3, item 6: «Avalanche in 9» was
 * printed on a huge red sign): while the banner shows, a sign whose box on screen meets the banner box is not drawn.
 * Nor is a sign between the camera and the hero or around the camera (PR-11; playtest of the prototype, item 2: through
 * an open gate the camera flew through its sign). The signs come back as soon as that ends. Reads the camera, only
 * hides signs.
 */
import { Vector3, type PerspectiveCamera } from 'three';
import type { LevelData } from '../level/types.ts';
import type { LevelMeshes } from '../render/level-mesh.ts';
import type { Hud } from '../ui/hud.ts';
import type { RecordFlag } from '../render/record-flag.ts';
import type { BaseView } from '../render/base-view.ts';
import { HERO_HEIGHT } from '../sim/controller.ts';

/** A sign this close to the banner box (px) counts as under it. */
const MARGIN = 12;
/** A sign this close (units) to the camera or to its line of sight to the hero counts as in the way. */
const SIGHT_PAD = 0.5;
/** Heights over the feet the camera must see the hero at: chest and head. */
const SIGHT_HEIGHTS = [1.5, HERO_HEIGHT - 0.5];
/** Only signs this near the hero along the track can be in the way. */
const SIGHT_RANGE = 40;

const _p = new Vector3();
const _eye = new Vector3();
const _cam = new Vector3();
const _hero = new Vector3();
/** An arch is this thick (its pillars, the ice and the sign in front of it), units. */
const ARCH_DEPTH = 2;

export interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Screen box (field px) of a world box, null when it is all behind the camera; a box across the camera plane fills the field. */
export function screenRect(camera: PerspectiveCamera, center: readonly number[], size: readonly number[], field: { width: number; height: number }): ScreenRect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let behind = 0;
  for (let i = 0; i < 8; i++) {
    _p.set(center[0]! + ((i & 1 ? 1 : -1) * size[0]!) / 2, center[1]! + ((i & 2 ? 1 : -1) * size[1]!) / 2, center[2]! + ((i & 4 ? 1 : -1) * size[2]!) / 2);
    _p.applyMatrix4(camera.matrixWorldInverse);
    if (_p.z > -camera.near) {
      behind++;
      continue;
    }
    _p.applyMatrix4(camera.projectionMatrix);
    const x = (_p.x * 0.5 + 0.5) * field.width;
    const y = (0.5 - _p.y * 0.5) * field.height;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  if (behind === 8) return null;
  if (behind > 0) return { x0: 0, y0: 0, x1: field.width, y1: field.height };
  return { x0, y0, x1, y1 };
}

export function rectsMeet(a: ScreenRect, b: ScreenRect, margin = 0): boolean {
  return a.x0 < b.x1 + margin && b.x0 < a.x1 + margin && a.y0 < b.y1 + margin && b.y0 < a.y1 + margin;
}

/** Does the segment a → b pass through the box `center ± size / 2` grown by `pad`, or start in it (slab test). */
export function segmentMeetsBox(a: Vector3, b: Vector3, center: readonly number[], size: readonly number[], pad: number): boolean {
  let t0 = 0;
  let t1 = 1;
  for (let k = 0; k < 3; k++) {
    const o = a.getComponent(k);
    const d = b.getComponent(k) - o;
    const lo = center[k]! - size[k]! / 2 - pad;
    const hi = center[k]! + size[k]! / 2 + pad;
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return false;
      continue;
    }
    const ta = (lo - o) / d;
    const tb = (hi - o) / d;
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * Every frame after the camera moved and the signs got their text; `hero` — his feet as drawn. The sign of a gate the
 * hero has passed is gone for good: it hid as he went through and came back behind him like a closed one (producer's
 * playtest PS).
 */
export function guardBannerSigns(hud: Hud, meshes: LevelMeshes, level: LevelData, camera: PerspectiveCamera, field: { width: number; height: number }, hero: Vector3, passed: readonly boolean[], readRange = Infinity): void {
  const banner = hud.waveBannerRect();
  for (let i = 0; i < level.gates.length; i++) {
    // MU-03 (docs/07-mobile-ui.md, rule 19): a sign farther than it reads is not drawn.
    let hide = passed[i] === true || Math.abs(level.gates[i]!.z - hero.z) > readRange;
    const near = Math.abs(level.gates[i]!.z - hero.z) < SIGHT_RANGE;
    if (!hide && (banner || near)) {
      const box = meshes.signBox(i);
      if (banner) {
        const r = screenRect(camera, box.center, box.size, field);
        hide = r !== null && rectsMeet(r, banner, MARGIN);
      }
      if (!hide && near) hide = SIGHT_HEIGHTS.some((h) => segmentMeetsBox(camera.position, _eye.set(hero.x, hero.y + h, hero.z), box.center, box.size, SIGHT_PAD));
    }
    meshes.setSignHidden(i, hide);
  }
}

/** Is a box on the line camera → hero (chest or head) or nearer than `near` to the camera. */
export function flagInTheWay(camera: Vector3, hero: Vector3, box: { center: readonly number[]; size: readonly number[] }, near: number): boolean {
  if (near > 0 && segmentMeetsBox(camera, camera, box.center, box.size, near)) return true;
  return SIGHT_HEIGHTS.some((h) => segmentMeetsBox(camera, _eye.set(hero.x, hero.y + h, hero.z), box.center, box.size, SIGHT_PAD));
}

/**
 * SP-01 (docs/01-gdd.md 20.2; playtest FM: the record flagpole a quarter of the screen in front of the camera on a grotto
 * belt): after the flag got its place this frame, it is not drawn on the line camera → hero nor nearer than
 * hideDistance × camera.flagHide to the camera; it comes back when that ends. `near` 0 — never hidden.
 */
export function guardRecordFlag(flag: RecordFlag, camera: PerspectiveCamera, hero: Vector3, near: number): void {
  const box = flag.box();
  if (box && near > 0 && flagInTheWay(camera.position, hero, box, near)) flag.mesh.visible = false;
}

/**
 * Q-066 (playtest of «Размах»: on the base the frames of the arches took up to 60% of the view): an arch of the base on
 * the line camera → hero (chest or head) or nearer than `near` to the camera is not drawn, with its light or ice, sign,
 * flag and lock; never the arch the hero stands in. `near` 0 — never hidden.
 */
export function guardBaseArches(view: BaseView, camera: PerspectiveCamera, hero: Vector3, near: number): void {
  view.arches.forEach((a, i) => {
    let hide = false;
    if (near > 0) {
      // In the arch's own axes: across it x, up y, through it z.
      const c = Math.cos(a.yaw);
      const s = Math.sin(a.yaw);
      const local = (p: Vector3, out: Vector3): Vector3 => out.set((p.x - a.x) * c - (p.z - a.z) * s, p.y, (p.x - a.x) * s + (p.z - a.z) * c);
      const center = [0, a.top / 2, 0];
      const size = [a.width, a.top, ARCH_DEPTH];
      local(hero, _hero);
      if (!segmentMeetsBox(_hero, _hero, center, size, 1)) {
        local(camera.position, _cam);
        hide = segmentMeetsBox(_cam, _cam, center, size, near) || SIGHT_HEIGHTS.some((h) => segmentMeetsBox(_cam, _p.set(_hero.x, _hero.y + h, _hero.z), center, size, SIGHT_PAD));
      }
    }
    view.setArchHidden(i, hide);
  });
}

/**
 * RL-09 (docs/01-gdd.md 21.9): a tall wall (an ice cliff, a wall of a throat or a tunnel) on the sight line from
 * the camera to the hero, or round the camera, turns see-through; the one he stands on top of stays solid.
 */
export function guardSeeThrough(meshes: Pick<LevelMeshes, 'seeThrough' | 'setSeeThrough'>, camera: PerspectiveCamera, hero: Vector3): void {
  meshes.seeThrough.forEach((b, i) => {
    const center = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
    const onTop = hero.y >= b.max[1] - 0.5;
    const fade = !onTop && (segmentMeetsBox(camera.position, camera.position, center, size, SIGHT_PAD) || SIGHT_HEIGHTS.some((h) => segmentMeetsBox(camera.position, _p.set(hero.x, hero.y + h, hero.z), center, size, SIGHT_PAD)));
    meshes.setSeeThrough(i, fade);
  });
}
