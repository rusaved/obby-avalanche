/**
 * Threat `wave` — the avalanche (docs/01-gdd.md 4; docs/02-tech.md 8.1–8.2): phases idle → warn → run → gone → idle,
 * the front comes down from `spawnAhead` above the hero (`from: "aboveHero"`), numbers per mountain from worlds.json.
 * The first wave of a new player is scripted (docs/01-gdd.md 4.6): near cave `ftue.scriptedWaveWall`, never catches.
 * Phases advance only inside simulation steps, so any pause reason (the loop stops) freezes them.
 * Pure TS, deterministic, no DOM.
 */
import type { BalanceJson, TuningJson, WorldThreat } from '../content/types.ts';
import type { LevelData } from '../level/types.ts';
import { distToEntrance, inSafeZone, shelterIndex } from './shelter.ts';

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
}

/** Index of the cave nearest by run time (path along the track, through open gates only), −1 in a safe zone. */
export function nearestShelter(level: LevelData, gatesOpen: readonly boolean[], x: number, z: number): number {
  if (inSafeZone(level, z)) return -1;
  let best = -1;
  let bestDist = Infinity;
  level.niches.forEach((n, i) => {
    const lo = Math.min(z, n.z);
    const hi = Math.max(z, n.z);
    if (level.gates.some((g, gi) => !gatesOpen[gi] && g.z > lo && g.z < hi)) return;
    const d = distToEntrance(level, n, x, z).dist;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

export function createThreat(level: LevelData, opts: ThreatOptions, emit: <K extends keyof ThreatEvents>(name: K, payload: ThreatEvents[K]) => void): Threat {
  const { threat, balance, avalanche } = opts;
  const campTop = threat.safeZoneZ[1];
  const lastGateZ = level.gates.reduce((m, g) => Math.max(m, g.z), campTop + avalanche.spawnMinFromCamp);
  const scriptedCave = level.niches[balance.ftue.scriptedWaveWall - 1] ?? null;
  const state: ThreatState = {
    phase: 'idle',
    timer: threat.firstIntervalSec,
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
  };
  let forced = false;

  const startWarn = (hero: ThreatHero, gatesOpen: readonly boolean[], tick: number): void => {
    state.phase = 'warn';
    state.outcome = 'none';
    state.scripted = state.scriptedPending;
    if (state.scripted) {
      // docs/01-gdd.md 4.6: at cave 4 when the hero walks in; on the fallback (or a forced start) — the nearest cave.
      const nearZone = scriptedCave !== null && hero.z >= scriptedCave.z - balance.ftue.triggerDist;
      const near = nearestShelter(level, gatesOpen, hero.x, hero.z);
      const idx = nearZone && scriptedCave ? level.niches.indexOf(scriptedCave) : near;
      const cave = level.niches[idx] ?? scriptedCave;
      state.shelter = idx;
      state.warnSec = balance.ftue.warnSec;
      state.spawnZ = (cave?.z ?? hero.z) + balance.ftue.spawnAhead;
    } else {
      const newbie = balance.threat.newbieWaves;
      state.warnSec = threat.warnSec + (state.normalWavesDone < newbie.count ? newbie.warnBonusSec : 0);
      state.spawnZ = Math.min(lastGateZ, Math.max(campTop + avalanche.spawnMinFromCamp, hero.z + threat.spawnAhead));
      state.normalWaves++;
      state.normalWavesDone++;
      state.shelter = nearestShelter(level, gatesOpen, hero.x, hero.z);
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
    if (inSafeZone(level, hero.z)) {
      state.outcome = 'safe';
      return;
    }
    const inside = shelterIndex(level, balance.niche.graceDist, hero.x, hero.y, hero.z);
    if (inside >= 0) {
      state.outcome = 'survived';
      emit('waveSurvived', { tick, scripted: state.scripted, niche: inside, grace: false });
      return;
    }
    // Running into a cave and closer than graceMoving to its entrance: made it (docs/02-tech.md 8.2).
    for (let i = 0; i < level.niches.length; i++) {
      const n = level.niches[i]!;
      const e = distToEntrance(level, n, hero.x, hero.z);
      const towards = hero.vx * (e.tx - hero.x) + hero.vz * (e.tz - hero.z) > 0;
      if (e.dist < balance.niche.graceMoving && towards && Math.hypot(hero.vx, hero.vz) > 1) {
        state.outcome = 'survived';
        emit('waveSurvived', { tick, scripted: state.scripted, niche: i, grace: true });
        return;
      }
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
    step(dt, hero, gatesOpen, tick) {
      state.playSec += dt;
      switch (state.phase) {
        case 'idle': {
          if (state.scriptedPending && !forced) {
            const zoneReached = scriptedCave !== null && hero.z >= scriptedCave.z - balance.ftue.triggerDist && !inSafeZone(level, hero.z);
            if (zoneReached || state.playSec >= balance.ftue.fallbackSec) startWarn(hero, gatesOpen, tick);
            return;
          }
          state.timer -= dt;
          if (state.timer <= 0) {
            forced = false;
            startWarn(hero, gatesOpen, tick);
          }
          return;
        }
        case 'warn': {
          if (!state.scripted) state.shelter = nearestShelter(level, gatesOpen, hero.x, hero.z);
          state.timer -= dt;
          if (state.timer <= 0) {
            state.phase = 'run';
            state.frontZ = state.spawnZ;
            emit('waveStart', { tick, scripted: state.scripted, spawnZ: state.spawnZ });
          }
          return;
        }
        case 'run': {
          if (!state.scripted && state.outcome === 'none') state.shelter = nearestShelter(level, gatesOpen, hero.x, hero.z);
          state.frontZ -= threat.speed * dt;
          if (state.outcome === 'none' && state.frontZ <= hero.z) resolve(hero, tick);
          if (state.frontZ <= campTop) {
            // A scripted wave the front never reached (the hero ran above it) still ends the lesson.
            if (state.scripted && state.outcome === 'none') resolve(hero, tick);
            // The front melts at the camp: a hero waiting there was never reached, he is safe.
            if (state.outcome === 'none' && inSafeZone(level, hero.z)) state.outcome = 'safe';
            state.phase = 'gone';
            state.timer = avalanche.fadeSec;
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
