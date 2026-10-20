// What: Where the thin lines on the ground are: the coloured lips along floor edges over a drop (SD-07), the ice plugs and crest of a ridge as they melt, the slab of a gate and the line of a giant's zone.
// Called by: render/level-mesh.ts and app/boss-view.ts (draw exactly these boxes), level/validate-stages.ts (surfaceLineErrors: the lines lie on the surface, nothing hangs without support); tests/level/surface-lines.test.ts.
// Keep: Pure TS, no three.js; the renderer and the validator use these same functions, so what is drawn is what is checked.

import { GATE_THICKNESS } from './builder.ts';
import type { Aabb, LevelBox, LevelData, LevelGate } from './types.ts';

/** The line across the slope at the start of a giant's zone (PS): this thick and this deep, lying on the floor. */
export const ZONE_LINE_THICK = 0.6;

/** SD-07: the lip is this wide (inside the edge) and stands this high over the top; a drop of more than EDGE_DROP shows it. */
export const EDGE_LIP = 0.5;
export const EDGE_RISE = 0.04;
export const EDGE_DROP = 1;
/** The ice plugs of the passages stand this far over the carniz; the crest over the carniz is this thick. */
export const RIDGE_PLUG_OVER = 1;
export const RIDGE_CREST_THICK = 0.6;
/** A plug starts at the front face of the gate slab. */
const GATE_HALF = GATE_THICKNESS / 2;

/** SD-07: thin boxes along the edges of a floor box where the ground past the edge is lower by EDGE_DROP (or none). */
export function edgeLips(level: Pick<LevelData, 'floorAt'>, b: LevelBox): LevelBox[] {
  const top = b.max[1];
  const out: LevelBox[] = [];
  const low = (x: number, z: number): boolean => level.floorAt(x, z) < top - EDGE_DROP;
  const lip = (x0: number, z0: number, x1: number, z1: number): void => void out.push({ min: [x0, top, z0], max: [x1, top + EDGE_RISE, z1], material: 'edge', solid: false, kind: 'edge' });
  const [x0, x1, z0, z1] = [b.min[0], b.max[0], b.min[2], b.max[2]];
  const xm = (x0 + x1) / 2;
  const zm = (z0 + z1) / 2;
  if (z1 - z0 > 2 * EDGE_LIP && x1 - x0 > 2 * EDGE_LIP) {
    if (low(xm, z0 - 0.6)) lip(x0, z0, x1, z0 + EDGE_LIP);
    if (low(xm, z1 + 0.6)) lip(x0, z1 - EDGE_LIP, x1, z1);
    if (low(x0 - 0.6, zm)) lip(x0, z0, x0 + EDGE_LIP, z1);
    if (low(x1 + 0.6, zm)) lip(x1 - EDGE_LIP, z0, x1, z1);
  }
  return out;
}

/** Every lip of the level: the solid floors but pits. */
export function levelLips(level: Pick<LevelData, 'floorAt' | 'boxes'>): LevelBox[] {
  return level.boxes.filter((b) => b.solid && b.kind === 'floor' && b.material !== 'pit').flatMap((b) => edgeLips(level, b));
}

/** A part of a ridge (docs/01-gdd.md 17.3): an ice plug in a passage up the step, or the see-through crest over the carniz. */
export interface RidgePart {
  gate: number;
  x: number;
  w: number;
  y0: number;
  h: number;
  z: number;
  d: number;
  crest: boolean;
}

/** The plugs and the crest of every ridge of the level, in gate order. */
export function ridgeParts(level: Pick<LevelData, 'gates' | 'width'>): RidgePart[] {
  const out: RidgePart[] = [];
  level.gates.forEach((g: LevelGate, i) => {
    if (g.kind !== 'ridge') return;
    const plugTop = (g.rise ?? 0) + RIDGE_PLUG_OVER;
    const pass = g.passWidth ?? 0;
    const len = (g.passLength ?? 0) + GATE_HALF;
    for (const px of g.passes ?? []) out.push({ gate: i, x: px, w: pass, y0: g.y, h: plugTop, z: g.z - GATE_HALF + len / 2, d: len, crest: false });
    out.push({ gate: i, x: 0, w: level.width, y0: g.y + plugTop, h: g.height - plugTop, z: g.z, d: RIDGE_CREST_THICK, crest: true });
  });
  return out;
}

/**
 * A ridge part melted `openness` (0 — whole, 1 — gone): its box, null once gone. MU-13 (producer: «on a ramp with a rise
 * the blue edge line hangs in the air over the slope»): a melted ridge kept a 0.1% sliver of each part where it stood —
 * the crest a light-blue line across the whole slope a unit over the carniz, over the passage ramps; now nothing stays.
 */
export function ridgePartBox(p: RidgePart, openness: number): Aabb | null {
  if (openness >= 1) return null;
  const h = p.h * Math.max(0.001, 1 - openness);
  return { min: [p.x - p.w / 2, p.y0, p.z - p.d / 2], max: [p.x + p.w / 2, p.y0 + h, p.z + p.d / 2] };
}

/**
 * The slab the renderer draws for a gate: a classic wall from its floor up. MU round 3 (producer, the third time: «a thin
 * light-blue line across the track over a rise», mountain 1, stage 2): a ridge (drawn by its plugs and crest) and the
 * giant's line kept a slab of full width and depth flattened to 0.01 % at half the gate's height — a plane of ice hanging
 * in the air over every rise; now they have none.
 */
export function gateSlab(g: Pick<LevelGate, 'kind' | 'box' | 'y' | 'z' | 'height'>): Aabb | null {
  if (g.kind) return null;
  const w = g.box.max[0] - g.box.min[0];
  const d = g.box.max[2] - g.box.min[2];
  return { min: [-w / 2, g.y, g.z - d / 2], max: [w / 2, g.y + g.height, g.z + d / 2] };
}

/**
 * The line of a giant's zone on the floor at its start, across the whole slope (PS). MU round 3: none on the stages pace
 * — the zone starts at its stage over a rise, and the bar lying past the top of the rise read as a line in the air.
 */
export function zoneLine(level: Pick<LevelData, 'bosses' | 'floorAt' | 'width' | 'stages'>, zone: number): Aabb | null {
  const b = level.bosses[zone];
  if (!b || level.stages) return null;
  const z = b.zone[0];
  const y = level.floorAt(0, z);
  return { min: [-level.width / 2, y, z - ZONE_LINE_THICK / 2], max: [level.width / 2, y + ZONE_LINE_THICK, z + ZONE_LINE_THICK / 2] };
}
