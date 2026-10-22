import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { padPays } from '../../src/meta/trophies.ts';
import { applyRebirth } from '../../src/meta/rebirth.ts';
import type { SaveData } from '../../src/meta/save.ts';

// ST-06 (producer 22.10: the first stage farmed for ever): a stage pad pays `stagePads.takes` times a life, then nothing.
const balance = JSON.parse(readFileSync(resolve(__dirname, '../../content/avalanche/pace/stages/balance.json'), 'utf8')) as { stagePads: { takes: number } };

describe('ST-06 stage pads pay a few times a life', () => {
  it('the pad of stage 1 pays `takes` times, then 0; a farther stage and another mountain count apart', () => {
    const takes = balance.stagePads.takes;
    expect(takes).toBeGreaterThanOrEqual(1);
    expect(takes).toBeLessThanOrEqual(5);
    const save: Pick<SaveData, 'padTakes'> = {};
    const runs = Array.from({ length: 10 }, () => padPays(save, 2, 1, takes));
    expect(runs.filter(Boolean)).toHaveLength(takes);
    expect(runs.slice(takes).every((x) => !x)).toBe(true);
    expect(padPays(save, 2, 2, takes)).toBe(true);
    expect(padPays(save, 1, 1, takes)).toBe(true);
    expect(padPays(save, 2, 1, undefined)).toBe(true);
  });
  it('a rebirth clears the count', () => {
    const save = { padTakes: { '2:1': 9 } } as unknown as SaveData;
    applyRebirth(save, { goalSummits: 5, mult: 3 } as never, { skins: [], wings: [] } as never);
    expect(save.padTakes).toBeUndefined();
    expect(padPays(save, 2, 1, 3)).toBe(true);
  });
});
