import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sfxJson from '../../content/avalanche/sfx.json' with { type: 'json' };
import type { SfxJson } from '../../src/content/types.ts';
import { createSfxEvents } from '../../src/app/sfx-events.ts';
import { createEmitter } from '../../src/core/events.ts';

const sfx = sfxJson as unknown as SfxJson;

/** The source of the app layer and main.ts (where the events get their sound and their look). */
const SRC = ['src/main.ts', ...readdirSync('src/app').map((f) => join('src/app', f)), 'src/ui/hud.ts', 'src/ui/coin-fountain.ts']
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

/** A sound of sfx.json (ZzFX or a file) or the footsteps. */
const hasSound = (name: string): boolean => name === 'footsteps' ? !!sfx.footsteps : Array.isArray(sfx[name]) || !!sfx.files?.[name];
/** It is played: by a cue on a sim event (sfx.json events), by its name in code, or a cue by name in code. */
const isPlayed = (name: string): boolean => {
  if (name === 'footsteps') return SRC.includes('playStep(');
  const cues = Object.entries(sfx.cues ?? {}).filter(([, c]) => c.sfx === name).map(([id]) => id);
  const onEvent = cues.some((id) => Object.values(sfx.events ?? {}).some((list) => list.includes(id)));
  const byCue = cues.some((id) => SRC.includes(`cue('${id}'`));
  return onEvent || byCue || SRC.includes(`play('${name}'`) || SRC.includes(`hum('${name}'`) || new RegExp(`_SFX = '${name}'`).test(SRC);
};

/**
 * M5-03 (docs/01-gdd.md 10.3, 4.8): every event of the feedback table — the sounds it makes (each in sfx.json and played)
 * and where it is seen (a sim event the app layer listens to, or a call of the HUD).
 */
const TABLE: Array<{ row: string; sounds: string[]; seen: string[] }> = [
  { row: 'step', sounds: ['footsteps'], seen: ["on('step'", "on('gain'"] },
  { row: 'step on a belt', sounds: ['belt'], seen: ["on('gain'"] },
  { row: 'wall opened', sounds: ['wallMelt', 'gate'], seen: ["on('gateOpen'"] },
  { row: 'wall passed', sounds: ['gate', 'rewardCoins'], seen: ["on('gatePass'"] },
  { row: 'gift', sounds: ['pathGift'], seen: ["on('giftTake'"] },
  { row: 'shoes bought', sounds: ['shoesBuy'], seen: ['buyShoes('] },
  { row: 'egg', sounds: ['eggCrack', 'eggPing'], seen: ["on('eggHatch'"] },
  { row: 'speed grows', sounds: ['wind'], seen: ['fx.wind('] },
  { row: 'stat milestone', sounds: ['statMilestone'], seen: ["on('statMilestone'"] },
  { row: 'avalanche', sounds: ['avalancheWarn', 'avalancheRumble', 'avalancheWhoosh'], seen: ['setWaveBanner(', 'setFrost('] },
  { row: 'phew, made it', sounds: ['phew'], seen: ["on('waveSurvived'"] },
  { row: 'snowed in', sounds: ['caughtRoll', 'poof'], seen: ["on('waveCaught'", "on('caughtEnd'"] },
  { row: 'golden gift', sounds: ['goldSpawn', 'goldTake', 'fanfare', 'poof'], seen: ["on('bonusSpawn'", "on('bonusSaved'", "on('bonusLost'"] },
  { row: 'summit', sounds: ['fanfare', 'rewardTrophy'], seen: ["on('portal'"] },
  { row: 'rebirth', sounds: ['fanfare'], seen: ['applyRebirth('] },
  { row: 'purchase', sounds: ['rewardTrophy'], seen: ['iap'] },
  { row: 'ridge', sounds: ['fanfare', 'wallMelt'], seen: ["kind === 'ridge'"] },
  { row: 'giant', sounds: ['giantUh', 'fanfare'], seen: ["on('bossEnter'", "on('bossCaught'"] },
  { row: 'new height', sounds: ['recordUp'], seen: ["on('recordUp'"] },
];

describe('M5-03: every event of docs/01-gdd.md 10.3 is seen and heard', () => {
  for (const r of TABLE)
    it(r.row, () => {
      for (const n of r.sounds) {
        expect(hasSound(n), `${r.row}: sound ${n} in sfx.json`).toBe(true);
        expect(isPlayed(n), `${r.row}: sound ${n} played`).toBe(true);
      }
      for (const v of r.seen) expect(SRC.includes(v), `${r.row}: seen by ${v}`).toBe(true);
    });
});

describe('sfx-events: cues of sfx.json on sim events', () => {
  it('plays the notes of a cue a gap apart, keeps when and perSec', () => {
    const calls: Array<[string, number, number]> = [];
    let t = 0;
    const se = createSfxEvents(
      {
        a: [1],
        cues: { chime: { sfx: 'a', notes: [0, 4, 7], gap: 0.1, delay: 0.2 }, belt: { sfx: 'a', when: { belt: true }, perSec: 2 } },
        events: { gateOpen: ['chime'], gain: ['belt'] },
      } as unknown as SfxJson,
      () => ({ play: (n, s = 0, d = 0) => calls.push([n, s, d]) }),
      () => t,
    );
    const ev = createEmitter<Record<string, unknown>>();
    se.wire(ev);
    ev.emit('gateOpen', {});
    expect(calls.map((c) => c[1])).toEqual([0, 4, 7]);
    expect(calls[2]![2]).toBeCloseTo(0.4);
    calls.length = 0;
    ev.emit('gain', { belt: false });
    expect(calls.length).toBe(0);
    for (let i = 0; i < 5; i++) ev.emit('gain', { belt: true });
    expect(calls.length).toBe(2);
    t = 1500;
    ev.emit('gain', { belt: true });
    expect(calls.length).toBe(3);
    se.cue('chime', 2);
    expect(calls.slice(-3).map((c) => c[1])).toEqual([2, 6, 9]);
  });

  it('every event of sfx.json is an event the game emits', () => {
    for (const e of Object.keys(sfx.events ?? {})) expect(SRC.includes(`'${e}'`) || readFileSync('src/sim/world.ts', 'utf8').includes(`${e}:`), e).toBe(true);
  });
});
