/**
 * Economic model of the game (docs/01-gdd.md 8.5): a line-by-line port of `cycle()` of
 * docs/references/balance-model.pl, numbers from the content pack instead of the constants of the reference.
 * Event-based, no physics: path = distance / run speed of the stat, steps = path / stepLength, plus gifts,
 * treadmills, the avalanche cycle, shoe and egg purchases. One call = one cycle of a tier (mountains 1…N).
 * Same generator as the reference (LCG 1103515245 / 12345 mod 2^31, seed 12345) for the egg rolls.
 *
 * Profiles (docs/01-gdd.md 8.5):
 * - greedy — the reference bot;
 * - goldSeeker — greedy + every golden gift from the `fromWave`-th normal wave (4.9);
 * - lazy — reacts 1.5 s later (to the warning and to an open wall), ignores 30% of the waves, does not take gifts on
 *   ledges; only this profile can be caught: the front sweeps it outside a cave or it runs into the front, then the
 *   snowball rolls `caught.maxSec` to the cave below and nothing is lost (4.5).
 * Trails and auras (M3-04): at the end of every cycle the bot spends trophies like `spendTrophies` of the reference —
 * the next trail when it can pay and it is not dearer than the next aura, otherwise the next aura; both go into
 * the step through stepGain. The first wave of a mountain comes after its firstIntervalSec, as in the game (Q-022);
 * the reference starts every mountain with intervalSec.
 * - activeDay — greedy + the calendar, 3 quests and the time rewards of one game day every `ACTIVE_DAY_SEC` of play;
 * - eggSpammer — the best open egg whenever it can pay, shoes second (the reference with SPAM=1).
 * `reference: true` runs the assumptions of balance-model.pl instead of the game ones: the first wave of a mountain after
 * intervalSec and the unrounded treadmill curve of the reference (the data keep the rounded one, docs/01a-content.md 3).
 * With it the port repeats the reference wall by wall (column «Бот модели» of docs/01a-content.md 3).
 * `fit` — the inverse run of the reference for `sim:balance --fit`: a wall without a number opens at its target second and
 * gets the stat of the bot × `FIT_SHARE`, rounded to the «nice» row (docs/01-gdd.md 8.5).
 */
import type { AurasJson, BalanceJson, EggsJson, GameJson, PetsJson, Reward, Segment, TrailsJson, TuningJson, World } from '../src/content/types.ts';
import { moveSpeed } from '../src/sim/effects/moveSpeed.ts';
import { scaled, stepGain } from '../src/sim/economy.ts';

export type Profile = 'greedy' | 'goldSeeker' | 'lazy' | 'activeDay' | 'eggSpammer';

export interface ModelPack {
  game: GameJson;
  balance: BalanceJson;
  tuning: TuningJson;
  pets: PetsJson;
  eggs: EggsJson;
  /** Trails and auras for trophies (M3-04); absent — the bot has none (×1). */
  trails?: TrailsJson;
  auras?: AurasJson;
  worlds: World[];
}

/** What stays between cycles (the reference: %meta): pet bonuses, trophies, how many trails and auras are bought. */
export interface ModelMeta {
  pets: number[];
  trophies: number;
  /** Bought from the cheapest up: 0 — none, k — the k-th by price is on (the reference: $meta{trail}, $meta{aura}). */
  trail: number;
  aura: number;
}

export interface WallRow {
  mountain: number;
  wall: number;
  /** Through number of the wall, 1…60. */
  p: number;
  /** Second of the mountain the wall was passed, and of the cycle. */
  sec: number;
  total: number;
  /** Seconds since the previous wall (or the camp). */
  took: number;
  stat: number;
  shoe: number;
  petMult: number;
  coins: number;
}

export interface CycleRun {
  /** Seconds of the whole cycle, per mountain, Infinity if the 4-hour limit hit (a dead end). */
  sec: number;
  mountains: number[];
  walls: WallRow[];
  /** Cycle seconds of every shoe purchase. */
  shoeBuys: number[];
  eggsBought: number;
  normalWaves: number;
  /** Normal waves the bot took notice of / ignored (lazy) / was caught by. */
  ignoredWaves: number;
  caught: number;
  /** Waves with more than one catch (the game rules out a second one, docs/01-gdd.md 4.5). */
  doubleCaught: number;
  goldTaken: number;
  coins: number;
  meta: ModelMeta;
  /** Trophies got in this cycle (summits and rewards), for «кубки за всё время» (docs/01-gdd.md 8.5, check 10). */
  trophiesGot: number;
  /** State of the egg generator after the cycle: the next tier goes on with it, as the reference does. */
  seedOut: number;
  /** Fit mode: requirements of tier 0 by through number (index p − 1). */
  fitted: number[];
}

export interface CycleOpts {
  profile: Profile;
  tier?: number;
  /** Mountains to run, from 1 (default: all of worlds.json). */
  mountains?: number;
  /** State of the egg generator (default: the seed of the reference). */
  seed?: number;
  meta?: ModelMeta;
  /** The assumptions of balance-model.pl instead of the game ones (see the header). */
  reference?: boolean;
  /** Inverse run (sim:balance --fit): walls after `keep` get their number at `targetSec[p − 1]` (second of the mountain). */
  fit?: { keep: number; targetSec: number[] };
  /** `wallScale[n]` to try instead of the table (the bisection of sim:balance --fit). */
  wallScale?: number;
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
/** The scripted wave never lets the clock run before wall 3 of the reference; gifts wait 3 s at the start. */
const SCRIPTED_IDLE = 999;
const SCRIPTED_GIFT_WAIT = 3;
/** Eggs: the bot buys one while the next shoes cost 4+ times more; before rebirth up to 10 of each (the reference). */
const EGG_VS_SHOES = 4;
const EGG_BATCH = 200;
const EGGS_BEFORE_REBIRTH = 10;
/** Lazy profile (docs/01-gdd.md 8.5). */
const LAZY_REACT_SEC = 1.5;
const LAZY_IGNORE = 0.3;
const SEED = 12345;
const LAZY_SEED = 54321;
/** Active day (docs/01-gdd.md 8.5): one game day per 35 minutes of play; quests are done at 10 / 20 / 30 min of it. */
export const ACTIVE_DAY_SEC = 35 * 60;
const QUEST_AT_MIN = [10, 20, 30];
/** The reference: the treadmill before wall p is max(2 × 1.13^(p−1), 5 × 1.1^(p−1)), unrounded (reference mode only). */
const refTread = (p: number): number => Math.max(2 * 1.13 ** (p - 1), 5 * 1.1 ** (p - 1));
/** Fit (docs/01-gdd.md 8.5): wall = stat of the bot at the target second × 0.97, the «nice» row 1 … 8 × 10^k. */
export const FIT_SHARE = 0.97;
const NICE = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

const num = (s: Segment, k: string): number => (typeof s[k] === 'number' ? (s[k] as number) : 0);

/** The generator of the reference: seed = (seed × 1103515245 + 12345) mod 2^31, value = seed / 2^31. */
export function lcg(seed: number): (() => number) & { state: () => number } {
  let s = seed;
  const next = (): number => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 2147483648;
  };
  return Object.assign(next, { state: () => s });
}

/** `nice` of the reference: the nearest of 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10^k (below 10 — the nearest integer). */
export function nice(x: number): number {
  if (x < 10) return Math.floor(x + 0.5);
  const e = 10 ** Math.floor(Math.log10(x));
  const m = x / e;
  let best = 1;
  for (const s of NICE) if (Math.abs(s - m) < Math.abs(best - m)) best = s;
  return best * e;
}

/** `up` of the reference: the next number of the «nice» row above x. */
export function up(x: number): number {
  const e = 10 ** Math.floor(Math.log10(x));
  for (const s of NICE) if (s * e > x * 1.0001) return s * e;
  return 10 * e;
}

/** `wallScale[n]`, after the table × `wallScaleGrowth` per tier (docs/01-gdd.md 8.4). */
export function wallScale(balance: BalanceJson, n: number): number {
  return scaled(1, n, balance.rebirth);
}

/** `ease(p)` of docs/01-gdd.md 8.1: 1 on tier 0 and up to wall fromWall − 1, then down to toFactor at the last wall. */
export function ease(balance: BalanceJson, n: number, p: number, lastWall: number): number {
  const { fromWall, toFactor } = balance.rebirth.lateEase;
  if (n < 1 || p < fromWall) return 1;
  return 1 - ((1 - toFactor) * (p - (fromWall - 1))) / (lastWall - (fromWall - 1));
}

export function newMeta(): ModelMeta {
  return { pets: [], trophies: 0, trail: 0, aura: 0 };
}

export function runCycle(pack: ModelPack, opts: CycleOpts): CycleRun {
  const { balance, tuning } = pack;
  const profile = opts.profile;
  const n = opts.tier ?? 0;
  const worlds = [...pack.worlds].sort((a, b) => a.index - b.index).slice(0, opts.mountains ?? pack.worlds.length);
  const meta = opts.meta ?? newMeta();
  // Trail and aura stay the same through the cycle: the reference spends trophies only at its end.
  const { trail: trailMult, aura: auraMult } = cosmeticMults(pack, meta);
  const rnd = lcg(opts.seed ?? SEED);
  const lazyRnd = lcg(LAZY_SEED);
  const lazy = profile === 'lazy';
  const spammer = profile === 'eggSpammer';
  const activeDay = profile === 'activeDay';
  const reference = opts.reference === true;
  const fit = opts.fit;
  const fitted: number[] = [];
  const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
  const vel = (s: number): number => moveSpeed(s, curve);
  const stepLen = balance.stepLength;
  const shoes = balance.upgrade.tiers;
  const Wn = opts.wallScale ?? wallScale(balance, n);
  const bonus = profile === 'goldSeeker' ? (pack.game.threat.bonus ?? null) : null;
  const petBonus = (id: string): number => pack.pets.pets.find((p) => p.id === id)?.bonus ?? 0;
  const freePet = petBonus(balance.ftue.freeEggPet);
  const scriptedWall = balance.ftue.scriptedWaveWall;
  const slots = balance.pets.slots;
  const wallsPerMountain = pack.worlds.map((w) => w.segments.filter((s) => s.type === 'gate').length);
  const lastWall = wallsPerMountain.reduce((a, b) => a + b, 0);

  // Eggs of the mountains in order; an egg opens at its first stand (the camp one: wall 1 of its mountain; the
  // reference: walls 6, 13, 25, 37, 49 — on mountain 1 the bot cannot afford an egg before wall 6 anyway).
  const eggs = [...pack.worlds]
    .sort((a, b) => a.index - b.index)
    .map((w, wi) => {
      const egg = pack.eggs.eggs.find((e) => e.id === w.egg);
      if (!egg) return null;
      const stand = w.segments.filter((s) => s.type === 'eggStand').sort((a, b) => a.z - b.z)[0];
      const gates = w.segments.filter((s) => s.type === 'gate');
      const at = stand ? gates.filter((g) => g.z < stand.z).length : 1;
      const before = wallsPerMountain.slice(0, wi).reduce((a, b) => a + b, 0);
      return { at: before + Math.max(1, at), price: egg.price, pool: egg.pool.map((s) => ({ bonus: petBonus(s.pet), chance: s.chance })) };
    })
    .filter((e) => e !== null);
  const eggById = (id: string): (typeof eggs)[number] | null => {
    const egg = pack.eggs.eggs.find((e) => e.id === id);
    return egg ? { at: 0, price: egg.price, pool: egg.pool.map((s) => ({ bonus: petBonus(s.pet), chance: s.chance })) } : null;
  };

  const prunePets = (): void => {
    meta.pets.sort((a, b) => b - a);
    if (meta.pets.length > slots) meta.pets.length = slots;
  };
  const petMult = (): number => {
    let s = 0;
    for (let i = 0; i < slots; i++) s += meta.pets[i] ?? 0;
    return 1 + s;
  };
  let eggsBought = 0;
  const hatch = (e: (typeof eggs)[number]): void => {
    eggsBought++;
    const r = rnd();
    let acc = 0;
    for (const slot of e.pool) {
      acc += slot.chance;
      if (r <= acc) {
        meta.pets.push(slot.bonus);
        prunePets();
        return;
      }
    }
    meta.pets.push(e.pool[e.pool.length - 1]!.bonus);
  };

  let S = 0;
  let C = 0;
  let shoe = 0;
  let T = 0;
  let normalWaves = 0;
  let ignoredWaves = 0;
  let caught = 0;
  let doubleCaught = 0;
  let goldTaken = 0;
  let boostUntil = -1;
  let trophiesGot = 0;
  // Active day: the rewards of the day in order of their second of play (calendar, time rewards, quests).
  const dayEvents = activeDay ? activeDayEvents(balance) : [];
  let nextEvent = 0;
  const walls: WallRow[] = [];
  const shoeBuys: number[] = [];
  const mountains: number[] = [];

  for (let wi = 0; wi < worlds.length; wi++) {
    const world = worlds[wi]!;
    const w = world.index;
    const th = world.threat;
    const campTop = th.safeZoneZ[1];
    const gates = world.segments.filter((s) => s.type === 'gate').sort((a, b) => a.z - b.z);
    const niches = world.segments.filter((s) => s.type === 'niche');
    const zoneGift = (k: number): number => world.zones.find((zz) => zz.k === k)?.gift ?? 0;
    const lastGateZ = gates[gates.length - 1]?.z ?? world.length;
    const zEnd = lastGateZ + TO_PORTAL;
    const before = wallsPerMountain.slice(0, w - 1).reduce((a, b) => a + b, 0);
    const giftsAll = world.segments.filter((s) => s.type === 'gift');
    const groundShare = giftsAll.length ? giftsAll.filter((s) => num(s, 'height') === 0).length / giftsAll.length : 1;
    const giftsPerZone = lazy ? Math.round(balance.gifts.perZone * groundShare) : balance.gifts.perZone;
    const scripted = n === 0 && w === 1 && th.firstWaveScripted;
    const tw0 = T;
    let z = world.spawnZ;
    let phase: 'idle' | 'warn' | 'run' = 'idle';
    // First wave of a mountain after the load or the portal: its own firstIntervalSec (Q-022, M3-12); the reference uses I.
    let phT = reference ? th.intervalSec : th.firstIntervalSec;
    let front = 0;
    let giftsLeft = giftsPerZone;
    let carrying = false;
    let ignoring = false;
    let warnAge = 0;
    let caughtThisWave = 0;
    let isScriptedWave = false;
    let lastWallT = T;

    for (let i = 1; i <= gates.length; i++) {
      const p = before + i;
      const gate = gates[i - 1]!;
      const gz = gate.z;
      const cave = niches.find((nn) => num(nn, 'stretch') === i);
      const shelter = cave ? cave.z : gz;
      const caveBelow = niches.find((nn) => num(nn, 'stretch') === i - 1)?.z ?? campTop;
      const tread = reference ? refTread(p) : (cave ? num(cave, 'treadmill') : 1) * (world.treadmillMult ?? 1);
      const gift = zoneGift(num(gate, 'zone')) * Wn;
      // Fit: a wall after `keep` has no number; it opens at its target second of the mountain (the reference: 'inverse').
      const fitAt = fit && p > fit.keep ? tw0 + (fit.targetSec[p - 1] ?? 0) : null;
      const req = fitAt !== null ? Infinity : num(gate, 'requires') * Wn * ease(balance, n, p, lastWall);
      const reward = ((gate['reward'] as { coins?: number } | undefined)?.coins ?? 0) * Wn;
      let readySince = -1;
      if (scripted && i === scriptedWall) {
        phase = 'warn';
        phT = balance.ftue.warnSec;
        isScriptedWave = true;
        warnAge = 0;
      }
      if (scripted && i < scriptedWall) {
        phase = 'idle';
        phT = SCRIPTED_IDLE;
      }
      const sheltered = (): boolean => z === shelter || z <= campTop || z >= lastGateZ;
      // Lazy only: the hero moves on the slope from z to `to` while the front runs down — ran into it?
      const exposedMove = (to: number): void => {
        if (lazy && !isScriptedWave && phase === 'run' && z < front && to >= front) catchHero();
      };
      const catchHero = (): void => {
        caughtThisWave++;
        if (caughtThisWave > 1) {
          doubleCaught++;
          return;
        }
        caught++;
        T += balance.caught.maxSec;
        z = caveBelow;
      };
      const walkTo = (to: number, v: number, g: number): void => {
        if (z >= to) return;
        exposedMove(to);
        if (z >= to) return;
        const d = to - z;
        T += d / v;
        S += (d / stepLen) * g;
        phT -= d / v;
        z = to;
      };
      for (;;) {
        // The step of the game (docs/01-gdd.md 8.1): the same formula module as the simulation.
        const g = stepGain(balance, { tier: n, shoe: shoes[shoe]?.mult ?? 1, pets: petMult(), trail: trailMult, aura: auraMult, boost: T < boostUntil });
        const v = vel(S);
        phT -= DT;
        if (phase === 'warn') warnAge += DT;
        if (phase === 'idle' && phT <= 0) {
          phase = 'warn';
          phT = th.warnSec;
          warnAge = 0;
          isScriptedWave = false;
          caughtThisWave = 0;
          normalWaves++;
          ignoring = lazy && lazyRnd() < LAZY_IGNORE;
          if (ignoring) ignoredWaves++;
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
        const reacting = !lazy || (!ignoring && warnAge >= LAZY_REACT_SEC);
        const hiding = (phase === 'warn' && reacting) || (phase === 'run' && front > z && (!lazy || !ignoring));
        if (phase === 'run') {
          const was = front;
          front -= th.speed * DT;
          // Lazy only: the front sweeps a hero standing outside a cave.
          if (lazy && !isScriptedWave && was > z && front <= z && !sheltered()) catchHero();
          if (front <= campTop) {
            phase = 'idle';
            phT = th.intervalSec;
            giftsLeft = giftsPerZone;
            if (caughtThisWave === 0 || isScriptedWave) C += balance.coins.waveSurvived * gift;
            if (carrying && bonus && caughtThisWave === 0) {
              C += bonus.mult * gift;
              goldTaken++;
            }
            carrying = false;
            isScriptedWave = false;
          }
        }
        if (S >= req && readySince < 0) readySince = T;
        const ready = fitAt !== null ? T >= fitAt : S >= req && (!lazy || T - readySince >= LAZY_REACT_SEC);
        if (hiding) {
          walkTo(shelter, v, g);
          S += (v / stepLen) * g * tread * DT;
          z = shelter;
        } else if (ready) {
          const dist = gz - z;
          S += (dist / stepLen) * g;
          T += Math.max(MIN_RUN_SEC, dist / v);
          exposedMove(gz + PAST_WALL);
          z = gz + PAST_WALL;
          C += reward;
          break;
        } else if (giftsLeft > 0 && !(scripted && i < scriptedWall && T < SCRIPTED_GIFT_WAIT)) {
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
        // Active day: rewards of the day as their second of play comes (coins are k × the gift of the hero's zone).
        while (nextEvent < dayEvents.length && dayEvents[nextEvent]!.at <= T) {
          const r = dayEvents[nextEvent++]!.reward;
          if (r.kind === 'coins') C += r.gifts * gift;
          else if (r.kind === 'trophies') {
            meta.trophies += r.n;
            trophiesGot += r.n;
          }
          else if (r.kind === 'boost') boostUntil = Math.max(T, boostUntil) + r.min * 60;
          else if (r.kind === 'pet') {
            meta.pets.push(petBonus(r.id));
            prunePets();
          } else if (r.kind === 'egg') {
            const e = r.id === 'best' ? [...eggs].reverse().find((x) => p >= x.at) : eggById(r.id);
            if (e) hatch(e);
          }
        }
        // Egg spammer (the reference, SPAM=1): the best open egg first, shoes from what is left.
        const best = [...eggs].reverse().find((e) => p >= e.at);
        if (spammer && best) {
          for (let k = 0; k < EGG_BATCH && C >= best.price * Wn; k++) {
            C -= best.price * Wn;
            hatch(best);
          }
        }
        while (shoe < shoes.length - 1 && C >= shoes[shoe + 1]!.price * Wn) {
          C -= shoes[shoe + 1]!.price * Wn;
          shoe++;
          shoeBuys.push(T);
        }
        // The best open egg, as many times as wanted, while the next shoes cost 4+ times more (the reference).
        if (best && !spammer) {
          const next = shoe < shoes.length - 1 ? shoes[shoe + 1]!.price * Wn : Infinity;
          for (let k = 0; k < EGG_BATCH && C >= best.price * Wn && next >= EGG_VS_SHOES * best.price * Wn; k++) {
            C -= best.price * Wn;
            hatch(best);
          }
        }
        if (T > LIMIT_SEC) {
          return { sec: Infinity, mountains, walls, shoeBuys, eggsBought, normalWaves, ignoredWaves, caught, doubleCaught, goldTaken, coins: C, meta, trophiesGot, seedOut: rnd.state(), fitted };
        }
      }
      // The free egg of the first minute hatches after wall 3 of the reference (docs/01-gdd.md 6.2).
      if (scripted && i === scriptedWall - 1) {
        meta.pets.push(freePet);
        prunePets();
      }
      if (fit) {
        // The reference: gate = nice(stat / W × 0.97), and strictly above the previous one.
        let x = fitAt !== null ? nice((S / Wn) * FIT_SHARE) : num(gate, 'requires');
        const prev = fitted[p - 2];
        if (fitAt !== null && prev !== undefined && x <= prev) x = up(prev);
        fitted[p - 1] = x;
      }
      walls.push({ mountain: w, wall: i, p, sec: T - tw0, total: T, took: T - lastWallT, stat: S, shoe, petMult: petMult(), coins: C });
      lastWallT = T;
    }
    T += TO_PORTAL / vel(S);
    C += balance.coins.chest * zoneGift(world.zones[world.zones.length - 1]?.k ?? 0) * Wn;
    meta.trophies += w * (1 + n); // balance.trophies.perSummit: «world * (1 + tier)»
    trophiesGot += w * (1 + n);
    // Before rebirth the bot spends coins on the best eggs it can.
    if (wi === pack.worlds.length - 1) {
      for (const e of [...eggs].reverse()) {
        for (let k = 0; k < EGGS_BEFORE_REBIRTH && C >= e.price * Wn; k++) {
          C -= e.price * Wn;
          hatch(e);
        }
      }
    }
    mountains.push(T - tw0);
  }
  spendTrophies(pack, meta);
  return { sec: T, mountains, walls, shoeBuys, eggsBought, normalWaves, ignoredWaves, caught, doubleCaught, goldTaken, coins: C, meta, trophiesGot, seedOut: rnd.state(), fitted };
}

/**
 * Rewards of the «active day» profile, days back to back every ACTIVE_DAY_SEC of play: the calendar day at its start
 * (a look the bot gets for the first time gives nothing to the economy; `alt` only when it is owned — not in one week),
 * the time rewards at their minute of the day, the quests at QUEST_AT_MIN and the bonus with the last one.
 */
export function activeDayEvents(balance: BalanceJson, days = 12): Array<{ at: number; reward: Reward }> {
  const ev: Array<{ at: number; reward: Reward }> = [];
  for (let d = 0; d < days; d++) {
    const t0 = d * ACTIVE_DAY_SEC;
    const day = balance.daily.days[d % balance.daily.days.length];
    const firstRound = d < balance.daily.days.length;
    const cal = day && (firstRound || !day.alt) ? day : day?.alt;
    if (cal) ev.push({ at: t0, reward: cal });
    for (const tr of balance.timeRewards) if (tr.min * 60 < ACTIVE_DAY_SEC) ev.push({ at: t0 + tr.min * 60, reward: tr.reward });
    const quests = QUEST_AT_MIN.slice(0, balance.quests.perDay);
    quests.forEach((m, i) => {
      for (const r of balance.quests.reward) ev.push({ at: t0 + m * 60, reward: r });
      if (i === quests.length - 1) for (const r of balance.quests.bonus) ev.push({ at: t0 + m * 60, reward: r });
    });
  }
  return ev.sort((a, b) => a.at - b.at);
}

/** Trails and auras by price, cheapest first (the reference: @trails, @auras without the [1, 0] «none»). */
function byPrice<T extends { price: number }>(list: readonly T[] | undefined): T[] {
  return [...(list ?? [])].sort((a, b) => a.price - b.price);
}

/** Multipliers of the trail and the aura the bot has on (×1 for none). */
export function cosmeticMults(pack: ModelPack, meta: ModelMeta): { trail: number; aura: number } {
  return { trail: byPrice(pack.trails?.trails)[meta.trail - 1]?.mult ?? 1, aura: byPrice(pack.auras?.auras)[meta.aura - 1]?.mult ?? 1 };
}

/** `spendTrophies` of the reference: buy the next trail if affordable and not dearer than the next aura, else the next aura. */
export function spendTrophies(pack: ModelPack, meta: ModelMeta): void {
  const trails = byPrice(pack.trails?.trails);
  const auras = byPrice(pack.auras?.auras);
  for (let bought = true; bought; ) {
    bought = false;
    const nt = trails[meta.trail];
    const na = auras[meta.aura];
    if (nt && meta.trophies >= nt.price && (!na || nt.price <= na.price)) {
      meta.trophies -= nt.price;
      meta.trail++;
      bought = true;
    } else if (na && meta.trophies >= na.price) {
      meta.trophies -= na.price;
      meta.aura++;
      bought = true;
    }
  }
}

export interface MountainRun {
  /** Seconds from the camp to the portal. */
  sec: number;
  walls: WallRow[];
  normalWaves: number;
  goldTaken: number;
  coins: number;
}

/** Mountain 1 of tier 0 with a fresh meta (the M2-12 gold seeker threshold, the M2 checks of sim:balance). */
export function runMountain1(pack: ModelPack, profile: Profile): MountainRun {
  const r = runCycle(pack, { profile, mountains: 1 });
  return { sec: r.mountains[0] ?? Infinity, walls: r.walls, normalWaves: r.normalWaves, goldTaken: r.goldTaken, coins: r.coins };
}

/** Pack with the tier-0 requirements of the walls replaced (index p − 1, through number), the rest shared. */
export function withWalls(pack: ModelPack, req: readonly number[]): ModelPack {
  let p = 0;
  const worlds = [...pack.worlds]
    .sort((a, b) => a.index - b.index)
    .map((w) => {
      const gates = w.segments.filter((s) => s.type === 'gate').sort((a, b) => a.z - b.z);
      const byGate = new Map(gates.map((g) => [g, req[p++] ?? num(g, 'requires')]));
      return { ...w, segments: w.segments.map((s) => (byGate.has(s) ? { ...s, requires: byGate.get(s)! } : s)) };
    });
  return { ...pack, worlds };
}

export interface FitTargets {
  /** Walls 1…keep stay as they are (mountain 1: 20, 40, 80 — GDD-01). */
  keep: number;
  /** Target second of the mountain for every wall (index p − 1). */
  targetSec: number[];
  /** Target cycle minutes of tiers 1…N. */
  cycleMin: number[];
}

/**
 * Targets of the reference (balance-model.pl: @w1Target, @worldTarget × i / 12.4, @cycleTarget; docs/01a-content.md 9:
 * «ступень 1 — 22 … ступень 9 — 18»). Model targets, not game numbers: the fit of `sim:balance --fit` and its check
 * in reference mode use them; a pack with another count of walls has none.
 */
export function referenceTargets(wallsPerMountain: number[]): FitTargets | null {
  const m1 = [7, 13, 25, 50, 72, 98, 125, 155, 185, 220, 258, 300];
  const mountainSec = [330, 360, 390, 420, 450];
  if (wallsPerMountain.length !== mountainSec.length || wallsPerMountain.some((k) => k !== m1.length)) return null;
  const targetSec = wallsPerMountain.flatMap((k, w) => Array.from({ length: k }, (_, i) => (w === 0 ? m1[i]! : (mountainSec[w]! * (i + 1)) / 12.4)));
  return { keep: 3, targetSec, cycleMin: [22, 21, 20, 20, 19, 19, 18, 18, 18] };
}

export interface FitResult {
  /** Tier-0 requirements of walls 1…60 (index p − 1) and `wallScale[0…9]`. */
  walls: number[];
  wallScale: number[];
  /** Cycle minutes of tiers 0…9 with the fitted numbers. */
  cycleMin: number[];
}

/**
 * `sim:balance --fit` (docs/01-gdd.md 8.5), steps 1–3 of the reference: the inverse run of the greedy bot puts walls
 * after `keep` on its stat at their target second × 0.97 (nice row, strictly above the previous wall); the direct run
 * of tier 0 on the new table; then `wallScale[n]` of tiers 1…N by bisection on its logarithm so that the cycle takes
 * `cycleMin` minutes, rounded to the nice row and strictly growing. Prices, multipliers and gifts are not touched.
 */
export function fitBalance(pack: ModelPack, t: FitTargets, reference = false): FitResult {
  const { keep, targetSec, cycleMin } = t;
  const tiers = cycleMin.length;
  const inv = runCycle(pack, { profile: 'greedy', fit: { keep, targetSec }, reference });
  const walls = inv.fitted;
  const fitted = withWalls(pack, walls);
  const r0 = runCycle(fitted, { profile: 'greedy', reference });
  const scale = [1];
  const cycle = [r0.sec / 60];
  let meta = r0.meta;
  let seed = r0.seedOut;
  const step = pack.balance.rebirth.stepMult;
  for (let n = 1; n <= tiers; n++) {
    const copy = (): ModelMeta => ({ ...meta, pets: [...meta.pets] });
    let lo = Math.log(step ** n);
    let hi = lo + 20;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      const r = runCycle(fitted, { profile: 'greedy', tier: n, meta: copy(), seed, wallScale: Math.exp(mid), reference });
      if (r.sec / 60 < cycleMin[n - 1]!) lo = mid;
      else hi = mid;
    }
    let W = nice(Math.exp(lo));
    if (W <= scale[n - 1]!) W = up(scale[n - 1]!);
    const r = runCycle(fitted, { profile: 'greedy', tier: n, meta: copy(), seed, wallScale: W, reference });
    scale.push(W);
    cycle.push(r.sec / 60);
    meta = r.meta;
    seed = r.seedOut;
  }
  return { walls, wallScale: scale, cycleMin: cycle };
}
