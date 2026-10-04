/**
 * Economic model of mountain 1 on tier 0 (docs/01-gdd.md 8.5): a line-by-line port of `cycle()` of
 * docs/references/balance-model.pl for the first mountain, numbers from the content pack instead of the constants
 * of the reference. Event-based, no physics: path = distance / run speed of the stat, steps = path / stepLength,
 * plus gifts, treadmills, the avalanche cycle and shoe purchases. Profiles: «greedy» (as the reference) and
 * «goldSeeker» (greedy + every golden gift from the `fromWave`-th normal wave, docs/01-gdd.md 4.9 and 8.5).
 * Not in it yet (the full port, M2-11 and M3): eggs, trails, auras, mountains 2–5, tiers 1–9, the lazy profile.
 */
import type { BalanceJson, GameJson, PetsJson, Segment, TuningJson, World } from '../src/content/types.ts';
import { moveSpeed } from '../src/sim/effects/moveSpeed.ts';

export type Profile = 'greedy' | 'goldSeeker';

export interface ModelPack {
  game: GameJson;
  balance: BalanceJson;
  tuning: TuningJson;
  pets: PetsJson;
  world: World;
}

export interface WallRow {
  wall: number;
  /** Second of the mountain the wall was passed, the stat then, shoe level, coins left. */
  sec: number;
  stat: number;
  shoe: number;
  coins: number;
}

export interface MountainRun {
  /** Seconds from the camp to the portal. */
  sec: number;
  walls: WallRow[];
  normalWaves: number;
  goldTaken: number;
  coins: number;
}

/** Model step, seconds (the reference: $dt = 0.25). */
const DT = 0.25;
/** A zone gift takes 2 s to fetch; a wall run takes at least 0.5 s; the hero ends 5 units past the wall. */
const GIFT_SEC = 2;
const MIN_RUN_SEC = 0.5;
const PAST_WALL = 5;
/** From the last wall to the portal (the reference: 40 / vel). */
const TO_PORTAL = 40;
/** Golden gift: the average of distMin–distMax there and back (docs/01-gdd.md 8.5: +2 × 35 units). */
const GOLD_AVG = 35;
const LIMIT_SEC = 4 * 3600;

const num = (s: Segment, k: string): number => (typeof s[k] === 'number' ? (s[k] as number) : 0);

export function runMountain1(pack: ModelPack, profile: Profile): MountainRun {
  const { balance, tuning, world } = pack;
  const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
  const vel = (s: number): number => moveSpeed(s, curve);
  const stepLen = balance.stepLength;
  const shoes = balance.upgrade.tiers;
  const th = world.threat;
  const campTop = th.safeZoneZ[1];
  const gates = world.segments.filter((s) => s.type === 'gate').sort((a, b) => a.z - b.z);
  const niches = world.segments.filter((s) => s.type === 'niche');
  const zoneGift = (k: number): number => world.zones.find((z) => z.k === k)?.gift ?? 0;
  const zEnd = (gates[gates.length - 1]?.z ?? world.length) + TO_PORTAL;
  const bonus = profile === 'goldSeeker' ? (pack.game.threat.bonus ?? null) : null;
  const freePet = pack.pets.pets.find((p) => p.id === balance.ftue.freeEggPet)?.bonus ?? 0;
  const scriptedWall = balance.ftue.scriptedWaveWall;

  let S = 0;
  let C = 0;
  let shoe = 0;
  let T = 0;
  let petSum = 0;
  let z = world.spawnZ;
  let phase: 'idle' | 'warn' | 'run' = 'idle';
  let phT = th.intervalSec;
  let front = 0;
  let giftsLeft = balance.gifts.perZone;
  let normalWaves = 0;
  let goldTaken = 0;
  let carrying = false;
  const scripted = th.firstWaveScripted;
  const walls: WallRow[] = [];

  const walkTo = (to: number, v: number, g: number): void => {
    if (z >= to) return;
    const d = to - z;
    T += d / v;
    S += (d / stepLen) * g;
    phT -= d / v;
    z = to;
  };

  for (let i = 1; i <= gates.length; i++) {
    const gate = gates[i - 1]!;
    const gz = gate.z;
    const cave = niches.find((n) => num(n, 'stretch') === i);
    const shelter = cave ? cave.z : gz;
    const tread = (cave ? num(cave, 'treadmill') : 1) * (world.treadmillMult ?? 1);
    const gift = zoneGift(num(gate, 'zone'));
    const req = num(gate, 'requires');
    const reward = ((gate['reward'] as { coins?: number } | undefined)?.coins ?? 0);
    if (scripted && i === scriptedWall) {
      phase = 'warn';
      phT = balance.ftue.warnSec;
    }
    if (scripted && i < scriptedWall) {
      phase = 'idle';
      phT = 999;
    }
    for (;;) {
      const g = (shoes[shoe]?.mult ?? 1) * (1 + petSum);
      const v = vel(S);
      phT -= DT;
      if (phase === 'idle' && phT <= 0) {
        phase = 'warn';
        phT = th.warnSec;
        normalWaves++;
        // Golden gift (docs/01-gdd.md 8.5): there and back during the warning, steps on the way.
        if (bonus && normalWaves >= bonus.fromWave) {
          const d = 2 * GOLD_AVG;
          T += d / v;
          S += (d / stepLen) * g;
          phT -= d / v;
          carrying = true;
        }
      } else if (phase === 'warn' && phT <= 0) {
        phase = 'run';
        front = Math.min(z + th.spawnAhead, zEnd);
      }
      const hiding = phase === 'warn' || (phase === 'run' && front > z);
      if (phase === 'run') {
        front -= th.speed * DT;
        if (front <= campTop) {
          phase = 'idle';
          phT = th.intervalSec;
          giftsLeft = balance.gifts.perZone;
          C += balance.coins.waveSurvived * gift;
          if (carrying && bonus) {
            C += bonus.mult * gift;
            goldTaken++;
          }
          carrying = false;
        }
      }
      const ready = S >= req;
      if (hiding) {
        walkTo(shelter, v, g);
        S += (v / stepLen) * g * tread * DT;
        z = shelter;
      } else if (ready) {
        const dist = gz - z;
        S += (dist / stepLen) * g;
        T += Math.max(MIN_RUN_SEC, dist / v);
        z = gz + PAST_WALL;
        C += reward;
        break;
      } else if (giftsLeft > 0 && !(scripted && i < scriptedWall && T < 3)) {
        S += ((v * GIFT_SEC) / stepLen) * g;
        T += GIFT_SEC;
        giftsLeft--;
        C += gift;
        phT -= GIFT_SEC - DT;
        walkTo(shelter, v, g);
        continue;
      } else {
        walkTo(shelter, v, g);
        S += (v / stepLen) * g * tread * DT;
        z = shelter;
      }
      T += DT;
      while (shoe < shoes.length - 1 && C >= shoes[shoe + 1]!.price) {
        C -= shoes[shoe + 1]!.price;
        shoe++;
      }
      if (T > LIMIT_SEC) return { sec: Infinity, walls, normalWaves, goldTaken, coins: C };
    }
    // The free egg of the first minute hatches after wall 3 of the reference (docs/01-gdd.md 6.2).
    if (scripted && i === scriptedWall - 1) petSum += freePet;
    walls.push({ wall: i, sec: T, stat: S, shoe, coins: C });
  }
  T += TO_PORTAL / vel(S);
  return { sec: T, walls, normalWaves, goldTaken, coins: C };
}
