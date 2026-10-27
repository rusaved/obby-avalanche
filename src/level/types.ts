// What: Type definitions of the built level (LevelData: boxes, ramps, gates, caves, checkpoints, points, floorYAt); colliders and render descriptions, no three objects.
// Called by: Produced by level/builder.ts; read by sim/*, render/level-mesh.ts, render/threat/avalanche.ts, app/banner-signs.ts, app/handles.ts, test-api; tests/sim/*
// Keep: Types only, no runtime code and no three objects (level layer stays pure); `material` is a key of theme.json materials; fix all consumers when a field changes.

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

/**
 * A solid of snow over a convex polygon in XZ (open slope, docs/01-gdd.md 20.2): the walls of the summit funnel, at an
 * angle to the axes, so the hero slides along them. `pts` go clockwise seen from above (x right, z up), y0 to y1.
 */
export interface LevelPrism {
  pts: Array<[number, number]>;
  y0: number;
  y1: number;
  material: string;
  kind: string;
}

export interface LevelGate {
  index: number;
  /** Open slope (docs/01-gdd.md 17.3, 17.6): «ridge» — ice in three passages of a low carniz; «boss» — the giant's
   * check at the summit line, never a collider; absent — a wall of the classic and gateSide layouts. */
  kind?: 'ridge' | 'boss';
  /** Ridge: x of the passage centres, their width and length up the step, the height of the step (carniz). */
  passes?: number[];
  passWidth?: number;
  passLength?: number;
  rise?: number;
  /** Ridge (SP-04): the height of its digits; absent — the renderer's. */
  digits?: number;
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
  /** Gift zone of the stretch (docs/01a-content.md 4): «Phew, made it!» pays 3 × its gift. */
  zone?: number;
  /** Open slope (docs/01-gdd.md 17.5): grotto (no belt), ridgeGrotto, bossLine; absent — the cave of 4.3. */
  kind?: string;
  /** On a fork: the lane the grotto serves (its side of the cliff). */
  lane?: 'calm' | 'bold';
  /** K-01: the finish grotto of a ridge (D-01) — a roof open all round, under it from any side; absent — a cave or a rock. */
  canopy?: boolean;
}

/**
 * An element of the open slope (docs/01-gdd.md 18.3) along [z0, z1] at floor height y: a chasm (its bottom `depth`
 * lower), a throat (the floor `x0`–`x1` between its walls, `funnel` units of narrowing at each end), a tunnel (the hall
 * `x0`–`x1` on `side`), a hump (its bold lane `side`, the crest at z1, landing `land`).
 */
export interface LevelShape {
  /** `pit` (RL, docs/01-gdd.md 21.2): below `y` over [x0, x1] × [z0, z1] the hero has fallen (rolled back to the flag); with
   * `side` — the pit of the stairs to a ridge (RL-05) at that edge, bots keep out of it. */
  kind: 'chasm' | 'throat' | 'tunnel' | 'hump' | 'pit';
  z0: number;
  z1: number;
  y: number;
  x0: number;
  x1: number;
  side?: 'left' | 'right';
  depth?: number;
  funnel?: number;
  land?: [number, number];
  section: number;
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
  /** The box kinds the camera passes (builder CAMERA_THROUGH; SD-01: with grottos); absent — CAMERA_THROUGH. */
  cameraThrough?: ReadonlySet<string>;
  /** Stages pace (docs/01-gdd.md 22.4): the stages of worlds.json as they are; absent — the other layouts. */
  stages?: import('../content/types.ts').WorldStage[];
  worldId: string;
  worldIndex: number;
  length: number;
  width: number;
  spawn: Vec3;
  killY: number;
  /** Static triangles for the Octree: 9 numbers per triangle. */
  staticTriangles: Float32Array;
  /** The invisible wall (docs/01-gdd.md 19.9): boxes and their triangles, met by the hero only; absent or empty — none. */
  bounds?: Aabb[];
  boundsTriangles?: Float32Array;
  boxes: LevelBox[];
  ramps: LevelRamp[];
  /** Solids at an angle (docs/01-gdd.md 20.2): colliders of the hero and the camera, drawn with the boxes; absent — none. */
  prisms?: LevelPrism[];
  /** The funnel of the summit (docs/01-gdd.md 20.2): from z0 (half-width x0) to the portal plane z1 (half-width x1); bots
   * on the summit keep inside it. Absent — an open summit. */
  funnel?: { z0: number; z1: number; x0: number; x1: number };
  gates: LevelGate[];
  niches: LevelNiche[];
  /** SD-02: the gift value of each zone of the mountain (worlds.json zones[].gift by k): the golden gift and «Phew» are worth
   * it where the track has no gifts (pace stages). */
  zoneGifts?: Record<number, number>;
  checkpoints: LevelCheckpoint[];
  points: LevelPoint[];
  safeZones: Array<[number, number]>;
  /** Open slope (docs/01-gdd.md 17.4): sections with a step multiplier — every step on [z0, z1) gives × mult. Empty — ×1. */
  sections: Array<{ z0: number; z1: number; mult: number }>;
  /** Open slope (docs/01-gdd.md 17.7): forks of the slope, [z0, z1] of each cliff down the middle; a split one (SP-05) —
   * also x0–x1 of its crevasse; empty — none. */
  forks: Array<{ z0: number; z1: number; x0?: number; x1?: number; track?: number; bold?: 'left' | 'right' }>;
  /** Open slope (docs/01-gdd.md 17.6): zones of giants (worlds.json bosses[]); empty — none. */
  bosses: import('../content/types.ts').WorldBoss[];
  /** Open slope (docs/01-gdd.md 18.3): elements of the sections — chasm, throat, tunnel, hump; absent or empty — none. */
  shapes?: LevelShape[];
  /** Floor height at a given z along the track centre (piecewise from floors and ramps). */
  floorYAt(z: number): number;
  /** Top of the ground at (x, z): floors and ramps of any width; −Infinity over a hole (open slope: passages, lanes). */
  floorAt(x: number, z: number): number;
  /** Half-width of the slope at z (SP-04: every section its own width, docs/01-gdd.md 20.4); `width` / 2 without a profile. */
  halfAt(z: number): number;
}
