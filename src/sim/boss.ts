// What: The giant of the open slope: each zone of worlds.json bosses[] with its giants — patrol along the slope, turn to the nearest runner (hero or bot), the slap or the slip past, the way back.
// Called by: sim/world.ts (createBoss, step every tick, its events go out through the sim bus); tests/sim/boss.test.ts.
// Keep: Pure TS, no DOM, deterministic; every number from the data (zones, speeds, turnSec, returnMult — worlds.json; margin, reach — game.json threat.boss).

/**
 * Giants (docs/01-gdd.md 17.6; docs/01a-content.md 16.4): a giant walks its zone up and down at `speed`. The hero steps
 * into the zone — the giant turns to him in `turnSec` and walks at him. Within `reach` of each other the slap comes: the
 * hero running faster than speed × (1 + margin) slips past it (the giant follows him up at `speed` and never closes in),
 * slower — he is caught, rolls back to the start of the zone (the sim plays it), the giant walks back × `returnMult`.
 * Out of the zone uphill — the zone is passed; downhill — the giants go back to their patrol. Several zones on a
 * mountain and several giants in a zone are data only. `scale` — speeds of the rebirth tier (v of the scaled advice).
 */
import type { WorldBoss } from '../content/types.ts';

export type GiantMode = 'patrol' | 'turn' | 'chase' | 'back' | 'sit';

export interface GiantState {
  z: number;
  /** +1 up the slope, −1 down. */
  dir: number;
  mode: GiantMode;
  /** Seconds left of the turn. */
  t: number;
  speed: number;
}

export interface BossZoneState {
  zone: [number, number];
  giants: GiantState[];
  hero: 'out' | 'in' | 'passed';
}

export interface BossEvents {
  bossEnter: { tick: number; zone: number };
  bossPassed: { tick: number; zone: number };
  bossCaught: { tick: number; zone: number; x: number; y: number; z: number };
  /** A bot running the zone was slapped (docs/01-gdd.md 18.5): `bot` is its index; the bots roll it back. */
  bossBotCaught: { tick: number; zone: number; bot: number };
}

/** A bot running a giant's zone (docs/01-gdd.md 18.5): the giant goes at the nearest runner, bot or hero. */
export interface BossRunner {
  bot: number;
  z: number;
  speed: number;
}

export interface BossHero {
  x: number;
  y: number;
  z: number;
  /** Horizontal speed now. */
  speed: number;
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
  cfg: { margin: number; reach: number },
  scale: (zone: number) => number,
  passed: (zone: number) => boolean,
  emit: <K extends keyof BossEvents>(name: K, payload: BossEvents[K]) => void,
): Boss {
  const zones: BossZoneState[] = data.map((b, zi) => {
    const [a, c] = b.zone;
    const n = b.giants.length;
    return {
      zone: [a, c],
      hero: passed(zi) ? 'passed' : 'out',
      giants: b.giants.map((g, gi) => ({ z: a + ((gi + 1) * (c - a)) / (n + 1), dir: gi % 2 === 0 ? 1 : -1, mode: passed(zi) ? 'sit' : 'patrol', t: 0, speed: g.speed * scale(zi) })),
    };
  });
  const zoneOf = (z: number): number => zones.findIndex((s) => z >= s.zone[0] && z <= s.zone[1]);

  const walk = (g: GiantState, zone: [number, number], dz: number): void => {
    g.z = Math.min(zone[1], Math.max(zone[0], g.z + dz));
  };

  return {
    zones,
    zoneOf,
    step(dt, hero, free, tick, bots = []) {
      zones.forEach((s, zi) => {
        const [a, c] = s.zone;
        const data0 = data[zi]!;
        // Bots in this zone (docs/01-gdd.md 18.5): until the hero has passed it; one slapped this tick runs no more.
        const runners = s.hero === 'passed' ? [] : bots.filter((r) => r.z >= a && r.z <= c);
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
            emit('bossEnter', { tick, zone: zi });
            s.giants.forEach((g, gi) => {
              g.mode = 'turn';
              g.t = data0.giants[gi]!.turnSec;
            });
          } else if (free && hero.z > c && s.hero === 'in') {
            s.hero = 'passed';
            s.giants.forEach((g) => (g.mode = 'sit'));
            emit('bossPassed', { tick, zone: zi });
            return;
          } else if (!inside && s.hero === 'in') {
            s.hero = 'out';
            if (runners.length === 0) s.giants.forEach((g) => (g.mode = g.mode === 'sit' ? 'sit' : 'back'));
          }
        }
        // The nearest runner to a giant: the hero in the zone or a bot running it.
        const target = (g: GiantState): number => {
          let best = s.hero === 'in' ? hero.z : NaN;
          for (const r of runners) if (!slapped.has(r.bot) && !(Math.abs(r.z - g.z) >= Math.abs(best - g.z))) best = r.z;
          return best;
        };
        for (const g of s.giants) {
          switch (g.mode) {
            case 'sit':
              break;
            case 'patrol':
              walk(g, s.zone, g.dir * g.speed * dt);
              if (g.z >= c || g.z <= a) g.dir = g.z >= c ? -1 : 1;
              break;
            case 'back':
              // Back on patrol faster than the run; the hero stepping in again turns it at once.
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
              if (!slapped.has(r.bot) && Math.abs(r.z - g.z) <= cfg.reach && r.speed <= g.speed * (1 + cfg.margin)) {
                slapped.add(r.bot);
                emit('bossBotCaught', { tick, zone: zi, bot: r.bot });
              }
          // The slap: within reach of a giant that walks at him; only a run faster than speed × (1 + margin) slips past.
          if (s.hero === 'in' && g.mode === 'chase' && Math.abs(hero.z - g.z) <= cfg.reach && hero.speed <= g.speed * (1 + cfg.margin)) {
            s.hero = 'out';
            s.giants.forEach((o) => {
              o.mode = 'back';
              o.dir = 1;
            });
            emit('bossCaught', { tick, zone: zi, x: hero.x, y: hero.y, z: hero.z });
            return;
          }
        }
      });
    },
  };
}
