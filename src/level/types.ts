/** Level data built from worlds.json (docs/02-tech.md 6.1): colliders and render descriptions, no three.js objects. */

export type Vec3 = [number, number, number];

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

/** Axis-aligned box: collider and/or render primitive. `material` is a key of theme.json materials. */
export interface LevelBox extends Aabb {
  material: string;
  /** false for decor that only renders. */
  solid: boolean;
  kind: string;
}

/** Sloped slab along +Z: top surface rises from y0 at z0 to y1 at z1. */
export interface LevelRamp {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y0: number;
  y1: number;
  thickness: number;
  material: string;
}

export interface LevelGate {
  index: number;
  z: number;
  y: number;
  requires: number;
  rewardCoins: number;
  box: Aabb;
  height: number;
  signHeight: number;
  rarity: string;
}

export interface LevelNiche {
  stretch: number;
  z: number;
  y: number;
  side: 'left' | 'right';
  /** The recess itself (inside the side wall). */
  box: Aabb;
  treadmill: number;
}

export interface LevelCheckpoint {
  z: number;
  y: number;
  x: number;
  wall: number;
  rarity: string;
}

export interface LevelPoint {
  type: string;
  x: number;
  y: number;
  z: number;
  [key: string]: unknown;
}

export interface LevelData {
  worldId: string;
  worldIndex: number;
  length: number;
  width: number;
  spawn: Vec3;
  killY: number;
  /** Static triangles for the Octree: 9 numbers per triangle. */
  staticTriangles: Float32Array;
  boxes: LevelBox[];
  ramps: LevelRamp[];
  gates: LevelGate[];
  niches: LevelNiche[];
  checkpoints: LevelCheckpoint[];
  points: LevelPoint[];
  safeZones: Array<[number, number]>;
  /** Floor height at a given z along the track centre (piecewise from floors and ramps). */
  floorYAt(z: number): number;
}
