// What: Level checks of the stages pace (layout stageSlope, docs/01-gdd.md 22): every ridge asks for a level threshold; stages, widths, mazes and the stage bot come with LV-03…LV-07.
// Called by: level/validate.ts (validatePack, when worlds-spec.json has layout stageSlope); tests/level/stages.test.ts.
// Keep: Pure; reads worlds.json, the spec and balance only; every message names the mountain and the stage.

import type { World, WorldsJson } from '../content/types.ts';
import { levelThreshold, type Levels } from '../sim/levels.ts';

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/** Ridges of a mountain ask for a level (docs/01-gdd.md 22.2–22.3): requires = the threshold of `level`. */
export function validateStageLevels(w: World, levels: Levels): string[] {
  const errors: string[] = [];
  const at = `worlds.json: worlds[${w.index - 1}] (${w.id})`;
  for (const s of w.segments) {
    if (s.type !== 'gate' || s['kind'] !== 'ridge') continue;
    const level = s['level'];
    if (typeof level !== 'number' || !Number.isInteger(level) || level < 1) errors.push(`${at}: ridge at z ${s.z} — no level`);
    else if (s['requires'] !== round3(levelThreshold(level, levels))) errors.push(`${at}: ridge at z ${s.z} — requires ${String(s['requires'])}, level ${level} starts at ${round3(levelThreshold(level, levels))}`);
  }
  return errors;
}

export function validateStageWorlds(worlds: WorldsJson, levels: Levels | undefined): string[] {
  if (!levels) return ['balance.json: levels — required by the stages pace (docs/01-gdd.md 22.2)'];
  return worlds.worlds.flatMap((w) => validateStageLevels(w, levels));
}
