import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { createSim } from '../../src/sim/world.ts';
import { groundPath } from '../../src/sim/shelter.ts';
import type { BalanceJson, OpenSpecJson, ThemeJson, TuningJson, WorldsJson } from '../../src/content/types.ts';
import type { HeroInput } from '../../src/sim/controller.ts';

// RL-04: dips with a way out that throws, and every mountain its own sky and snow (docs/01-gdd.md 21.4).
const root = resolve(__dirname, '../..');
const read = <T>(f: string): T => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8')) as T;
const balance = mergePatch(read<BalanceJson>('balance.json'), read('pace/open/balance.json'));
const tuning = mergePatch(read<TuningJson>('tuning.json'), read('pace/open/tuning.json'));
const spec = read<OpenSpecJson>('pace/open/worlds-spec.json');
const worlds = read<WorldsJson>('pace/open/worlds.json');
const theme = read<ThemeJson>('theme.json');
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
const DT = 1 / 60;
const RUN: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };

describe('dips and tints (RL-04)', () => {
  it('a dip on every mountain (mountain 1 on section 3): 4–6 deep, its way out up to kick over the slope; no grotto in it', () => {
    const D = spec.shapes!.dip!;
    for (const w of worlds.worlds) {
      const dips = w.segments.filter((s) => s.type === 'dip');
      expect(dips.length, w.id).toBeGreaterThan(0);
      if (w.index === 1) expect(dips.map((d) => d['section'])).toEqual([3]);
      const level = buildLevel(w);
      for (const d of dips) {
        const depth = d['depth'] as number;
        expect(depth).toBeGreaterThanOrEqual(4);
        expect(depth).toBeLessThanOrEqual(6);
        expect(d['length']).toBe(D.down + D.bottom + D.up);
        expect(level.floorAt(0, d.z + D.down + D.bottom / 2)).toBeCloseTo((d['y'] as number) - depth, 6);
        expect(level.floorAt(0, d.z + (d['length'] as number) - 0.01)).toBeCloseTo((d['y'] as number) + D.kick, 1);
        for (const n of level.niches) expect(n.box.max[2] <= d.z + 1e-6 || n.box.min[2] >= d.z + (d['length'] as number) - 1e-6, `${w.id} grotto at ${n.z}`).toBe(true);
      }
    }
  });

  it('the hero runs through a dip at the speed of its section: down, out up the ramp, thrown a little over its lip', () => {
    for (const wi of [0, 1, 6]) {
      const w = worlds.worlds[wi]!;
      const level = buildLevel(w);
      const d = w.segments.find((s) => s.type === 'dip')!;
      const below = w.segments.filter((s) => s.type === 'gate' && s.z < d.z).at(-1)!;
      const s = createSim(level, tuning, { balance, speedCurve: curve, stat: below['requires'] as number });
      s.teleport(0, level.floorAt(0, d.z - 20) + 0.05, d.z - 20);
      let minY = Infinity;
      let airPast = false;
      const end = d.z + (d['length'] as number);
      for (let i = 0; i < 240 && s.hero.pos.z < end + 15; i++) {
        s.step(RUN, DT);
        if (s.hero.pos.z > d.z && s.hero.pos.z < end) minY = Math.min(minY, s.hero.pos.y);
        if (s.hero.pos.z > end && !s.hero.onGround) airPast = true;
      }
      expect(s.hero.pos.z, w.id).toBeGreaterThan(end + 15);
      expect(minY, w.id).toBeLessThan((d['y'] as number) - 1);
      expect(airPast, `${w.id}: thrown over the lip`).toBe(true);
      expect(s.caught).toBeNull();
    }
  });

  it('theme.json tints: mountains 2–10 each their own sky and snow, unlike mountain 1 and unlike the one before', () => {
    const tints = theme.tints!;
    expect(tints[worlds.worlds[0]!.id]).toBeUndefined();
    let prev = { top: theme.sky.top, track: theme.materials['track']!.color };
    for (const w of worlds.worlds.slice(1)) {
      const t = tints[w.id]!;
      expect(t, w.id).toBeDefined();
      expect(t.sky.top).not.toBe(theme.sky.top);
      expect(t.track).not.toBe(theme.materials['track']!.color);
      expect(t.sky.top).not.toBe(prev.top);
      expect(t.track).not.toBe(prev.track);
      prev = { top: t.sky.top, track: t.track };
    }
  });

  it('RL-05: on every section of mountains 2–10 a stair of 3–5 plates up the bold half of the rise; gaps ≤ 5, a rise ≤ 3 each; the calm half a ramp without gaps', () => {
    const ST = spec.relief!.stairs!;
    const jump = (tuning.controller.jumpSpeed ** 2) / (2 * tuning.controller.gravity);
    for (const w of worlds.worlds) {
      const level = buildLevel(w);
      const stairs = w.segments.filter((s) => s.type === 'stairs');
      expect(stairs.length, w.id).toBe(w.index >= ST.fromWorld ? w.zones.length - 1 : 0);
      for (const st of stairs) {
        const n = st['count'] as number;
        expect(n).toBeGreaterThanOrEqual(3);
        expect(n).toBeLessThanOrEqual(5);
        expect(st['gap'] as number).toBeLessThanOrEqual(ST.gapMax + 1e-9);
        expect(st['rise'] as number).toBeLessThanOrEqual(3 + 1e-9);
        expect(jump).toBeGreaterThan((st['rise'] as number) + 2);
        const sb = st['side'] === 'right' ? 1 : -1;
        const plates = w.segments.filter((s) => s.type === 'floor' && s['shape'] === 'stairs' && s.z >= st.z && s.z < st.z + (st['length'] as number) && s['solid'] !== false);
        expect(plates.length).toBe(n);
        for (const pl of plates) expect(Math.sign((pl['x0'] as number) + (pl['x1'] as number))).toBe(sb);
        // The last plate one step under the top floor past the stairs.
        const top = level.floorAt(st['x'] as number, st.z + (st['length'] as number) + 0.5);
        expect(top - (plates.at(-1)!['y'] as number)).toBeCloseTo(st['rise'] as number, 6);
        // The calm half: ground at every step of the rise.
        for (let z = st.z; z <= st.z + (st['length'] as number); z += 0.5) expect(Number.isFinite(level.floorAt(-sb * 20, z)), `${w.id} z ${z}`).toBe(true);
        // The way up the bold half rounds the pit by its inner end.
        const from = { x: sb * 30, z: st.z - 5 };
        const to = { x: sb * 30, z: st.z + (st['length'] as number) + 5 };
        expect(groundPath(level, from.x, from.z, to.x, to.z)).toBeGreaterThan(to.z - from.z + 10);
      }
    }
  });

  it('RL-05: from the front of each plate a jump takes the next one (the last — the top floor); off the side of a plate he falls in and rolls back', () => {
    for (const wi of [1, 9]) {
      const w = worlds.worlds[wi]!;
      const level = buildLevel(w);
      const st = w.segments.find((s) => s.type === 'stairs' && s['section'] === 2)!;
      const plates = w.segments.filter((s) => s.type === 'floor' && s['shape'] === 'stairs' && s['solid'] !== false && s.z > st.z && s.z < st.z + (st['length'] as number));
      const stat = spec.mountains[wi]!.ridges[0]!.requires;
      const x = st['x'] as number;
      const end = st.z + (st['length'] as number);
      const s = createSim(level, tuning, { balance, speedCurve: curve, stat });
      let falls = 0;
      s.events.on('fall', () => falls++);
      for (let k = 0; k < plates.length; k++) {
        const pl = plates[k]!;
        s.progress.stat = stat;
        s.teleport(x, (pl['y'] as number) + 0.05, pl.z + (pl['length'] as number) - 1.5);
        for (let i = 0; i < 5; i++) s.step({ moveX: 0, moveZ: 0, jump: false, jumpHeld: false }, DT);
        let air = false;
        for (let i = 0; i < 90; i++) {
          // A hop at about 15 units/s along the stair (the stick pushed as far as that needs at the run of the section).
          s.step({ moveX: 0, moveZ: Math.min(1, 15 / s.params.speed), jump: i === 0, jumpHeld: i < 20 }, DT);
          if (!s.hero.onGround) air = true;
          else if (air) break;
        }
        const want = k + 1 < plates.length ? (plates[k + 1]!['y'] as number) : level.floorAt(x, end + 1);
        expect(falls, `${w.id} plate ${k + 1}`).toBe(0);
        expect(s.hero.pos.y, `${w.id} plate ${k + 1} → next`).toBeGreaterThan(want - 0.2);
      }
      // Off the side of a plate into the pit (the gaps are narrower than the hero, Q-070): back to the flag.
      const pl = plates[1]!;
      s.teleport(x, (pl['y'] as number) + 0.05, pl.z + (pl['length'] as number) / 2);
      for (let i = 0; i < 180 && !s.caught; i++) s.step({ moveX: Math.sign(x), moveZ: 0, jump: false, jumpHeld: false }, DT);
      expect(s.caught, w.id).not.toBeNull();
    }
  }, 60_000);

  it('RL-05: bots run the calm half of the rise, never over the pit of the stairs', () => {
    const w = worlds.worlds[1]!;
    const level = buildLevel(w);
    const pits = level.shapes!.filter((q) => q.kind === 'pit' && q.side !== undefined);
    const s = createSim(level, tuning, { balance, speedCurve: curve, stat: 1e6, bots: { cfg: read('bots.json'), count: 6, seed: 9 } });
    for (const b of s.bots!.list) {
      b.mode = 'up';
      b.x = b.lane = (b.index % 2 ? 1 : -1) * 30;
      b.z = pits[0]!.z0 - 40;
      b.path = [[b.x, pits[0]!.z1 + 30]];
    }
    for (let i = 0; i < 600; i++) {
      s.step({ moveX: 0, moveZ: 0, jump: false, jumpHeld: false }, DT);
      for (const b of s.bots!.list) for (const q of pits) expect(b.z > q.z0 && b.z < q.z1 && b.x > q.x0 && b.x < q.x1, `bot ${b.index} at ${b.x}, ${b.z}`).toBe(false);
    }
  });

  it('RL-06: every mountain has an ice chute on a section from the 2nd, ×1.6, flat, path gifts on it; the hero speeds up on it', () => {
    const CH = spec.relief!.chute!;
    for (const w of worlds.worlds) {
      const level = buildLevel(w);
      const chutes = w.segments.filter((s) => s.type === 'slide' && s['shape'] === 'chute');
      expect(chutes.length, w.id).toBeGreaterThan(0);
      for (const c of chutes) {
        const L = spec.mountains[w.index - 1]!.sections[(c['stretch'] as number) - 1]!.length;
        expect(c['stretch'] as number).toBeGreaterThanOrEqual(CH.fromSection);
        expect(c['length'] as number).toBeGreaterThanOrEqual(Math.min(CH.share[0] * L, CH.minLength!) - 1e-6);
        expect(c['length'] as number).toBeLessThanOrEqual(CH.share[1] * L + 1e-6);
        expect(c['mult']).toBe(1.6);
        const x = c.x as number;
        const z0 = c.z - (c['length'] as number) / 2;
        for (let z = z0; z <= z0 + (c['length'] as number); z += 1) expect(level.floorAt(x, z), `${w.id} chute z ${z}`).toBeCloseTo(c['y'] as number, 6);
        if (x === 0) expect(w.segments.some((g) => g.type === 'gift' && g['path'] === true && g.x === 0 && Math.abs(g.z - c.z) < (c['length'] as number) / 2), `${w.id} gifts on the chute`).toBe(true);
      }
    }
    const w = worlds.worlds[0]!;
    const c = w.segments.find((s) => s.type === 'slide' && s['shape'] === 'chute')!;
    const level = buildLevel(w);
    const s = createSim(level, tuning, { balance, speedCurve: curve, stat: 520 });
    s.teleport(0, level.floorAt(0, c.z) + 0.05, c.z - (c['length'] as number) / 2 + 2);
    for (let i = 0; i < 40; i++) s.step(RUN, DT);
    expect(s.hero.speed).toBeGreaterThan(1.5 * s.params.speed);
  });
});
