/**
 * The avalanche banner is never under a gate sign (docs/01-gdd.md 16.7; playtest M3, item 6: «Avalanche in 9» was
 * printed on a huge red sign): while the banner shows, a sign whose box on screen meets the banner box is not drawn.
 * The signs come back as soon as the banner goes. Reads the camera, only hides signs.
 */
import { Vector3, type PerspectiveCamera } from 'three';
import type { LevelData } from '../level/types.ts';
import type { LevelMeshes } from '../render/level-mesh.ts';
import type { Hud } from '../ui/hud.ts';

/** A sign this close to the banner box (px) counts as under it. */
const MARGIN = 12;

const _p = new Vector3();

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

/** Every frame after the camera moved and the signs got their text. */
export function guardBannerSigns(hud: Hud, meshes: LevelMeshes, level: LevelData, camera: PerspectiveCamera, field: { width: number; height: number }): void {
  const banner = hud.waveBannerRect();
  for (let i = 0; i < level.gates.length; i++) {
    let hide = false;
    if (banner) {
      const box = meshes.signBox(i);
      const r = screenRect(camera, box.center, box.size, field);
      hide = r !== null && rectsMeet(r, banner, MARGIN);
    }
    meshes.setSignHidden(i, hide);
  }
}
