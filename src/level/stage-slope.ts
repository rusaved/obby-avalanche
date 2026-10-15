// What: Generator of the stages pace (layout stageSlope, docs/01-gdd.md 22): the mountain as a chain of stages, each ridge asks for a level of the stat.
// Called by: level/generate.ts (generateWorlds dispatches on spec.layout); level/validate-stages.ts and tests read its numbers.
// Keep: Pure and deterministic (the same spec, balance and tuning give the same JSON byte for byte); every number from the spec or balance; worlds keep layout openSlope for the slope machinery.

import type { OpenSpecJson, Segment, World } from '../content/types.ts';
import { generateOpenWorlds, type OpenInput } from './open-slope.ts';
import { levelThreshold, nearestLevel, type Levels } from '../sim/levels.ts';

export interface StageInput {
  spec: OpenSpecJson;
  balance: OpenInput['balance'] & { levels?: Levels };
  tuning?: OpenInput['tuning'];
}

export function isStageSpec(spec: unknown): spec is OpenSpecJson {
  return (spec as { layout?: string } | null)?.layout === 'stageSlope';
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/** A ridge number of the open slope as the threshold of its nearest level (docs/01-gdd.md 22.2: ±9%, not recounted). */
export function ridgeAsLevel(requires: number, levels: Levels): { level: number; requires: number } {
  const level = nearestLevel(requires, levels);
  return { level, requires: round3(levelThreshold(level, levels)) };
}

export function generateStageWorlds({ spec, balance, tuning }: StageInput): World[] {
  const levels = balance.levels;
  if (!levels) throw new Error('layout stageSlope: balance.json levels is required (docs/01-gdd.md 22.2)');
  const worlds = generateOpenWorlds({ spec: { ...spec, layout: 'openSlope' }, balance, tuning });
  for (const w of worlds)
    for (const s of w.segments as Segment[])
      if (s.type === 'gate' && s['kind'] === 'ridge') Object.assign(s, ridgeAsLevel(s['requires'] as number, levels));
  return worlds;
}
