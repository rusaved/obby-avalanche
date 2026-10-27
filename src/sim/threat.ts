// What: The avalanche state machine: idle, warn, run, gone; front position, run-to-cave choice, the scripted first wave and the outcome for the hero.
// Called by: sim/world.ts, sim/bots.ts, main.ts, render/threat/avalanche.ts; tests/sim/threat.test.ts, tests/sim/bots.test.ts
// Keep: Phases advance only inside simulation steps (a pause freezes them); scripted first wave never catches; deterministic; numbers from worlds.json, balance, tuning.

/**
 * Threat `wave` — the avalanche (docs/01-gdd.md 4; docs/02-tech.md 8.1–8.2): phases idle → warn → run → gone → idle,
 * the front comes down from `spawnAhead` above the hero (`from: "aboveHero"`), numbers per mountain from worlds.json.
 * The first wave of a new player is scripted (docs/01-gdd.md 4.6): near cave `ftue.scriptedWaveWall`, never catches.
 * Phases advance only inside simulation steps, so any pause reason (the loop stops) freezes them.
 * Pure TS, deterministic, no DOM.
 */
import type { BalanceJson, TuningJson, WorldThreat } from '../content/types.ts';
import type { LevelData } from '../level/types.ts';
import { distToEntrance, firstShelter, inSafeZone, shelterIndex, shelterNow } from './shelter.ts';

/** K-01: a ridge grotto this close below the face of a ridge (or reaching past it) is the canopy of that ridge. */
const CANOPY_FACE = 3;

export type WavePhase = 'idle' | 'warn' | 'run' | 'gone';
/** How the current wave ended for the hero: in a cave, caught, in the camp or on the summit, or dusted (scripted miss). */
export type WaveOutcome = 'none' | 'survived' | 'caught' | 'safe' | 'dusted';

export interface ThreatOptions {
  /** Live object: the debug panel changes interval, warning and speed in place. */
  threat: WorldThreat;
  balance: Pick<BalanceJson, 'threat' | 'niche' | 'ftue'>;
  avalanche: TuningJson['avalanche'];
  /** The scripted first wave has not happened yet (`save.flags.firstWaveDone`). */
  scriptedPending: boolean;
  /** Normal waves the player has had in his life (newbie bonus counter, kept in the save). */
  normalWavesDone: number;
  /** First wave after this many seconds instead of `firstIntervalSec` (back after F5: balance.threat.resumeSec). */
  firstSec?: number | undefined;
}

export interface ThreatState {
  phase: WavePhase;
  /** Seconds left of idle, warn or gone. */
  timer: number;
  /** Length of the current warning (warnSec, + newbie bonus, or ftue.warnSec for the scripted wave). */
  warnSec: number;
  /** Where the front starts (crack and dust on warn) and where it is now. */
  spawnZ: number;
  frontZ: number;
  scripted: boolean;
  scriptedPending: boolean;
  outcome: WaveOutcome;
  /** Cave to run to: lit on warn and run, the HUD arrow points to it; −1 in the camp or on the summit. */
  shelter: number;
  /** Normal waves started in this load and in the player's life. */
  normalWaves: number;
  normalWavesDone: number;
  /** Game seconds since this mountain started (scripted-wave fallback). */
  playSec: number;
  /** Z-01: seconds since the last wave ended or the hero was rolled back (Infinity before either); no wave warns while it is
   * under threat.minGapSec. */
  quietSec: number;
}

export interface ThreatHero {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
}

export interface ThreatEvents {
  waveWarn: { tick: number; scripted: boolean; warnSec: number; spawnZ: number; shelter: number; normalWaves: number; normalWavesDone: number };
  waveStart: { tick: number; scripted: boolean; spawnZ: number };
  /** The front went over the hero in a cave (or running into one within graceMoving): «Phew, made it!». */
  waveSurvived: { tick: number; scripted: boolean; niche: number; grace: boolean };
  /** The front went over the hero outside any shelter: «Snowed in!» (docs/01-gdd.md 4.5). */
  waveCaught: { tick: number; x: number; y: number; z: number };
  /** Scripted wave over the hero outside a cave: snow up to the waist, no ball (docs/01-gdd.md 4.6). */
  waveDusted: { tick: number };
  waveGone: { tick: number };
  /** After gone: how this wave ended, for the funnel (docs/06 steps 9 and 15) and the save. */
  waveEnd: { tick: number; scripted: boolean; outcome: WaveOutcome; normalWaves: number };
}

export interface Threat {
  readonly state: ThreatState;
  /** One simulation tick. `gatesOpen` — gates of the level, a closed one cuts the way to caves above it. */
  step(dt: number, hero: ThreatHero, gatesOpen: readonly boolean[], tick: number): void;
  /** Starts the next wave now (debug «Avalanche now», __TEST__.triggerWave): from idle or gone only. */
  trigger(): void;
  /** RL-02 (docs/01-gdd.md 21.2): the hero rolled back to the flag — a warning or a running front melts, the pause starts
   * again from the full intervalSec; the scripted first wave goes on. */
  reset(tick: number): void;
}

/** Index of the cave nearest by run time (path along the track, through open gates only), −1 in a safe zone. */
export function nearestShelter(level: LevelData, gatesOpen: readonly boolean[], x: number, z: number, evenSafe = false): number {
  return sheltersByRunTime(level, gatesOpen, x, z, evenSafe)[0] ?? -1;
}

/** Caves reachable through open gates only, nearest by run time first; empty in a safe zone (bots fill caves in this order)
 * but with `evenSafe` (D-06: the wave at a closed ridge lights the grotto of its finish). */
export function sheltersByRunTime(level: LevelData, gatesOpen: readonly boolean[], x: number, z: number, evenSafe = false): number[] {
  if (!evenSafe && inSafeZone(level, z)) return [];
  const found: Array<{ i: number; d: number }> = [];
  level.niches.forEach((n, i) => {
    // A ledge is no place to run to on the warning: it is a shelter only for the one already on top (17.5).
    if (n.kind === 'ledge') return;
    const lo = Math.min(z, n.z);
    const hi = Math.max(z, n.z);
    if (level.gates.some((g, gi) => !gatesOpen[gi] && g.z > lo && g.z < hi)) return;
    found.push({ i, d: distToEntrance(level, n, x, z).dist });
  });
  // Stable order on ties: the lower index first, as the single-pass search did.
  return found.sort((a, b) => a.d - b.d || a.i - b.i).map((f) => f.i);
}

export function createThreat(level: LevelData, opts: ThreatOptions, emit: <K extends keyof ThreatEvents>(name: K, payload: ThreatEvents[K]) => void): Threat {
  const { threat, balance, avalanche } = opts;
  const campTop = threat.safeZoneZ[1];
  const lastGateZ = level.gates.reduce((m, g) => Math.max(m, g.z), campTop + avalanche.spawnMinFromCamp);
  // Open slope (docs/01-gdd.md 17.5): the front never starts above the line of the giant's zone; above it the hero is safe.
  const spawnMax = threat.spawnMaxZ ?? Infinity;
  // Stages pace (docs/01-gdd.md 22.5): waves only inside the avalanche stages; the front melts at the bottom of its stage.
  const zones = threat.zones;
  const zoneOf = (z: number): readonly [number, number, number?] | null => zones?.find(([a, b]) => z >= a && z < b) ?? null;
  let zoneLo = -Infinity;
  let wasInZone = false;
  // The scripted wave comes at the first shelter of stretch `scriptedWaveWall` (the cave of that stretch in classic and
  // fast; the first grotto of section 2 on the open slope, 17.8).
  const scriptedCave = level.niches[firstShelter(level, balance.ftue.scriptedWaveWall)] ?? null;
  // At a fork that first row has a grotto on each lane: the scripted wave lights the one nearer by run time and follows
  // the hero to the other lane (playtest PS: the arrow pointed at the grotto behind the cliff). One cave elsewhere.
  const scriptedRow = level.niches.flatMap((n, i) => (scriptedCave && n.stretch === scriptedCave.stretch && n.z === scriptedCave.z && n.kind !== 'ledge' ? [i] : []));
  const scriptedShelter = (hero: ThreatHero): number => {
    let best = scriptedRow[0] ?? -1;
    let bestD = Infinity;
    for (const i of scriptedRow) {
      const d = distToEntrance(level, level.niches[i]!, hero.x, hero.z).dist;
      if (d < bestD - 1e-9) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  const state: ThreatState = {
    phase: 'idle',
    timer: opts.firstSec ?? threat.firstIntervalSec,
    warnSec: 0,
    spawnZ: 0,
    frontZ: 0,
    scripted: false,
    scriptedPending: opts.scriptedPending && threat.firstWaveScripted,
    outcome: 'none',
    shelter: -1,
    normalWaves: 0,
    normalWavesDone: opts.normalWavesDone,
    playSec: 0,
    quietSec: Infinity,
  };
  let forced = false;
  // Z-01 (Q-G-2 «A»): the least pause between the end of one wave (any: scripted, of a stage) and the next warning.
  const quiet = (): boolean => forced || state.quietSec >= (threat.minGapSec ?? 0);
  // Z-01: the first wave comes only where a shelter is in reach — in the camp (safe, the lesson of G-01), or with a cave
  // reachable through open gates and not standing at a closed gate with the cave behind farther than that gate (playtest G:
  // «Avalanche in 5…1» with no arrow at the closed wall of a level, then nothing).
  // Stages pace only (its zones): the other paces have the cave of the lesson right under the wall.
  /** K-01 (review D20: 0 waves in 243 s 3 units under the wall «8»): the canopy of the closed ridge just above the hero (a
   * ridge grotto that reaches its face, the finish grotto of D-01) with its mouth within threat.canopyReach; −1 — none. */
  const ownCanopy = (hero: ThreatHero, gatesOpen: readonly boolean[]): number => {
    const reach = threat.canopyReach;
    if (reach === undefined) return -1;
    let gate = -1;
    level.gates.forEach((g, i) => {
      if (g.z > hero.z && (gate < 0 || g.z < level.gates[gate]!.z)) gate = i;
    });
    const wall = level.gates[gate];
    if (!wall || gatesOpen[gate]) return -1;
    let best = -1;
    let bestD = Infinity;
    level.niches.forEach((n, i) => {
      if (!(n.canopy || n.kind === 'ridgeGrotto') || n.box.max[2] < wall.z - CANOPY_FACE || n.box.min[2] > wall.z) return;
      const d = distToEntrance(level, n, hero.x, hero.z).dist;
      if (d <= reach && d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };
  /** K-01: the shelter of a wave at a closed ridge and of the first wave past its lesson row — the one the hero stands in,
   * the canopy of his ridge, the nearest ahead (not one far behind), else the nearest. */
  const shelterAhead = (hero: ThreatHero, gatesOpen: readonly boolean[]): number => {
    const inside = shelterIndex(level, balance.niche.graceDist, hero.x, hero.y, hero.z);
    if (inside >= 0 && level.niches[inside]!.kind !== 'ledge') return inside;
    const canopy = ownCanopy(hero, gatesOpen);
    if (canopy >= 0) return canopy;
    const list = sheltersByRunTime(level, gatesOpen, hero.x, hero.z, true);
    return list.find((i) => level.niches[i]!.box.max[2] >= hero.z) ?? list[0] ?? -1;
  };
  const coverInReach = (hero: ThreatHero, gatesOpen: readonly boolean[], evenSafe = false): boolean => {
    if (!zones || hero.z < campTop) return true;
    const near = nearestShelter(level, gatesOpen, hero.x, hero.z, evenSafe);
    if (near < 0) return false;
    let gate = -1;
    level.gates.forEach((g, i) => {
      if (g.z > hero.z && (gate < 0 || g.z < level.gates[gate]!.z)) gate = i;
    });
    const wall = level.gates[gate];
    if (!wall || gatesOpen[gate]) return true;
    if (level.niches.some((n) => n.kind !== 'ledge' && n.z >= hero.z && n.z < wall.z)) return true;
    if (ownCanopy(hero, gatesOpen) >= 0) return true;
    return distToEntrance(level, level.niches[near]!, hero.x, hero.z).dist <= wall.z - hero.z;
  };

  /** D-06: this wave came at a closed ridge out of the zones (idleMaxSec): its shelter may be the grotto of a safe finish. */
  let idleWave = false;
  /** D-06: game seconds since the last wave ended (a roll-back does not reset it, unlike quietSec). */
  let sinceWave = 0;
  const startWarn = (hero: ThreatHero, gatesOpen: readonly boolean[], tick: number, idle = false): void => {
    idleWave = idle;
    state.phase = 'warn';
    state.outcome = 'none';
    state.scripted = state.scriptedPending && !(zones && zoneOf(hero.z));
    if (state.scripted) {
      // docs/01-gdd.md 4.6: at cave 4 when the hero walks in; on the fallback (or a forced start) — the nearest cave.
      const nearZone = scriptedCave !== null && hero.z >= scriptedCave.z - balance.ftue.triggerDist;
      // K-01: past the lesson row (by a ridge above it) — where he stands or ahead, not back down to that row.
      const pastRow = scriptedCave !== null && hero.z > scriptedCave.box.max[2] + balance.ftue.triggerDist;
      const near = pastRow || zones !== undefined ? shelterAhead(hero, gatesOpen) : nearestShelter(level, gatesOpen, hero.x, hero.z, idleWave);
      const idx = nearZone && scriptedCave && !pastRow ? scriptedShelter(hero) : near;
      const cave = level.niches[idx] ?? scriptedCave;
      state.shelter = idx;
      state.warnSec = balance.ftue.warnSec;
      state.spawnZ = (cave?.z ?? hero.z) + balance.ftue.spawnAhead;
    } else {
      const newbie = balance.threat.newbieWaves;
      const inZone = zones ? zoneOf(hero.z) : null;
      state.warnSec = inZone && threat.zoneWarnSec ? threat.zoneWarnSec : threat.warnSec + (state.normalWavesDone < newbie.count ? newbie.warnBonusSec : 0);
      const zone = zones ? zoneOf(hero.z) : null;
      zoneLo = zone ? zone[0] : -Infinity;
      // The wave of a stage comes from its top: no running past it (LV-12 review: from the hero + spawnAhead he ran past).
      state.spawnZ = zone ? zone[1] : Math.min(lastGateZ, spawnMax, Math.max(campTop + avalanche.spawnMinFromCamp, hero.z + threat.spawnAhead));
      state.normalWaves++;
      state.normalWavesDone++;
      state.shelter = idleWave ? shelterAhead(hero, gatesOpen) : nearestShelter(level, gatesOpen, hero.x, hero.z, idleWave);
    }
    state.timer = state.warnSec;
    state.frontZ = state.spawnZ;
    emit('waveWarn', {
      tick,
      scripted: state.scripted,
      warnSec: state.warnSec,
      spawnZ: state.spawnZ,
      shelter: state.shelter,
      normalWaves: state.normalWaves,
      normalWavesDone: state.normalWavesDone,
    });
  };

  /** The front reached the hero: decide survived / caught / safe (docs/01-gdd.md 4.3–4.5). */
  const resolve = (hero: ThreatHero, tick: number): void => {
    // MU round 5: the one check of «in a cave» (shelterNow) — the same the roll-back of a fall asks (sim/world.ts).
    // Running into a cave and closer than graceMoving to its entrance: made it (docs/02-tech.md 8.2).
    const inside = shelterNow(level, balance.niche, hero);
    // D-06: on the stages a cave of a safe finish counts as made it too (the wave at a closed ridge, «Phew!»).
    if ((inSafeZone(level, hero.z) && !(zones && inside >= 0)) || hero.z >= spawnMax) {
      state.outcome = 'safe';
      return;
    }
    if (inside >= 0) {
      state.outcome = 'survived';
      emit('waveSurvived', { tick, scripted: state.scripted, niche: inside, grace: shelterIndex(level, balance.niche.graceDist, hero.x, hero.y, hero.z) < 0 });
      return;
    }
    if (state.scripted) {
      state.outcome = 'dusted';
      emit('waveDusted', { tick });
      return;
    }
    state.outcome = 'caught';
    emit('waveCaught', { tick, x: hero.x, y: hero.y, z: hero.z });
  };

  return {
    state,
    trigger() {
      if (state.phase === 'idle' || state.phase === 'gone') {
        state.phase = 'idle';
        state.timer = 0;
        forced = true;
      }
    },
    reset(tick) {
      if (state.scripted && (state.phase === 'warn' || state.phase === 'run')) return;
      // Z-01: a roll-back starts the least pause anew — but before any wave: the first lesson keeps its own clock (G-01).
      if (!(state.scriptedPending && state.quietSec === Infinity)) state.quietSec = 0;
      if (state.phase === 'warn' || state.phase === 'run') {
        sinceWave = 0;
        state.phase = 'gone';
        state.timer = avalanche.fadeSec;
        state.shelter = -1;
        emit('waveGone', { tick });
        emit('waveEnd', { tick, scripted: false, outcome: state.outcome, normalWaves: state.normalWaves });
      } else if (state.phase === 'idle') state.timer = threat.intervalSec;
    },
    step(dt, hero, gatesOpen, tick) {
      state.playSec += dt;
      if (state.phase === 'idle' || state.phase === 'gone') {
        state.quietSec += dt;
        sinceWave += dt;
      }
      switch (state.phase) {
        case 'idle': {
          // Stages pace (docs/01-gdd.md 22.5): an avalanche stage has its waves whether the scripted one came or not.
          const inZone = zones ? zoneOf(hero.z) !== null : false;
          // G-01: never inside a giant's zone — one trial at a time; the wave waits till he is out of it.
          const inGiant = level.bosses.some((b) => hero.z >= b.zone[0] && hero.z <= b.zone[1]);
          // D-06: nor in a stage built without a wave (the maze, the balls: SD-09, MT-02).
          const noWave = level.stages?.some((st) => (st.type === 'maze' || st.type === 'ball') && hero.z >= st.start && hero.z <= st.end) ?? false;
          if (state.scriptedPending && !forced && !inZone) {
            if (inGiant || noWave) return;
            const zoneReached = scriptedCave !== null && hero.z >= scriptedCave.z - balance.ftue.triggerDist && !inSafeZone(level, hero.z);
            // D-06: at a closed ridge the cave of its safe finish counts as in reach (review D20: none came at ridge 1).
            if ((zoneReached || state.playSec >= balance.ftue.fallbackSec) && quiet() && coverInReach(hero, gatesOpen, true)) startWarn(hero, gatesOpen, tick, true);
            return;
          }
          // D-06: not longer than idleMaxSec without a wave anywhere but a giant's zone (review D20: the falls on the
          // plates restarted the delay of their stage every time), where a shelter is in reach.
          if (zones && !forced && threat.idleMaxSec !== undefined && Math.min(sinceWave, state.playSec) >= threat.idleMaxSec - dt / 2 && quiet() && !inGiant && !noWave && hero.z >= campTop && coverInReach(hero, gatesOpen, true)) {
            startWarn(hero, gatesOpen, tick, true);
            return;
          }
          // Out of every avalanche stage the pause holds at its first delay: entering one starts it (22.5), however the
          // hero got in (a run, a roll-back, a teleport).
          if (zones && !forced && !inZone) {
            state.timer = threat.zoneFirstSec ?? threat.firstIntervalSec;
            wasInZone = false;
            return;
          }
          // SD-06 (docs/01-gdd.md 23.6): a zone of its own first delay (the stages but the avalanche's) — that one on entering.
          const own = zones ? zoneOf(hero.z)?.[2] : undefined;
          if (zones && inZone && !wasInZone) state.timer = own ?? Math.min(state.timer, threat.zoneFirstSec ?? state.timer);
          wasInZone = inZone;
          state.timer -= dt;
          if (state.timer <= 0 && quiet()) {
            forced = false;
            startWarn(hero, gatesOpen, tick);
          }
          return;
        }
        case 'warn': {
          if (!state.scripted) state.shelter = idleWave ? shelterAhead(hero, gatesOpen) : nearestShelter(level, gatesOpen, hero.x, hero.z, idleWave);
          else if (scriptedRow.includes(state.shelter)) state.shelter = scriptedShelter(hero);
          state.timer -= dt;
          if (state.timer <= 0) {
            state.phase = 'run';
            state.frontZ = state.spawnZ;
            // Up past the point it starts from during the warning: it rolls down behind him, he is safe (producer's
            // playtest PS: through a wall opened on the warning and on — and still snowed in when the front began).
            if (hero.z > state.spawnZ) {
              state.outcome = 'safe';
              state.shelter = -1;
            }
            emit('waveStart', { tick, scripted: state.scripted, spawnZ: state.spawnZ });
          }
          return;
        }
        case 'run': {
          if (!state.scripted && state.outcome === 'none') state.shelter = idleWave ? shelterAhead(hero, gatesOpen) : nearestShelter(level, gatesOpen, hero.x, hero.z);
          else if (state.outcome === 'none' && scriptedRow.includes(state.shelter)) state.shelter = scriptedShelter(hero);
          state.frontZ -= threat.speed * dt;
          if (state.outcome === 'none' && state.frontZ <= hero.z) resolve(hero, tick);
          if (state.frontZ <= Math.max(campTop, state.scripted ? -Infinity : zoneLo)) {
            // A scripted wave the front never reached (the hero ran above it) still ends the lesson.
            if (state.scripted && state.outcome === 'none') resolve(hero, tick);
            // The front melts at the camp: a hero waiting there was never reached, he is safe.
            if (state.outcome === 'none' && inSafeZone(level, hero.z)) state.outcome = 'safe';
            state.phase = 'gone';
            state.timer = avalanche.fadeSec;
            state.quietSec = 0;
            sinceWave = 0;
            emit('waveGone', { tick });
            emit('waveEnd', { tick, scripted: state.scripted, outcome: state.outcome, normalWaves: state.normalWaves });
            if (state.scripted) state.scriptedPending = false;
          }
          return;
        }
        case 'gone': {
          state.timer -= dt;
          if (state.timer <= 0) {
            state.phase = 'idle';
            state.shelter = -1;
            // The pause counts from the start of gone (docs/01-gdd.md 4.1).
            state.timer = Math.max(0, threat.intervalSec - avalanche.fadeSec);
          }
          return;
        }
      }
    },
  };
}
