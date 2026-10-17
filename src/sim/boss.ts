// What: The giant of the open slope: each zone of worlds.json bosses[] with its giants — patrol along the slope, turn to the hero in the zone (else the nearest bot running it), the chase round the rocks, the slap or the slip past, the way back.
// Called by: sim/world.ts (createBoss, step every tick, its events go out through the sim bus); tests/sim/boss.test.ts, tests/sim/sp-giant.test.ts.
// Keep: Pure TS, no DOM, deterministic; every number from the data (zones, speeds, turnSec, returnMult, helpers, covers — worlds.json; margin, reach, coverBonus, cover — game.json threat.boss).

/**
 * Giants (docs/01-gdd.md 17.6; docs/01a-content.md 16.4): a giant walks its zone up and down at `speed`. The hero steps
 * into the zone — the giant turns to him in `turnSec` and walks at him. Within `reach` of each other the slap comes: the
 * hero running faster than speed × (1 + margin) slips past it (the giant follows him up at `speed` and never closes in),
 * slower — he is caught, rolls back to the start of the zone (the sim plays it), the giant walks back × `returnMult`.
 * Out of the zone uphill — the zone is passed; downhill — the giants go back to their patrol. Several zones on a
 * mountain and several giants in a zone are data only. `scale` — speeds of the rebirth tier (v of the scaled advice).
 * SD-12: a zone with `rearm` is a trial of every run (its giants walk back to patrol once passed, the hero below it
 * meets them again); `rel` — the speed by the hero's level against the zone's (`level`), every tick.
 *
 * A giant of patrol `chase` (SP-06, docs/01-gdd.md 20.6) runs at the hero in the plane of the slope instead, sliding
 * along a rock it meets (no path search). A rock between them hides the hero: the giant runs to where it saw him last
 * and searches there `cover.hideSec`, then knows where he is again — unless he runs at most the slip speed ×
 * (1 − coverBonus): so slow, he is never out of sight. A giant that lost him slaps nobody.
 */
import type { WorldBoss, WorldCover } from '../content/types.ts';

export type GiantMode = 'patrol' | 'turn' | 'chase' | 'back' | 'sit';

export interface GiantState {
  /** Across the slope: 0 but for a chasing giant (SP-06). */
  x: number;
  z: number;
  /** +1 up the slope, −1 down. */
  dir: number;
  /** Where it faces: 0 up the slope, π down (a chasing giant — its way). */
  face: number;
  /** A chasing giant and the hero (SP-06): sees him; lost him behind a rock (runs to where it saw him last, searches
   * there `search` seconds, −1 — not there yet); knows where he is (found him again, or he is too slow to lose it). */
  sight: 'sees' | 'lost' | 'knows';
  search: number;
  lastX: number;
  lastZ: number;
  mode: GiantMode;
  /** Seconds left of the turn. */
  t: number;
  speed: number;
}

/** A helper of the giant (docs/01-gdd.md 18.5): on its border level with the hero, its snowball in the air. */
export interface HelperState {
  x: number;
  z: number;
  /** Seconds to its next throw. */
  t: number;
  ball: { from: [number, number, number]; to: [number, number, number]; t: number; flight: number } | null;
  /** The zone is passed or the hero caught: it waves, no throws. */
  wave: boolean;
}

export interface BossZoneState {
  zone: [number, number];
  giants: GiantState[];
  hero: 'out' | 'in' | 'passed';
  helpers: HelperState[];
  /** A giant lost the hero behind a rock on this run of the zone (analytics `cover`, docs/01-gdd.md 20.13). */
  cover: boolean;
}

export interface BossEvents {
  bossEnter: { tick: number; zone: number };
  bossPassed: { tick: number; zone: number; cover: boolean };
  bossCaught: { tick: number; zone: number; x: number; y: number; z: number; cover: boolean };
  /** A bot running the zone was slapped (docs/01-gdd.md 18.5): `bot` is its index; the bots roll it back. */
  bossBotCaught: { tick: number; zone: number; bot: number };
  /** A helper threw a snowball at the hero (whistle) and it hit him: slowed × `slow` for `slowSec`. */
  helperThrow: { tick: number; zone: number; helper: number };
  helperHit: { tick: number; zone: number; slow: number; slowSec: number };
}

/** A bot running a giant's zone (docs/01-gdd.md 18.5): the giant goes at it only while the hero is not in the zone. */
export interface BossRunner {
  bot: number;
  /** Across the slope (a chasing giant runs at it, SP-06); absent — on the axis. */
  x?: number;
  z: number;
  speed: number;
}

export interface BossHero {
  x: number;
  y: number;
  z: number;
  /** Horizontal speed now; velocity (a helper throws at where he will be). */
  speed: number;
  /** His run speed now (of his Speed, slowed or not): fast enough, a rock hides him (SP-06); absent — `speed`. */
  top?: number;
  vx?: number;
  vz?: number;
}

/** A helper keeps this far ahead of the hero along its border, and its snowball flies this high over the line. */
const HELPER_AHEAD = 14;
const BALL_ARC = 3;
/** SD-12: a giant with `lag` takes the hero's way over this much of his trail, and looks ahead at most this far. */
const VEL_SEC = 0.1;
const MEET_MAX_SEC = 1.5;

/** Does the line (ax, az)–(bx, bz) cross the rock's square (half `r`) in the plane of the slope? */
function crosses(ax: number, az: number, bx: number, bz: number, c: WorldCover): boolean {
  let t0 = 0;
  let t1 = 1;
  for (const [o, d] of [
    [ax - c.x, bx - ax],
    [az - c.z, bz - az],
  ] as const) {
    if (Math.abs(d) < 1e-9) {
      if (Math.abs(o) >= c.r) return false;
      continue;
    }
    const u = (-c.r - o) / d;
    const w = (c.r - o) / d;
    t0 = Math.max(t0, Math.min(u, w));
    t1 = Math.min(t1, Math.max(u, w));
    if (t0 >= t1) return false;
  }
  return true;
}

export interface Boss {
  readonly zones: BossZoneState[];
  /** Index of the zone the hero is in, −1 outside every zone. */
  zoneOf(z: number): number;
  /** One tick; `free` false while the hero cannot act (snowed in, rolling back): the giants keep walking only.
   * `bots` — bots running the zones now (none: the giants know the hero only, as on PS). */
  step(dt: number, hero: BossHero, free: boolean, tick: number, bots?: readonly BossRunner[]): void;
}

export function createBoss(
  data: readonly WorldBoss[],
  cfg: { margin: number; reach: number; coverBonus?: number; cover?: { hideSec: number; pad: number } },
  scale: (zone: number) => number,
  passed: (zone: number) => boolean,
  emit: <K extends keyof BossEvents>(name: K, payload: BossEvents[K]) => void,
  rel?: (zone: number) => number,
): Boss {
  // SD-12 (docs/01-gdd.md 23.9): a rearming zone is never passed for good — its giants meet every run.
  const sitting = (zi: number): boolean => !data[zi]!.rearm && passed(zi);
  const zones: BossZoneState[] = data.map((b, zi) => {
    const [a, c] = b.zone;
    const n = b.giants.length;
    return {
      zone: [a, c],
      hero: sitting(zi) ? 'passed' : 'out',
      cover: false,
      giants: b.giants.map((g, gi) => ({
        x: 0,
        // A phase of the patrol round (up the zone and back): 0 — its start going up, 0.5 — its end coming down.
        z: g.phase === undefined ? a + ((gi + 1) * (c - a)) / (n + 1) : g.phase <= 0.5 ? a + 2 * g.phase * (c - a) : c - (2 * g.phase - 1) * (c - a),
        dir: g.phase === undefined ? (gi % 2 === 0 ? 1 : -1) : g.phase < 0.5 ? 1 : -1,
        face: 0,
        sight: 'sees',
        search: -1,
        lastX: 0,
        lastZ: 0,
        mode: sitting(zi) ? 'sit' : 'patrol',
        t: 0,
        speed: g.speed * scale(zi),
      })),
      helpers: (b.helpers ?? []).map((h) => ({ x: h.x, z: (a + c) / 2, t: h.throwEverySec, ball: null, wave: sitting(zi) })),
    };
  });
  // Speeds of the tier; SD-12: × `rel` of the hero's level against the zone's — SD-15: as he steps in (levels cheap on
  // mountain 1 grow inside the zone; the giant he met stays the one he meets).
  const base = zones.map((s) => s.giants.map((g) => g.speed));
  const kIn = zones.map(() => 1);
  // SD-12: where the hero was, a tick at a time (x, z pairs) while he is in a zone — a giant with `lag` runs at the past.
  const trails = zones.map(() => [] as number[]);
  const zoneOf = (z: number): number => zones.findIndex((s) => z >= s.zone[0] && z <= s.zone[1]);

  const walk = (g: GiantState, zone: [number, number], dz: number): void => {
    g.z = Math.min(zone[1], Math.max(zone[0], g.z + dz));
    g.face = g.dir > 0 ? 0 : Math.PI;
  };

  // The chase in the plane of the slope (SP-06): straight at (tx, tz), a rock met — along its face towards the side of
  // the target (beyond the rock — the side it lies off the rock's middle), `pad` off it; inside the zone's width.
  const pad = cfg.cover?.pad ?? 0;
  const run = (g: GiantState, b: WorldBoss, tx: number, tz: number, step: number, side = 1): boolean => {
    for (const c of b.covers ?? []) {
      // A target by the rock (the hero against it): the nearest point the giant can stand.
      const e = c.r + pad;
      if (Math.abs(tx - c.x) < e && Math.abs(tz - c.z) < e) {
        if (e - Math.abs(tx - c.x) < e - Math.abs(tz - c.z)) tx = c.x + (tx >= c.x ? e : -e);
        else tz = c.z + (tz >= c.z ? e : -e);
      }
    }
    const d = Math.hypot(tx - g.x, tz - g.z);
    if (d < 1e-9) return true;
    const len = Math.min(step, d);
    // SD-05 (docs/01-gdd.md 23.5): a giant of `side` < 1 keeps to the run line — across the slope it moves that share of
    // its step at most, so a run round him by the edge gets past and a straight run meets him.
    let nx = g.x + Math.max(-side * len, Math.min(side * len, ((tx - g.x) * len) / d));
    let nz = g.z + ((tz - g.z) * len) / d;
    for (const c of b.covers ?? []) {
      const e = c.r + pad;
      if (Math.abs(nx - c.x) >= e || Math.abs(nz - c.z) >= e) continue;
      const side = (t: number, at: number, mid: number, own: number): number => (Math.abs(t - at) > 1e-6 ? Math.sign(t - at) : Math.sign(own - mid) || 1);
      if (Math.abs(g.x - c.x) >= e - 1e-6) {
        // At a side face: along it up or down.
        const beyond = (tx - c.x) * (g.x - c.x) < 0;
        nx = c.x + Math.sign(g.x - c.x) * e;
        nz = g.z + (beyond ? side(tz, c.z, c.z, g.z) : side(tz, g.z, c.z, g.z)) * len;
      } else {
        const beyond = (tz - c.z) * (g.z - c.z) < 0;
        nz = c.z + (Math.sign(g.z - c.z) || 1) * e;
        nx = g.x + (beyond ? side(tx, c.x, c.x, g.x) : side(tx, g.x, c.x, g.x)) * len;
      }
    }
    const half = b.width !== undefined ? b.width / 2 - pad : Infinity;
    g.face = Math.atan2(nx - g.x, nz - g.z);
    g.x = Math.max(-half, Math.min(half, nx));
    g.z = Math.min(b.zone[1], Math.max(b.zone[0], nz));
    return d <= step;
  };

  // Helpers (docs/01-gdd.md 18.5): along their border level with the hero; while he is in the zone each throws a
  // snowball every throwEverySec at where he will be in flightSec; it lands — within hitRadius of him: slowed.
  const stepHelpers = (s: BossZoneState, zi: number, dt: number, hero: BossHero, free: boolean, tick: number): void => {
    const hd = data[zi]!.helpers;
    if (!hd) return;
    const [a, c] = s.zone;
    s.helpers.forEach((h, hi) => {
      const d = hd[hi]!;
      const want = s.hero === 'in' ? Math.min(c, Math.max(a, hero.z + HELPER_AHEAD)) : (a + c) / 2;
      const step = (s.giants[0]?.speed ?? 10) * 1.5 * dt;
      h.z += Math.max(-step, Math.min(step, want - h.z));
      if (h.ball) {
        h.ball.t += dt;
        if (h.ball.t >= h.ball.flight) {
          const [tx, , tz] = h.ball.to;
          h.ball = null;
          if (free && Math.hypot(hero.x - tx, hero.z - tz) <= d.hitRadius) emit('helperHit', { tick, zone: zi, slow: d.slow, slowSec: d.slowSec });
        }
      }
      if (s.hero !== 'in' || !free || h.wave) return;
      h.t -= dt;
      if (h.t > 0 || h.ball) return;
      h.t = d.throwEverySec;
      const tx = hero.x + (hero.vx ?? 0) * d.flightSec;
      const tz = Math.min(c, hero.z + (hero.vz ?? 0) * d.flightSec);
      h.ball = { from: [h.x, hero.y + BALL_ARC, h.z], to: [tx, hero.y, tz], t: 0, flight: d.flightSec };
      emit('helperThrow', { tick, zone: zi, helper: hi });
    });
  };

  return {
    zones,
    zoneOf,
    step(dt, hero, free, tick, bots = []) {
      zones.forEach((s, zi) => {
        const [a, c] = s.zone;
        const data0 = data[zi]!;
        if (s.hero !== 'in') kIn[zi] = rel?.(zi) ?? 1;
        s.giants.forEach((g, gi) => (g.speed = base[zi]![gi]! * kIn[zi]!));
        // SD-12: the hero below a rearming zone he passed — its giants are his again.
        if (s.hero === 'passed' && data0.rearm && hero.z < a) {
          s.hero = 'out';
          s.cover = false;
        }
        // Bots in this zone (docs/01-gdd.md 18.5): until the hero has passed it; one slapped this tick runs no more.
        const runners = s.hero === 'passed' ? [] : bots.filter((r) => r.z >= a && r.z <= c);
        const covers = data0.covers ?? [];
        const slapped = new Set<number>();
        if (runners.length > 0)
          s.giants.forEach((g, gi) => {
            if (g.mode === 'patrol' || g.mode === 'back') {
              g.mode = 'turn';
              g.t = data0.giants[gi]!.turnSec;
            }
          });
        if (s.hero !== 'passed') {
          const inside = free && hero.z >= a && hero.z <= c;
          if (inside && s.hero === 'out') {
            s.hero = 'in';
            s.cover = false;
            trails[zi]!.length = 0;
            emit('bossEnter', { tick, zone: zi });
            s.giants.forEach((g, gi) => {
              g.mode = 'turn';
              g.t = data0.giants[gi]!.turnSec;
            });
            // The first snowballs within 3 s of the zone (docs/01a-content.md 17.4), the helpers a little apart.
            s.helpers.forEach((h, hi) => {
              h.wave = false;
              h.t = data0.helpers![hi]!.throwEverySec * (0.4 + 0.3 * hi);
            });
          } else if (free && hero.z > c && s.hero === 'in') {
            s.hero = 'passed';
            // SD-12: a rearming zone's giants walk back to patrol — no win pose, the next run meets them.
            s.giants.forEach((g) => {
              g.mode = data0.rearm ? 'back' : 'sit';
              g.dir = -1;
              g.sight = 'sees';
            });
            s.helpers.forEach((h) => (h.wave = true));
            emit('bossPassed', { tick, zone: zi, cover: s.cover });
            return;
          } else if (!inside && s.hero === 'in') {
            s.hero = 'out';
            if (runners.length === 0) s.giants.forEach((g) => (g.mode = g.mode === 'sit' ? 'sit' : 'back'));
          }
        }
        // The hero in the zone first (producer 12.10, Q-047: the giant is about him); else the nearest bot running it.
        const target = (g: GiantState): number => {
          if (s.hero === 'in') return hero.z;
          let best = NaN;
          for (const r of runners) if (!slapped.has(r.bot) && !(Math.abs(r.z - g.z) >= Math.abs(best - g.z))) best = r.z;
          return best;
        };
        // A chasing giant (SP-06): the hero where it sees him (or knows: hideSec gone), else where it saw him last; a bot.
        const slip = (g: GiantState): number => g.speed * (1 + cfg.margin);
        const trail = trails[zi]!;
        if (s.hero === 'in') {
          trail.push(hero.x, hero.z);
          if (trail.length > 512) trail.splice(0, trail.length - 512);
        }
        const chaseAt = (g: GiantState, lag: number): [number, number] | null => {
          if (s.hero === 'in') {
            if (!covers.some((cv) => crosses(g.x, g.z, hero.x, hero.z, cv))) {
              g.sight = 'sees';
              g.lastX = hero.x;
              g.lastZ = hero.z;
            } else if (g.sight === 'sees') {
              if (free && (hero.top ?? hero.speed) > slip(g) * (1 - (cfg.coverBonus ?? 0))) {
                g.sight = 'lost';
                g.search = -1;
                s.cover = true;
              } else g.sight = 'knows';
            }
            if (g.sight === 'lost' && g.search >= 0) {
              g.search += dt;
              if (g.search >= (cfg.cover?.hideSec ?? 0)) g.sight = 'knows';
            }
            if (g.sight === 'lost') return [g.lastX, g.lastZ];
            if (lag <= 0) return [hero.x, hero.z];
            // SD-12: what it saw `lag` ago, carried on along his way of then up to the meeting — a run straight, or to the
            // edge early, meets it; a sharp turn within `lag` of it, not.
            const tick = Math.max(dt, 1e-6);
            const n = trail.length / 2;
            const back = Math.min(n - 1, Math.round(lag / tick));
            const w = Math.min(n - 1 - back, Math.round(VEL_SEC / tick));
            const px = trail[2 * (n - 1 - back)]!;
            const pz = trail[2 * (n - 1 - back) + 1]!;
            if (w <= 0) return [px, pz];
            const vx = (px - trail[2 * (n - 1 - back - w)]!) / (w * tick);
            const vz = (pz - trail[2 * (n - 1 - back - w) + 1]!) / (w * tick);
            const nx = px + vx * back * tick;
            const nz = pz + vz * back * tick;
            const meet = Math.min(MEET_MAX_SEC, Math.hypot(nx - g.x, nz - g.z) / Math.max(1e-6, g.speed + Math.hypot(vx, vz)));
            return [nx + vx * meet, nz + vz * meet];
          }
          g.sight = 'sees';
          let best: BossRunner | null = null;
          for (const r of runners) if (!slapped.has(r.bot) && (!best || Math.hypot((r.x ?? 0) - g.x, r.z - g.z) < Math.hypot((best.x ?? 0) - g.x, best.z - g.z))) best = r;
          return best ? [best.x ?? 0, best.z] : null;
        };
        const blind = (g: GiantState): boolean => g.sight === 'lost';
        // How far it is from a runner: along the slope for a patrol giant (PS), in the plane for a chasing one.
        const near = (g: GiantState, chase: boolean, x: number, z: number): boolean => (chase ? Math.hypot(x - g.x, z - g.z) : Math.abs(z - g.z)) <= cfg.reach;
        stepHelpers(s, zi, dt, hero, free, tick);
        s.giants.forEach((g, gi) => {
          const chase = data0.giants[gi]!.patrol === 'chase';
          switch (g.mode) {
            case 'sit':
              break;
            case 'patrol':
              walk(g, s.zone, g.dir * g.speed * dt);
              if (g.z >= c || g.z <= a) g.dir = g.z >= c ? -1 : 1;
              break;
            case 'back':
              // Back on patrol faster than the run; the hero stepping in again turns it at once.
              g.x -= Math.sign(g.x) * Math.min(Math.abs(g.x), g.speed * data0.returnMult * dt);
              walk(g, s.zone, g.dir * g.speed * data0.returnMult * dt);
              if (g.z >= c || g.z <= a) {
                g.dir = g.z >= c ? -1 : 1;
                g.mode = 'patrol';
              }
              break;
            case 'turn':
              g.t -= dt;
              if (g.t <= 0) g.mode = 'chase';
              break;
            case 'chase': {
              if (chase) {
                const at = chaseAt(g, data0.giants[gi]!.lag ?? 0);
                if (!at) {
                  g.mode = 'back';
                  break;
                }
                // SD-15 (review: a dodge that got past was caught from behind by a turn back up): a giant of every run left
                // behind keeps on only while he is quicker than the hero's Speed (two levels below); else he walks back.
                if (data0.rearm && s.hero === 'in' && hero.z > g.z + cfg.reach && g.speed <= (hero.top ?? hero.speed)) {
                  g.mode = 'back';
                  g.dir = -1;
                  break;
                }
                g.dir = at[1] >= g.z ? 1 : -1;
                // At the point it lost him: it searches there (hideSec).
                if (run(g, data0, at[0], at[1], g.speed * dt, data0.giants[gi]!.side ?? 1) && g.sight === 'lost' && g.search < 0) g.search = 0;
                break;
              }
              const tz = target(g);
              if (Number.isNaN(tz)) {
                g.mode = 'back';
                break;
              }
              g.dir = tz >= g.z ? 1 : -1;
              walk(g, s.zone, g.dir * Math.min(g.speed * dt, Math.abs(tz - g.z)));
              break;
            }
          }
          // A bot within reach of a giant that walks at it: slower than speed × (1 + margin) — slapped, rolled back.
          if (g.mode === 'chase')
            for (const r of runners)
              if (!slapped.has(r.bot) && near(g, chase, r.x ?? 0, r.z) && r.speed <= slip(g)) {
                slapped.add(r.bot);
                emit('bossBotCaught', { tick, zone: zi, bot: r.bot });
              }
          // The slap: within reach of a giant that walks at him (and sees him); only a run faster than speed × (1 + margin)
          // slips past.
          // SD-05 (docs/01-gdd.md 23.5): a giant with slipPast false slaps at any speed — a dodge or a rock, not a straight run.
          // SD-15: with `slipMargin` a run that much faster than him slips past (Speed two levels above the stage).
          const sm = data0.giants[gi]!.slipMargin;
          const slips = (data0.giants[gi]!.slipPast !== false && hero.speed > slip(g)) || (sm !== undefined && hero.speed > g.speed * (1 + sm));
          if (s.hero === 'in' && g.mode === 'chase' && !blind(g) && near(g, chase, hero.x, hero.z) && !slips) {
            s.hero = 'out';
            s.giants.forEach((o) => {
              o.mode = 'back';
              o.dir = 1;
              o.sight = 'sees';
            });
            s.helpers.forEach((h) => (h.wave = true));
            emit('bossCaught', { tick, zone: zi, x: hero.x, y: hero.y, z: hero.z, cover: s.cover });
          }
        });
      });
    },
  };
}
