import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStepCadence } from '../../src/audio/steps.ts';
import { createStepVoice, type VoiceContext } from '../../src/audio/index.ts';
import { createSim } from '../../src/sim/world.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { levelThreshold } from '../../src/sim/levels.ts';
import type { BalanceJson, FootstepsJson, SfxJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

// SD-14 (producer 16.10: «the horror starts when the hero runs fast … a rattle»): a step is heard at most ~3 times a
// second at any Speed, the variant at random never twice in a row, the pitch within ± 1 semitone, no steps over each other.
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const tuning = mergePatch(read('tuning.json'), read('pace/stages/tuning.json')) as unknown as TuningJson;
const balance = mergePatch(read('balance.json'), read('pace/stages/balance.json')) as unknown as BalanceJson;
const worlds = read('pace/stages/worlds.json') as WorldsJson;
const steps = (read('sfx.json') as SfxJson).footsteps as FootstepsJson;

function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('the footstep cadence (SD-14)', () => {
  it('a run of 10 s at the top Speed of mountain 10: 20+ gains a second, at most 3 steps a second heard, never the same twice, ± 1 semitone', () => {
    const w = worlds.worlds[9]!;
    const level = buildLevel(w);
    const top = w.stages![w.stages!.length - 1]!;
    const sim = createSim(level, tuning, { balance, speedCurve: balance.speedCurve, stat: levelThreshold(top.level + 5, balance.levels!) });
    // The long flat floor of the giant's stage (no giant without threat.boss), run up it four times: 10 s of a run.
    const st = w.stages!.find((s) => s.type === 'giant')!;
    const gains: number[] = [];
    let clock = 0;
    sim.events.on('gain', () => gains.push(clock));
    for (let lap = 0; lap < 4; lap++) {
      sim.teleport(0, st.y + 0.05, st.start + 2);
      for (let k = 0; k < 150; k++, clock += 1 / 60) sim.step({ moveX: 0, moveZ: 1, jump: false, jumpHeld: false }, 1 / 60);
    }
    expect(sim.params.speed, 'the run is fast').toBeGreaterThan(100);
    expect(gains.length / 10, 'gains a second').toBeGreaterThan(20);
    const set = steps.sets.find((s) => s.id === 'light_snow')!;
    const cadence = createStepCadence(steps.perSec, steps.pitch, rand(1));
    const heard = gains.flatMap((t) => {
      const p = cadence.next(t, set.id, set.files.length, set.weights);
      return p ? [{ t, ...p }] : [];
    });
    for (let s = 0; s < 10; s++) expect(heard.filter((h) => h.t >= s && h.t < s + 1).length, `second ${s}`).toBeLessThanOrEqual(3);
    expect(heard.length, 'still a step a third of a second').toBeGreaterThanOrEqual(27);
    for (let i = 1; i < heard.length; i++) {
      expect(heard[i]!.t - heard[i - 1]!.t).toBeGreaterThanOrEqual(1 / steps.perSec - 1e-9);
      expect(heard[i]!.index, `step ${i}: not the one just heard`).not.toBe(heard[i - 1]!.index);
    }
    for (const h of heard) expect(Math.abs(h.semitones)).toBeLessThanOrEqual(1);
    expect(new Set(heard.map((h) => h.index)).size, 'every variant comes').toBe(set.files.length);
  });

  it('«Light snow»: variant 1 comes more often than any other (weights 3 : 1 : 1 : 1), never twice in a row', () => {
    const set = steps.sets.find((s) => s.id === 'light_snow')!;
    expect(steps.sets.find((s) => s.unlock === 'free')!.id, 'the set on by default').toBe('light_snow');
    const cadence = createStepCadence(steps.perSec, steps.pitch, rand(7));
    const n = [0, 0, 0, 0];
    let prev = -1;
    for (let i = 0; i < 3000; i++) {
      const p = cadence.next(i, set.id, set.files.length, set.weights)!;
      expect(p.index).not.toBe(prev);
      prev = p.index;
      n[p.index]!++;
    }
    for (const k of [1, 2, 3]) expect(n[0]!, `variant 1 over variant ${k + 1}`).toBeGreaterThan(n[k]! * 1.3);
  });

  it('one voice: a step still sounding fades out as the next starts (no two steps at once past the fade)', () => {
    let now = 0;
    const log: Array<{ start: number; dur: number; stop: number }> = [];
    const param = (): AudioParam => ({ value: 1, cancelScheduledValues: () => undefined, setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined }) as unknown as AudioParam;
    const ctx: VoiceContext = {
      get currentTime() {
        return now;
      },
      createBufferSource() {
        const rec = { start: 0, dur: 0, stop: Infinity };
        log.push(rec);
        const node = {
          buffer: null,
          playbackRate: param(),
          onended: null,
          connect: (g: unknown) => g,
          start: (t: number, _o: number, d: number) => Object.assign(rec, { start: t, dur: d }),
          stop: (t: number) => (rec.stop = t),
        };
        return node as unknown as AudioBufferSourceNode;
      },
      createGain() {
        return { gain: param(), connect: (x: unknown) => x } as unknown as GainNode;
      },
    };
    const play = createStepVoice(ctx, {} as AudioNode);
    // Steps of 0.55 s (the longest audible part of the files) every 1/3 s.
    for (let i = 0; i < 30; i++) {
      now = i / 3;
      play({} as AudioBuffer, 0, 0.55, 0, 0.4);
    }
    for (let i = 1; i < log.length; i++) {
      const before = log[i - 1]!;
      const end = Math.min(before.start + before.dur, before.stop);
      expect(end, `step ${i - 1} is over by the fade after step ${i} starts`).toBeLessThanOrEqual(log[i]!.start + 0.05);
    }
  });
});
