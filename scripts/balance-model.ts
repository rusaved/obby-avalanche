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
 * - novice — greedy that runs × `novice.speed` and buys shoes and eggs `novice.delaySec` after it can pay (docs/01-gdd.md
 *   19.6, F14: the stand on a belt at a ridge of mountain 1 for a player who is slower to buy).
 * - buyer — greedy that buys with yans from `buyer.fromSec` of play (docs/01-gdd.md 19.7, F15): VIP × iap.vipMult on every
 *   step, and the starter pack once (its pet of balance.iap.starter, its trophies spendable only, not «of all time»).
 * Rewards by seconds (docs/01-gdd.md 19.6, F14): every cycle second of a passed wall (a ridge, the giant with the summit),
 * a pair of shoes, a bought egg and a wave the bot sheltered from («Phew, made it!»; the scripted one brings the free egg);
 * the seconds on the belt of a wall's grotto waiting for its number are `standSec` of its row.
 * `reference: true` runs the assumptions of balance-model.pl instead of the game ones: the first wave of a mountain after
 * intervalSec and the unrounded treadmill curve of the reference (the data keep the rounded one, docs/01a-content.md 3).
 * With it the port repeats the reference wall by wall (column «Бот модели» of docs/01a-content.md 3).
 * `fit` — the inverse run of the reference for `sim:balance --fit`: a wall without a number opens at its target second and
 * gets the stat of the bot × `FIT_SHARE`, rounded to the «nice» row (docs/01-gdd.md 8.5) or the row of the pace.
 * Gifts on the path (`path: true`, docs/01-gdd.md 16.4, 16.8: the path, the slide, over the trampoline) are taken on the
 * run with no time lost, each once as the hero walks over it, again only after a wave is gone and the hero passes it
 * again; a mountain with no other gifts makes no detours for gifts. The slide and the trampoline cost no time here.
 * Elements of the open slope and the rare events (docs/01-gdd.md 18.11): the throat on the axis is its ice — × its
 * slide `mult` along it; the chasm is the trampoline flight, CHASM_FLIGHT s over it with no steps; the tunnel (the calm
 * lane, no gifts) and the hump (the bold lane) are off the axis — the bot runs past them as before. Every section of
 * game.json events.sections costs the events of its mountain once a pass at their expected price: the snowball
 * chance × (tumbleSec + slowSec × (1 − slow)) s, the blizzard chance × durationSec × (1 − speedMult) s and
 * chance × durationSec × speedMult × (stepMult − 1) s of steps more.
 */
import type { AurasJson, BalanceJson, EggsJson, GameJson, PetsJson, Reward, Segment, TrailsJson, TuningJson, World } from '../src/content/types.ts';
import { moveSpeed } from '../src/sim/effects/moveSpeed.ts';
import { scaled, stepGain } from '../src/sim/economy.ts';

export type Profile = 'greedy' | 'goldSeeker' | 'lazy' | 'activeDay' | 'eggSpammer' | 'novice' | 'buyer';

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
  /** The wall is the giant of the mountain (docs/01-gdd.md 17.6: his zone is the last check of an open mountain). */
  boss: boolean;
  /** Seconds of the final open run from the shelter to the wall (for the giant — the run through his zone). */
  runSec: number;
  /** Seconds on the belt of the wall's grotto waiting for its number (not hiding from a wave, F14). */
  standSec: number;
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
  /** Cycle second of every catch (lazy): «Накрыло» in the first minutes, docs/01-gdd.md 17.8. */
  caughtAt: number[];
  /** Eggs bought by the summit of every mountain (index = mountain − 1), docs/01-gdd.md 17.8 (check F11). */
  eggsAt: number[];
  goldTaken: number;
  coins: number;
  meta: ModelMeta;
  /** Trophies got in this cycle (summits and rewards), for «кубки за всё время» (docs/01-gdd.md 8.5, check 10). */
  trophiesGot: number;
  /** State of the egg generator after the cycle: the next tier goes on with it, as the reference does. */
  seedOut: number;
  /** Fit mode: requirements of tier 0 by through number (index p − 1). */
  fitted: number[];
  /** Cycle seconds of every reward (F14, docs/01-gdd.md 19.6): walls, shoes, bought eggs, waves sheltered from; sorted. */
  rewards: number[];
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
  fit?: { keep: number; targetSec: number[]; round?: Rounding };
  /** `wallScale[n]` to try instead of the table (the bisection of sim:balance --fit). */
  wallScale?: number;
  /** Profile novice (F14): run × `speed`, buy `delaySec` after the coins are there; default 0.8 and 15 s. */
  novice?: { speed: number; delaySec: number };
  /** Profile buyer (F15): from `fromSec` of the cycle VIP (`vip`) and the starter pack (`starter`). */
  buyer?: { fromSec: number; vip: boolean; starter: boolean };
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
/** The trampoline flight over a chasm on the axis (docs/01-gdd.md 18.11: «бот — трамплин, без шагов 1 с»). */
const CHASM_FLIGHT = 1;

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

/** Rounding of the fitted requirements: the nearest number of a row and the next one above (strictly greater). */
export interface Rounding {
  near: (x: number) => number;
  up: (x: number) => number;
}

/** The «nice» row of the reference (docs/01-gdd.md 8.5). */
export const NICE_ROUNDING: Rounding = { near: nice, up };

/**
 * `digits` significant digits (pace fast, docs/01-gdd.md 16.8: the nice row steps ×1.2–1.33, coarser than the ×1.11 a gate
 * of 195): below 10 — the nearest integer, as `nice`; `up` — the next number of the row above x.
 */
export function sigRounding(digits: number): Rounding {
  const unit = (x: number): number => (x < 10 ? 1 : 10 ** (Math.floor(Math.log10(x)) - digits + 1));
  const fix = (x: number): number => Number(x.toPrecision(15));
  return {
    near: (x) => fix(Math.floor(x / unit(x) + 0.5) * unit(x)),
    up: (x) => {
      const u = unit(x);
      let y = fix((Math.floor(x / u + 1e-9) + 1) * u);
      if (y <= x) y = fix(y + unit(y));
      return y;
    },
  };
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
  const novice = profile === 'novice' ? (opts.novice ?? { speed: 0.8, delaySec: 15 }) : null;
  const buyer = profile === 'buyer' ? (opts.buyer ?? { fromSec: balance.iap.showAfterPlaySec, vip: true, starter: true }) : null;
  let starterGiven = false;
  const activeDay = profile === 'activeDay';
  const reference = opts.reference === true;
  const fit = opts.fit;
  const fitted: number[] = [];
  const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
  const vel = (s: number): number => moveSpeed(s, curve) * (novice ? novice.speed : 1);
  /** A belt runs under the hero at his full run speed whatever the stick (src/sim/world.ts): the novice too. */
  const beltVel = (s: number): number => moveSpeed(s, curve);
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
  const rewards: number[] = [];
  /** Novice: the cycle second it first could pay for the next shoes / egg (−1 — not yet). */
  let shoeSince = -1;
  let eggSince = -1;
  const hatch = (e: (typeof eggs)[number]): void => {
    eggsBought++;
    rewards.push(T);
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
  const caughtAt: number[] = [];
  const eggsAt: number[] = [];

  for (let wi = 0; wi < worlds.length; wi++) {
    const world = worlds[wi]!;
    const w = world.index;
    const th = world.threat;
    const campTop = th.safeZoneZ[1];
    // Open slope (docs/01-gdd.md 17.4): the front never starts above `spawnMaxZ` (the start line of the giant), so the
    // hero above it is safe — the race is the only check of that stretch.
    const spawnMaxRaw = (th as unknown as Record<string, unknown>)['spawnMaxZ'];
    const spawnMaxZ = typeof spawnMaxRaw === 'number' ? spawnMaxRaw : null;
    const gates = world.segments.filter((s) => s.type === 'gate').sort((a, b) => a.z - b.z);
    const niches = world.segments.filter((s) => s.type === 'niche');
    const zoneGift = (k: number): number => world.zones.find((zz) => zz.k === k)?.gift ?? 0;
    const lastGateZ = gates[gates.length - 1]?.z ?? world.length;
    const zEnd = lastGateZ + TO_PORTAL;
    const before = wallsPerMountain.slice(0, w - 1).reduce((a, b) => a + b, 0);
    // Open slope (docs/01-gdd.md 17.12): the bot runs the axis — the bold lane of a fork and the detours (a crevasse
    // bottom, a ledge, the grotto with the chest) are not counted; on a fork it takes the calm lane.
    const axis = (s: Segment): boolean => s['lane'] !== 'bold' && s['detour'] !== true;
    const giftsAll = world.segments.filter((s) => s.type === 'gift' && s['path'] !== true && axis(s));
    const groundShare = giftsAll.length ? giftsAll.filter((s) => num(s, 'height') === 0).length / giftsAll.length : 1;
    // Only gifts off the path cost a detour of GIFT_SEC (classic: perZone after every wave); a mountain of path gifts has none.
    const perZone = giftsAll.length ? balance.gifts.perZone : 0;
    const giftsPerZone = lazy ? Math.round(perZone * groundShare) : perZone;
    // Gifts on the path, bottom up: taken while the hero walks over them, back after a wave is gone (gifts.respawn).
    const pathGifts = world.segments
      .filter((s) => s.type === 'gift' && s['path'] === true && axis(s))
      .map((s) => ({ z: s.z, coins: num(s, 'coins'), taken: false }))
      .sort((a, b) => a.z - b.z);
    const takePath = (from: number, to: number): void => {
      for (const pg of pathGifts) {
        if (pg.z <= from || pg.z > to || pg.taken) continue;
        pg.taken = true;
        C += pg.coins * Wn;
      }
    };
    // Elements on the axis and the rare events (docs/01-gdd.md 18.11); none in the reference.
    const throats = reference
      ? []
      : world.segments
          .filter((s) => s.type === 'throat')
          .map((s) => {
            const slide = world.segments.find((x) => x.type === 'slide' && x.z >= s.z && x.z <= s.z + num(s, 'length'));
            const m = slide && typeof slide['mult'] === 'number' ? (slide['mult'] as number) : (pack.tuning.fun?.slideMult ?? 1);
            return { a: s.z, b: s.z + num(s, 'length'), m };
          });
    const chasms = reference ? [] : world.segments.filter((s) => s.type === 'chasm').map((s) => ({ a: s.z, b: s.z + num(s, 'length') }));
    const ev = reference ? undefined : pack.game.events;
    const snow = ev?.snowball && w >= ev.snowball.fromWorld ? ev.snowball : null;
    const bliz = ev?.blizzard && w >= ev.blizzard.fromWorld ? ev.blizzard : null;
    const eventSec = (snow ? snow.chance * (snow.tumbleSec + snow.slowSec * (1 - snow.slow)) : 0) + (bliz ? bliz.chance * bliz.durationSec * (1 - bliz.speedMult) : 0);
    const eventStepSec = bliz ? bliz.chance * bliz.durationSec * bliz.speedMult * (bliz.stepMult - 1) : 0;
    // Only a mountain with sections (the open slope) has events, as in the game (src/sim/events.ts).
    const sections = world.zones.some((zz) => typeof zz.stepMult === 'number');
    const eventStarts = ev && sections ? world.zones.filter((zz) => zz.k >= ev.sections[0] && zz.k <= ev.sections[1]).map((zz) => zz.zStart) : [];
    const entered = new Set<number>();
    // From z to `to` at v: seconds and the distance that counts steps; the sections entered on the way pay their events.
    const cross = (from: number, to: number, v: number, g: number, zMult: number): { sec: number; dist: number } => {
      const over = (a: number, b: number): number => Math.max(0, Math.min(to, b) - Math.max(from, a));
      let sec = (to - from) / v;
      let dist = to - from;
      for (const t of throats) sec -= (over(t.a, t.b) / v) * (1 - 1 / t.m);
      for (const c of chasms) {
        const o = over(c.a, c.b);
        if (o <= 0) continue;
        sec += (o / (c.b - c.a)) * CHASM_FLIGHT - o / v;
        dist -= o;
      }
      for (const at of eventStarts)
        if (at > from && at <= to && !entered.has(at)) {
          entered.add(at);
          sec += eventSec;
          S += ((eventStepSec * v) / stepLen) * g * zMult;
        }
      return { sec, dist };
    };
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
    /** The bot hid from this wave (a reward «Phew, made it!» only then: above the giant's line the wave never comes). */
    let hidWave = false;
    let lastWallT = T;

    for (let i = 1; i <= gates.length; i++) {
      const p = before + i;
      const gate = gates[i - 1]!;
      const gz = gate.z;
      // Shelters of the stretch: one cave in classic and fast, several on the open slope (docs/01-gdd.md 17.4). On
      // `warn` the bot runs to the nearest one at or above it; it saves up on the treadmill of the last one before the
      // wall (the grotto under the ridge, the start line of the giant). The snowball rolls to the nearest one below.
      const stretchNiches = niches.filter((nn) => num(nn, 'stretch') === i).sort((a, b) => a.z - b.z);
      const grotto = stretchNiches[stretchNiches.length - 1]?.z ?? gz;
      const shelterAt = (from: number): number => stretchNiches.find((nn) => nn.z >= from)?.z ?? grotto;
      const treadAt = (at: number): number => {
        if (reference) return refTread(p);
        const nn = stretchNiches.find((x) => x.z === at);
        return (nn ? num(nn, 'treadmill') : 1) * (world.treadmillMult ?? 1);
      };
      const caveBelowOf = (from: number): number => niches.filter((nn) => nn.z < from).reduce((a, nn) => Math.max(a, nn.z), campTop);
      const gift = zoneGift(num(gate, 'zone')) * Wn;
      // Open slope (docs/01-gdd.md 17.3): every step on the slope of a zone gives × its `stepMult` (1 when absent — classic
      // and fast); the treadmill multiplier replaces it, as in the game.
      const zmRaw = (world.zones.find((zz) => zz.k === num(gate, 'zone')) as unknown as Record<string, unknown> | undefined)?.['stepMult'];
      const zm = typeof zmRaw === 'number' ? zmRaw : 1;
      // Fit: a wall after `keep` has no number; it opens at its target second of the mountain (the reference: 'inverse').
      const fitAt = fit && p > fit.keep ? tw0 + (fit.targetSec[p - 1] ?? 0) : null;
      const req = fitAt !== null ? Infinity : num(gate, 'requires') * Wn * ease(balance, n, p, lastWall);
      const reward = ((gate['reward'] as { coins?: number } | undefined)?.coins ?? 0) * Wn;
      let readySince = -1;
      let runSec = 0;
      let standSec = 0;
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
      const sheltered = (): boolean => stretchNiches.some((nn) => nn.z === z) || z <= campTop || z >= lastGateZ || (spawnMaxZ !== null && z >= spawnMaxZ);
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
        caughtAt.push(T);
        T += balance.caught.maxSec;
        z = caveBelowOf(z);
      };
      const walkTo = (to: number, v: number, g: number): void => {
        if (z >= to) return;
        exposedMove(to);
        if (z >= to) return;
        const c = cross(z, to, v, g, zm);
        T += c.sec;
        S += (c.dist / stepLen) * g * zm;
        phT -= c.sec;
        takePath(z, to);
        z = to;
      };
      for (;;) {
        // The step of the game (docs/01-gdd.md 8.1): the same formula module as the simulation.
        // Buyer: the purchases with yans from fromSec (the «Special» tab opens at iap.showAfterPlaySec, docs/01-gdd.md 9.3).
        if (buyer && T >= buyer.fromSec && buyer.starter && !starterGiven && balance.iap.starter) {
          starterGiven = true;
          meta.pets.push(petBonus(balance.iap.starter.pet));
          prunePets();
          meta.trophies += balance.iap.starter.trophies;
        }
        const g = stepGain(balance, { tier: n, shoe: shoes[shoe]?.mult ?? 1, pets: petMult(), trail: trailMult, aura: auraMult, boost: T < boostUntil, vip: !!buyer && buyer.vip && T >= buyer.fromSec });
        const v = vel(S);
        const vBelt = novice ? beltVel(S) : v;
        phT -= DT;
        if (phase === 'warn') warnAge += DT;
        if (phase === 'idle' && phT <= 0) {
          phase = 'warn';
          phT = th.warnSec;
          warnAge = 0;
          isScriptedWave = false;
          caughtThisWave = 0;
          normalWaves++;
          hidWave = false;
          ignoring = lazy && lazyRnd() < LAZY_IGNORE;
          if (ignoring) ignoredWaves++;
          // Golden gift (docs/01-gdd.md 8.5): there and back during the warning, steps on the way.
          if (bonus && normalWaves >= bonus.fromWave) {
            const d = 2 * GOLD_AVG;
            T += d / v;
            S += (d / stepLen) * g * zm;
            phT -= d / v;
            carrying = true;
          }
        } else if (phase === 'warn' && phT <= 0) {
          phase = 'run';
          front = Math.min(z + th.spawnAhead, spawnMaxZ ?? zEnd);
        }
        const reacting = !lazy || (!ignoring && warnAge >= LAZY_REACT_SEC);
        const safeAbove = spawnMaxZ !== null && z >= spawnMaxZ;
        const hiding = !safeAbove && ((phase === 'warn' && reacting) || (phase === 'run' && front > z && (!lazy || !ignoring)));
        if (hiding) hidWave = true;
        if (phase === 'run') {
          const was = front;
          front -= th.speed * DT;
          // Lazy only: the front sweeps a hero standing outside a cave.
          if (lazy && !isScriptedWave && was > z && front <= z && !sheltered()) catchHero();
          if (front <= campTop) {
            phase = 'idle';
            phT = th.intervalSec;
            giftsLeft = giftsPerZone;
            for (const pg of pathGifts) pg.taken = false;
            if (caughtThisWave === 0 || isScriptedWave) {
              C += balance.coins.waveSurvived * gift;
              if (hidWave || isScriptedWave) rewards.push(T);
            }
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
          const s = shelterAt(z);
          walkTo(s, v, g);
          S += (vBelt / stepLen) * g * treadAt(s) * DT;
          z = s;
        } else if (ready) {
          const c = cross(z, gz, v, g, zm);
          runSec = Math.max(MIN_RUN_SEC, c.sec);
          S += (c.dist / stepLen) * g * zm;
          T += runSec;
          rewards.push(T);
          exposedMove(gz + PAST_WALL);
          takePath(z, gz + PAST_WALL);
          z = gz + PAST_WALL;
          C += reward;
          break;
        } else if (giftsLeft > 0 && !(scripted && i < scriptedWall && T < SCRIPTED_GIFT_WAIT)) {
          S += ((v * GIFT_SEC) / stepLen) * g * zm;
          T += GIFT_SEC;
          giftsLeft--;
          C += gift;
          phT -= GIFT_SEC - DT;
          walkTo(grotto, v, g);
          continue;
        } else {
          walkTo(grotto, v, g);
          S += (vBelt / stepLen) * g * treadAt(grotto) * DT;
          z = grotto;
          standSec += DT;
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
        // Novice: a purchase waits delaySec from the moment the coins are there (each kind its own clock).
        const canShoe = shoe < shoes.length - 1 && C >= shoes[shoe + 1]!.price * Wn;
        if (canShoe && shoeSince < 0) shoeSince = T;
        if (!canShoe) shoeSince = -1;
        while ((!novice || (shoeSince >= 0 && T - shoeSince >= novice.delaySec)) && shoe < shoes.length - 1 && C >= shoes[shoe + 1]!.price * Wn) {
          C -= shoes[shoe + 1]!.price * Wn;
          shoe++;
          shoeBuys.push(T);
          rewards.push(T);
          shoeSince = -1;
        }
        // The best open egg, as many times as wanted, while the next shoes cost 4+ times more (the reference).
        if (best && !spammer) {
          const next = shoe < shoes.length - 1 ? shoes[shoe + 1]!.price * Wn : Infinity;
          const canEgg = C >= best.price * Wn && next >= EGG_VS_SHOES * best.price * Wn;
          if (canEgg && eggSince < 0) eggSince = T;
          if (!canEgg) eggSince = -1;
          for (let k = 0; k < EGG_BATCH && (!novice || (eggSince >= 0 && T - eggSince >= novice.delaySec)) && C >= best.price * Wn && next >= EGG_VS_SHOES * best.price * Wn; k++) {
            C -= best.price * Wn;
            hatch(best);
            eggSince = -1;
          }
        }
        if (T > LIMIT_SEC) {
          return { sec: Infinity, mountains, walls, shoeBuys, eggsBought, normalWaves, ignoredWaves, caught, doubleCaught, caughtAt, eggsAt, goldTaken, coins: C, meta, trophiesGot, seedOut: rnd.state(), fitted, rewards: rewards.sort((a, b) => a - b) };
        }
      }
      // The free egg of the first minute hatches after wall 3 of the reference (docs/01-gdd.md 6.2).
      if (scripted && i === scriptedWall - 1) {
        meta.pets.push(freePet);
        prunePets();
      }
      if (fit) {
        // The reference: gate = nice(stat / W × 0.97), and strictly above the previous one.
        const round = fit.round ?? NICE_ROUNDING;
        let x = fitAt !== null ? round.near((S / Wn) * FIT_SHARE) : num(gate, 'requires');
        const prev = fitted[p - 2];
        if (fitAt !== null && prev !== undefined && x <= prev) x = round.up(prev);
        fitted[p - 1] = x;
      }
      walls.push({ mountain: w, wall: i, p, sec: T - tw0, total: T, took: T - lastWallT, stat: S, shoe, petMult: petMult(), coins: C, boss: gate['boss'] === true, runSec, standSec });
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
    eggsAt.push(eggsBought);
  }
  spendTrophies(pack, meta);
  return { sec: T, mountains, walls, shoeBuys, eggsBought, normalWaves, ignoredWaves, caught, doubleCaught, caughtAt, eggsAt, goldTaken, coins: C, meta, trophiesGot, seedOut: rnd.state(), fitted, rewards: rewards.sort((a, b) => a - b) };
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
  /** Rounding of the fitted walls (default: the «nice» row of the reference). */
  round?: Rounding;
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
  return { keep: 3, targetSec, cycleMin: CYCLE_MIN };
}

/** Cycle minutes of tiers 1…9 the reference aims at (docs/01a-content.md 9), the same for every pace. */
export const CYCLE_MIN = [22, 21, 20, 20, 19, 19, 18, 18, 18];

/**
 * Targets of a pace (docs/01-gdd.md 16.8, balance.json → `sim` of the pace patch): gate i of n of mountain m opens at
 * second T_m · 60 · (i / n)^gateCurve of the mountain; walls 1…`keep` of mountain 1 stay; the walls are rounded to
 * `roundDigits` significant digits (the nice row when absent); tiers 1…9 aim at the cycles of the reference.
 */
export function paceTargets(sim: NonNullable<BalanceJson['sim']>, wallsPerMountain: number[]): FitTargets | null {
  if (sim.mountainMin.length !== wallsPerMountain.length) return null;
  const targetSec = wallsPerMountain.flatMap((k, m) => Array.from({ length: k }, (_, i) => sim.mountainMin[m]! * 60 * ((i + 1) / k) ** sim.gateCurve));
  return { keep: sim.keep ?? 0, targetSec, cycleMin: CYCLE_MIN, ...(sim.roundDigits ? { round: sigRounding(sim.roundDigits) } : {}) };
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
  const { keep, targetSec, cycleMin, round } = t;
  const tiers = cycleMin.length;
  const inv = runCycle(pack, { profile: 'greedy', fit: { keep, targetSec, ...(round ? { round } : {}) }, reference });
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
    // wallScale is rounded like the walls of the pace (the nice row of the reference; a pace with few walls needs the
    // finer row of its `roundDigits`, otherwise one step of the row moves a cycle by minutes).
    const rounding = round ?? NICE_ROUNDING;
    let W = rounding.near(Math.exp(lo));
    if (W <= scale[n - 1]!) W = rounding.up(scale[n - 1]!);
    const r = runCycle(fitted, { profile: 'greedy', tier: n, meta: copy(), seed, wallScale: W, reference });
    scale.push(W);
    cycle.push(r.sec / 60);
    meta = r.meta;
    seed = r.seedOut;
  }
  return { walls, wallScale: scale, cycleMin: cycle };
}
