import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HeroInput } from '../../src/sim/controller.ts';
import { createSim, type Sim } from '../../src/sim/world.ts';
import { createBoss, type BossHero } from '../../src/sim/boss.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { moveSpeed } from '../../src/sim/effects/moveSpeed.ts';
import type { BalanceJson, GameJson, OpenSpecJson, TuningJson, World, WorldBoss, WorldCover, WorldsJson } from '../../src/content/types.ts';

// PS-07: the giant of the open slope (docs/01-gdd.md 17.6; docs/01a-content.md 16.4; producer's decision 10.10: patrol).
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const balance = mergePatch(read('balance.json') as BalanceJson, read('pace/open/balance.json'));
const tuning = mergePatch(read('tuning.json') as TuningJson, read('pace/open/tuning.json'));
const game = read('game.json') as GameJson;
const worlds = (read('pace/open/worlds.json') as WorldsJson).worlds;
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
const cfg = game.threat.boss!;
const DT = 1 / 60;
const RUN: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };
const w1 = worlds[0]!;
const zone = w1.bosses![0]!.zone;
const giant = w1.bosses![0]!.giants[0]!;
/** The stat whose run speed is exactly k × the giant's speed × (1 + margin). */
const statFor = (k: number): number => {
  const v = k * giant.speed * (1 + cfg.margin);
  return Math.pow(10, (v / curve.base - 1) / curve.k) - 1;
};

function climb(world: World, stat: number, frontier = 0): { s: Sim; events: string[] } {
  const level = buildLevel(world);
  const s = createSim(level, tuning, { balance, speedCurve: curve, stat, boss: cfg, resume: frontier ? { frontierWall: frontier } : undefined });
  const events: string[] = [];
  for (const n of ['bossEnter', 'bossPassed', 'bossCaught', 'gateOpen', 'gatePass', 'caughtEnd'] as const) s.events.on(n, () => events.push(n));
  return { s, events };
}
const runUntil = (s: Sim, done: () => boolean, sec = 30): void => {
  for (let i = 0; i < sec * 60 && !done(); i++) s.step(RUN, DT);
};

describe('giant (PS-07)', () => {
  it('the advice of every mountain runs faster than its giant × (1 + margin)', () => {
    for (const w of worlds) for (const b of w.bosses!) for (const g of b.giants) expect(moveSpeed(b.requires, curve)).toBeGreaterThan(g.speed * (1 + cfg.margin));
  });

  it('faster than speed × (1 + margin): through the zone to the summit, never caught; the giant’s check opens', () => {
    for (const stat of [w1.bosses![0]!.requires, statFor(1.02)]) {
      const { s, events } = climb(w1, stat);
      s.teleport(0, s.level.floorAt(0, zone[0] - 10), zone[0] - 10);
      runUntil(s, () => s.hero.pos.z > zone[1] + 5);
      expect(events, `stat ${stat}`).toContain('bossEnter');
      expect(events).not.toContain('bossCaught');
      expect(events).toContain('bossPassed');
      expect(s.gatesOpen[s.gatesOpen.length - 1]).toBe(true);
      expect(s.gatesPassed[s.gatesPassed.length - 1]).toBe(true);
    }
  });

  it('slower: the giant catches him, he is back at the flag of the last ridge within caught.maxSec (RL-02); Speed, coins and frontier stay', () => {
    const { s, events } = climb(w1, statFor(0.97), 3);
    s.teleport(0, s.level.floorAt(0, zone[0] - 10), zone[0] - 10);
    const frontier = s.gatesPassed.map(Boolean);
    let caughtAt = -1;
    s.events.on('bossCaught', () => void (caughtAt = s.tick));
    runUntil(s, () => caughtAt >= 0);
    expect(caughtAt).toBeGreaterThan(0);
    const stat = s.progress.stat;
    const coins = s.coins;
    for (let i = 0; i < balance.caught.maxSec * 60 + 2; i++) s.step({ moveX: 0, moveZ: 0, jump: false, jumpHeld: false }, DT);
    expect(events).toContain('caughtEnd');
    expect(s.caught).toBeNull();
    // RL-02 (docs/01-gdd.md 21.2): the flag past the last ridge, the start of the finish straight.
    const flag = s.level.checkpoints.find((c) => c.wall === 3)!;
    expect(Math.abs(s.hero.pos.z - flag.z)).toBeLessThan(0.5);
    expect(s.hero.pos.z).toBeLessThan(zone[0]);
    // Steps while rolling back count nothing; the catch takes nothing away.
    expect(s.progress.stat).toBeGreaterThanOrEqual(stat);
    expect(s.coins).toBe(coins);
    expect(s.gatesPassed.map(Boolean)).toEqual(frontier);
    expect(events).not.toContain('bossPassed');
    // Straight back in: the chase starts again.
    const enters = events.filter((e) => e === 'bossEnter').length;
    runUntil(s, () => events.filter((e) => e === 'bossEnter').length > enters, 5);
    expect(events.filter((e) => e === 'bossEnter').length).toBe(enters + 1);
    runUntil(s, () => s.boss!.zones[0]!.giants[0]!.mode === 'chase', 3);
    expect(s.boss!.zones[0]!.giants[0]!.mode).toBe('chase');
  });

  it('on the run he meets the giant at his run speed: half-pushed stick and zigzags with the advice — past him; a slow walk — caught (playtest PS)', () => {
    const level = buildLevel(w1);
    const advice = w1.bosses![0]!.requires;
    for (const [input, passes] of [
      [{ moveX: 0, moveZ: 0.6, jump: false, jumpHeld: false }, true],
      [{ moveX: 0.5, moveZ: 0.85, jump: false, jumpHeld: false }, true],
      [{ moveX: 0, moveZ: 0.3, jump: false, jumpHeld: false }, false],
    ] as Array<[HeroInput, boolean]>) {
      // From a standstill at the start of the zone, where a catch puts him; the giant at the foot of his patrol.
      const s = createSim(level, tuning, { balance, speedCurve: curve, stat: advice, boss: cfg });
      s.boss!.zones[0]!.giants[0]!.z = zone[0] + 20;
      s.teleport(0, level.floorYAt(zone[0] - 3), zone[0] - 3);
      const events: string[] = [];
      s.events.on('bossCaught', () => events.push('caught'));
      s.events.on('bossPassed', () => events.push('passed'));
      let zig = 1;
      for (let i = 0; i < 40 * 60 && events.length === 0; i++) {
        if (i % 30 === 0) zig = -zig;
        s.step({ ...input, moveX: input.moveX * zig }, DT);
      }
      expect(events, JSON.stringify(input)).toEqual([passes ? 'passed' : 'caught']);
    }
  });

  it('standing still in the zone the hero is caught at any Speed', () => {
    const { s, events } = climb(w1, 1e12);
    s.teleport(0, s.level.floorAt(0, zone[0] + 5), zone[0] + 5);
    for (let i = 0; i < 30 * 60 && !events.includes('bossCaught'); i++) s.step({ moveX: 0, moveZ: 0, jump: false, jumpHeld: false }, DT);
    expect(events).toContain('bossCaught');
  });

  it('a second zone and a second giant in a zone work from the data alone', () => {
    const w = JSON.parse(JSON.stringify(w1)) as World;
    const mid = (zone[0] + zone[1]) / 2;
    w.bosses = [
      { ...w.bosses![0]!, zone: [zone[0], mid], giants: [{ ...giant }] },
      { ...w.bosses![0]!, zone: [mid + 1, zone[1]], giants: [{ ...giant }, { ...giant, speed: giant.speed * 0.9 }] },
    ];
    const fast = climb(w, statFor(1.05));
    fast.s.teleport(0, fast.s.level.floorAt(0, zone[0] - 10), zone[0] - 10);
    runUntil(fast.s, () => fast.s.hero.pos.z > zone[1] + 5);
    expect(fast.events.filter((e) => e === 'bossEnter')).toHaveLength(2);
    expect(fast.events.filter((e) => e === 'bossPassed')).toHaveLength(2);
    expect(fast.events).not.toContain('bossCaught');
    expect(fast.s.boss!.zones[1]!.giants).toHaveLength(2);
    expect(fast.s.gatesOpen[fast.s.gatesOpen.length - 1]).toBe(true);
    // Slower than the giants of the second zone, but faster than the first's? Still caught in the first one.
    const slow = climb(w, statFor(0.95));
    slow.s.teleport(0, slow.s.level.floorAt(0, zone[0] - 10), zone[0] - 10);
    runUntil(slow.s, () => slow.events.includes('bossCaught'));
    expect(slow.events).toContain('bossCaught');
    expect(slow.s.hero.pos.z).toBeLessThan(mid);
  });

  it('the avalanche never starts above the start of the first zone (threat.spawnMaxZ)', () => {
    for (const w of worlds) expect(w.threat.spawnMaxZ).toBe(w.bosses![0]!.zone[0]);
  });
});

// SP-06: the giant runs at the hero, rocks to hide behind (docs/01-gdd.md 20.6; docs/01a-content.md 19.4).
const spec = read('pace/open/worlds-spec.json') as OpenSpecJson;
const HERO_R = 0.5;
type Policy = 'straight' | 'hide';

/** Does the line a–b cross the square of half `r` round c (the bot's own look, not the giant's code)? */
function crossSq(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, r: number): boolean {
  let t0 = 0;
  let t1 = 1;
  for (const [o, d] of [
    [ax - cx, bx - ax],
    [az - cz, bz - az],
  ] as const) {
    if (Math.abs(d) < 1e-9) {
      if (Math.abs(o) >= r) return false;
      continue;
    }
    const u = (-r - o) / d;
    const w = (r - o) / d;
    t0 = Math.max(t0, Math.min(u, w));
    t1 = Math.min(t1, Math.max(u, w));
    if (t0 >= t1) return false;
  }
  return true;
}

/**
 * A deterministic bot in the plane of the slope against the giant's code: run `k` of 10 starts at x −20…20 and waits
 * k × 0.9 s below the zone (the giants' patrol phase). `straight` — up the slope. `hide` — waits below the zone until
 * the nearest giant is 60% of it away, then keeps the next rock between him and the giant; the giant at the point it
 * lost him — straight away from it, then up; 8 s behind a rock with no luck — up. A snowball falling where he is going —
 * a step aside (its arc shows where). Speed — `share` × the run speed of the advice (stat = requires).
 */
function trial(b: WorldBoss, k: number, share: number, policy: Policy): 'passed' | 'caught' | 'timeout' {
  const [a, c] = b.zone;
  const v0 = moveSpeed(b.requires, curve) * share;
  const ev: string[] = [];
  let slowT = 0;
  let slowK = 1;
  const boss = createBoss([b], cfg, () => 1, () => false, (n, p) => {
    ev.push(n);
    if (n === 'helperHit') {
      slowT = (p as { slowSec: number }).slowSec;
      slowK = (p as { slow: number }).slow;
    }
  });
  const hero: BossHero = { x: -20 + (40 * k) / 9, y: 0, z: a - 10, speed: 0, vx: 0, vz: 0 };
  for (let i = 0; i < Math.round(k * 0.9 * 60); i++) boss.step(DT, hero, true, i);
  let state: 'wait' | 'duck' | 'away' | 'up' = policy === 'hide' ? 'wait' : 'up';
  let rock: WorldCover | null = null;
  let held = 0;
  let ax = 0;
  let az = 1;
  for (let i = 0; i < 60 * 60; i++) {
    if (ev.includes('bossCaught')) return 'caught';
    if (ev.includes('bossPassed')) return 'passed';
    const zs = boss.zones[0]!;
    const G = zs.giants.reduce((p, g) => (Math.hypot(g.x - hero.x, g.z - hero.z) < Math.hypot(p.x - hero.x, p.z - hero.z) ? g : p));
    let tx = hero.x;
    let tz = c + 30;
    if (state === 'wait') {
      if (Math.min(...zs.giants.map((g) => g.z - a)) >= 0.6 * (c - a) || i > 20 * 60) state = 'duck';
      else tz = a - 10;
    }
    if (state === 'duck') {
      held += DT;
      rock = (b.covers ?? []).find((cv) => cv.z > hero.z - cv.r) ?? null;
      if (!rock || held > 8) state = 'up';
      else if (zs.giants.some((g) => g.sight === 'lost' && g.search >= 0)) {
        state = 'away';
        const d = Math.hypot(hero.x - G.x, hero.z - G.z) || 1;
        ax = (hero.x - G.x) / d;
        az = (hero.z - G.z) / d;
      } else {
        // The point of the rock's ring opposite the giant.
        const dx = rock.x - G.x;
        const dz = rock.z - G.z;
        const d = Math.max(Math.abs(dx), Math.abs(dz)) || 1;
        tx = rock.x + (dx / d) * (rock.r + 1.5);
        tz = rock.z + (dz / d) * (rock.r + 1.5);
      }
    }
    if (state === 'away') {
      tx = hero.x + ax * 10;
      tz = hero.z + Math.max(az, 0.3) * 10;
      if (hero.z >= rock!.z + 25 || Math.abs(hero.x - rock!.x) > 25) state = 'up';
    }
    // A rock in the way: round it by its corner nearest the way.
    for (const cv of b.covers ?? []) {
      if (!crossSq(hero.x, hero.z, tx, tz, cv.x, cv.z, cv.r + HERO_R)) continue;
      const e = cv.r + 1.5;
      let best: [number, number] | null = null;
      let bd = Infinity;
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const px = cv.x + sx * e;
        const pz = cv.z + sz * e;
        if (Math.hypot(px - hero.x, pz - hero.z) < 0.3 || crossSq(hero.x, hero.z, px, pz, cv.x, cv.z, cv.r + HERO_R)) continue;
        const dd = Math.hypot(px - hero.x, pz - hero.z) + Math.hypot(tx - px, tz - pz);
        if (dd < bd) {
          bd = dd;
          best = [px, pz];
        }
      }
      if (best) [tx, tz] = best;
    }
    const sp = v0 * (slowT > 0 ? slowK : 1);
    slowT = Math.max(0, slowT - DT);
    for (const h of zs.helpers) {
      if (!h.ball) continue;
      const left = h.ball.flight - h.ball.t;
      const d0 = Math.hypot(tx - hero.x, tz - hero.z) || 1;
      if (Math.hypot(hero.x + ((tx - hero.x) / d0) * sp * left - h.ball.to[0], hero.z + ((tz - hero.z) / d0) * sp * left - h.ball.to[2]) < 3) {
        tx = hero.x + (hero.x >= h.ball.to[0] ? 6 : -6);
        tz = hero.z + 6;
      }
    }
    const dx = tx - hero.x;
    const dz = tz - hero.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-6) {
      const st = Math.min(sp * DT, d);
      hero.x += (dx / d) * st;
      hero.z += (dz / d) * st;
      hero.vx = (dx / d) * sp;
      hero.vz = (dz / d) * sp;
    }
    for (const cv of b.covers ?? []) {
      const e = cv.r + HERO_R;
      if (Math.abs(hero.x - cv.x) >= e || Math.abs(hero.z - cv.z) >= e) continue;
      if (e - Math.abs(hero.x - cv.x) < e - Math.abs(hero.z - cv.z)) hero.x = cv.x + Math.sign(hero.x - cv.x) * e;
      else hero.z = cv.z + Math.sign(hero.z - cv.z) * e;
    }
    hero.speed = d > 1e-6 ? sp : 0;
    hero.top = sp;
    boss.step(DT, hero, true, 10_000 + i);
  }
  return 'timeout';
}
const runs = (b: WorldBoss, share: number, policy: Policy) => Array.from({ length: 10 }, (_, k) => trial(b, k, share, policy));
const count = (r: string[], what: string) => r.filter((x) => x === what).length;

describe('the giant runs at the hero, rocks to hide behind (SP-06)', () => {
  it('data: zones 160–200 wide, rocks by 19.2 at 30/55/75/90% of the zone, ±width/4 by turns, 8 × 8 × 6; giants chase; coverBonus 0.15, hideSec 1.5; grottos before the zone', () => {
    expect(cfg.coverBonus).toBe(0.15);
    expect(cfg.cover).toEqual({ hideSec: 1.5, pad: 4 });
    const COUNT = [2, 2, 2, 3, 3, 3, 4, 4, 4, 4];
    worlds.forEach((w, wi) => {
      const b = w.bosses![0]!;
      const [a, c] = b.zone;
      expect(b.width).toBe(spec.mountains[wi]!.boss.width);
      expect(b.width!).toBeGreaterThanOrEqual(160);
      expect(b.width!).toBeLessThanOrEqual(200);
      for (const g of b.giants) expect(g.patrol).toBe('chase');
      expect(b.covers!.map((cv) => cv.z)).toEqual([0.3, 0.55, 0.75, 0.9].slice(0, COUNT[wi]).map((t) => Math.round((a + t * (c - a)) * 1000) / 1000));
      b.covers!.forEach((cv, k) => {
        expect(cv.x).toBeCloseTo((k % 2 === 0 ? 1 : -1) * (b.width! / 4), 6);
        expect([cv.r, cv.h]).toEqual([4, 6]);
      });
      // The rocks are colliders of the level.
      const level = buildLevel(w);
      expect(level.boxes.filter((x) => x.kind === 'cover' && x.solid)).toHaveLength(COUNT[wi]!);
      // The grotto with the belt by the axis on every mountain; at both edges too from mountain 4.
      const line = w.segments.filter((s) => s.type === 'niche' && s['kind'] === 'bossLine');
      expect(line.filter((s) => s['rock'] !== undefined)).toHaveLength(1);
      expect(line.filter((s) => s['rock'] === undefined).map((s) => s['side'])).toEqual(wi >= 3 ? ['left', 'right'] : []);
      // Helpers stand at the edge of the zone: width/2 − 4.
      for (const h of b.helpers ?? []) expect(Math.abs(h.x)).toBe(b.width! / 2 - 4);
    });
  });

  it('in the zone the giant runs at the hero at V_b, slides round a rock, and behind it loses him: to his last point, hideSec there', () => {
    const b = w1.bosses![0]!;
    const rock = b.covers![0]!;
    const hero: BossHero = { x: 30, y: 0, z: zone[0] + 30, speed: 0, vx: 0, vz: 0 };
    const boss = createBoss([b], cfg, () => 1, () => false, () => {});
    const g = boss.zones[0]!.giants[0]!;
    for (let i = 0; i < 40; i++) boss.step(DT, hero, true, i);
    expect(g.mode).toBe('chase');
    // Its course: at the hero, V_b a second.
    const [x0, z0] = [g.x, g.z];
    boss.step(DT, hero, true, 41);
    expect(Math.hypot(g.x - x0, g.z - z0)).toBeCloseTo(giant.speed * DT, 6);
    expect(Math.atan2(g.x - x0, g.z - z0)).toBeCloseTo(Math.atan2(hero.x - x0, hero.z - z0), 6);
    // A rock between them: round it along its faces, never into it (pad off it), to the hero standing past it.
    const pad = cfg.cover!.pad;
    Object.assign(g, { x: rock.x, z: rock.z + 30, sight: 'sees' });
    Object.assign(hero, { x: rock.x, z: rock.z - rock.r - 1, speed: 0 });
    let round = false;
    for (let i = 0; i < 5 * 60 && boss.zones[0]!.hero === 'in'; i++) {
      boss.step(DT, hero, true, 100 + i);
      expect(Math.abs(g.x - rock.x) >= rock.r + pad - 1e-6 || Math.abs(g.z - rock.z) >= rock.r + pad - 1e-6, `inside at ${g.x}, ${g.z}`).toBe(true);
      if (g.z < rock.z) round = true;
    }
    expect(round, 'round the rock').toBe(true);
    // Behind the rock, faster than the slip speed × (1 − coverBonus): out of sight — to where it saw him last, hideSec there.
    const lose = (k: number) => {
      const bs = createBoss([b], cfg, () => 1, () => false, () => {});
      const gs = bs.zones[0]!.giants[0]!;
      const h: BossHero = { x: rock.x - 10, y: 0, z: rock.z, speed: giant.speed * (1 + cfg.margin) * k, vx: 0, vz: 0 };
      bs.step(DT, h, true, 0);
      Object.assign(gs, { mode: 'chase', x: rock.x - 40, z: rock.z });
      const seen: string[] = [];
      let lostAt = -1;
      let there = -1;
      let found = -1;
      for (let i = 1; i < 6 * 60 && found < 0 && bs.zones[0]!.hero === 'in'; i++) {
        // Seen on the near side, then against the far side of the rock.
        if (i === 10) h.x = rock.x + rock.r + 1;
        bs.step(DT, h, true, i);
        seen.push(gs.sight);
        if (lostAt < 0 && gs.sight === 'lost') lostAt = i;
        if (there < 0 && gs.sight === 'lost' && gs.search >= 0) there = i;
        if (lostAt >= 0 && gs.sight === 'knows') found = i;
      }
      return { gs, seen, lostAt, there, found };
    };
    const fast = lose(0.9);
    expect(fast.lostAt).toBe(10);
    expect([fast.gs.lastX, fast.gs.lastZ]).toEqual([rock.x - 10, rock.z]);
    expect(fast.there).toBeGreaterThan(fast.lostAt);
    expect((fast.found - fast.there) * DT).toBeCloseTo(cfg.cover!.hideSec, 1);
    // Slower than the slip speed × (1 − coverBonus): never out of its sight.
    const slow = lose(0.84);
    expect(slow.seen).not.toContain('lost');
    expect(slow.seen).toContain('knows');
  });

  for (const wi of [0, 4, 9]) {
    it(`mountain ${wi + 1}: 10 runs — the advice straight ≥ 9 passed; 0.85 behind a rock ≥ 7 passed; 0.7 ≥ 9 caught`, () => {
      const b = worlds[wi]!.bosses![0]!;
      const straight = runs(b, 1, 'straight');
      const hide = runs(b, 0.85, 'hide');
      const slow = runs(b, 0.7, 'hide');
      expect(count(straight, 'passed'), straight.join(' ')).toBeGreaterThanOrEqual(9);
      expect(count(hide, 'passed'), hide.join(' ')).toBeGreaterThanOrEqual(7);
      expect(count(slow, 'caught'), slow.join(' ')).toBeGreaterThanOrEqual(9);
      // Mountain 1 (no helpers): without the rocks 0.85 does not get past (docs/01-gdd.md 20.6).
      if (wi === 0) expect(count(runs(b, 0.85, 'straight'), 'caught')).toBeGreaterThanOrEqual(9);
    });
  }

  it('patrol "alongZ" — as before SP: along the axis only, the slap by z; the rocks change nothing', () => {
    const b: WorldBoss = { ...w1.bosses![0]!, giants: w1.bosses![0]!.giants.map((g) => ({ ...g, patrol: 'alongZ' })) };
    const xs: number[] = [];
    const boss = createBoss([b], cfg, () => 1, () => false, () => {});
    const hero: BossHero = { x: 50, y: 0, z: zone[0] + 5, speed: 0, vx: 0, vz: 0 };
    let caught = false;
    const b2 = createBoss([b], cfg, () => 1, () => false, (n) => void (caught ||= n === 'bossCaught'));
    for (let i = 0; i < 30 * 60 && !caught; i++) {
      boss.step(DT, hero, true, i);
      b2.step(DT, hero, true, i);
      xs.push(boss.zones[0]!.giants[0]!.x);
    }
    expect(new Set(xs)).toEqual(new Set([0]));
    // Standing at x 50: a patrol giant slaps by z all the same.
    expect(caught).toBe(true);
    expect(count(runs(b, 1, 'straight'), 'passed')).toBe(10);
    expect(count(runs(b, 0.85, 'hide'), 'caught')).toBe(10);
  });

  it('MU round 4: the hero in the zone is the target — a giant sent off (patrol, back) turns to him again within 2 s', () => {
    const b: WorldBoss = { ...w1.bosses![0]!, rearm: true };
    const hero: BossHero = { x: 10, y: 0, z: zone[0] + 20, speed: 0, vx: 0, vz: 0 };
    const boss = createBoss([b], cfg, () => 1, () => false, () => {});
    const g = boss.zones[0]!.giants[0]!;
    for (let i = 0; i < 40; i++) boss.step(DT, hero, true, i);
    expect(g.mode).toBe('chase');
    // Sent off while the hero stands in the zone: no turn back to him within 2 s of the last change, then at him again.
    g.mode = 'back';
    let t = 0;
    let at = -1;
    for (let i = 0; i < 4 * 60 && at < 0; i++, t += DT) {
      boss.step(DT, hero, true, 100 + i);
      if (g.mode !== 'back' && g.mode !== 'patrol') at = t;
    }
    expect(at, 'turned to him again').toBeGreaterThanOrEqual(0);
    expect(at, 'within 2 s').toBeLessThanOrEqual(2 + 1e-6);
    for (let i = 0; i < 60 && (g.mode as string) === 'turn'; i++) boss.step(DT, hero, true, 500 + i);
    expect(g.mode).toBe('chase');
    const [x0, z0] = [g.x, g.z];
    boss.step(DT, hero, true, 999);
    expect((g.x - x0) * (hero.x - x0) + (g.z - z0) * (hero.z - z0), 'a step towards him').toBeGreaterThan(0);
  });
});
