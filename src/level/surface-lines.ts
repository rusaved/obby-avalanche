// What: Where the thin lines on the ground are: the coloured lips along floor edges over a drop (SD-07) and the ice plugs and crest of a ridge as they melt.
// Called by: render/level-mesh.ts (draws exactly these boxes), level/validate-stages.ts (surfaceLineErrors: the lines lie on the surface); tests/level/surface-lines.test.ts.
// Keep: Pure TS, no three.js; the renderer and the validator use these same functions, so what is drawn is what is checked.

import { GATE_THICKNESS } from './builder.ts';
import type { Aabb, LevelBox, LevelData, LevelGate } from './types.ts';

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
