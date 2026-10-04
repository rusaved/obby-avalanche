/**
 * Content validator (docs/02-tech.md 5.4): valibot schemas per file, cross-file links, enums, i18n parity.
 * Pure: takes the parsed files, returns messages "file: path — what is wrong". Reachability by the controller
 * physics (M1) and cave fairness against warnSec (M2-03).
 */
import * as v from 'valibot';
import type { Curve, GameJson, Segment, TuningJson, World, WorldsJson } from '../content/types.ts';
import { moveSpeed } from '../sim/effects/moveSpeed.ts';
import { buildLevel } from './builder.ts';

export const PACK_FILES = [
  'game.json',
  'theme.json',
  'balance.json',
  'tuning.json',
  'worlds.json',
  'worlds-spec.json',
  'skins.json',
  'accessories.json',
  'pets.json',
  'i18n/ru.json',
  'i18n/en.json',
] as const;

export type PackFile = (typeof PACK_FILES)[number];
export type PackFiles = Record<PackFile, unknown>;

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const hex = v.pipe(v.string(), v.regex(/^#[0-9A-Fa-f]{6}$/, 'expected #RRGGBB'));
const id = v.pipe(v.string(), v.regex(/^[a-z_][a-z0-9_]*$/, 'expected latin id'));
const name = v.pipe(v.string(), v.regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'expected latin name'));
const nonNeg = v.pipe(v.number(), v.minValue(0));
const positive = v.pipe(v.number(), v.minValue(1e-9, 'expected > 0'));
const curve = v.object({ base: positive, k: nonNeg, max: positive });

export const STAT_EFFECTS = ['moveSpeed', 'jumpPower', 'gateOnly'] as const;
export const SEGMENT_TYPES = [
  'floor', 'wall', 'gate', 'niche', 'gap', 'ramp', 'steps', 'treadmill', 'checkpoint', 'coins', 'chest',
  'portal', 'decor', 'gift', 'eggStand', 'zoneArch', 'summit',
] as const;
/** docs/02-tech.md 5.3: in game 1 every fx field has exactly one known value. */
export const FX_VALUES = {
  caught: ['ball'],
  gateOpen: ['melt'],
  footFx: ['snow'],
  weather: ['snow'],
  screenFrame: ['frost'],
  shelterMesh: ['cave'],
  treadmill: ['snowWhirl'],
} as const;

const gameSchema = v.object({
  id: id,
  schema: v.literal(1),
  stat: v.object({ key: id, effect: v.picklist(STAT_EFFECTS) }),
  threat: v.object({
    kind: v.literal('wave'),
    visual: id,
    bonus: v.optional(
      v.object({ kind: v.literal('goldGift'), fromWave: v.pipe(v.number(), v.integer(), v.minValue(1)), mult: positive, distMin: nonNeg, distMax: positive }),
    ),
  }),
  leaderboard: v.nullable(v.object({ name: v.string(), score: v.string() })),
  metrikaCounterId: v.pipe(v.number(), v.integer(), v.minValue(0)),
  mobileOrientation: v.picklist(['landscape', 'portrait']),
  payments: v.object({ enabled: v.boolean() }),
  ads: v.object({ interstitial: v.array(id), rewarded: v.array(id) }),
  flags: v.optional(
    v.record(
      v.string(),
      v.object({ path: v.string(), min: v.optional(v.number()), max: v.optional(v.number()), values: v.optional(v.array(v.string())) }),
    ),
  ),
});

const themeSchema = v.object({
  fx: v.object({
    caught: v.picklist(FX_VALUES.caught),
    gateOpen: v.picklist(FX_VALUES.gateOpen),
    footFx: v.picklist(FX_VALUES.footFx),
    weather: v.picklist(FX_VALUES.weather),
    screenFrame: v.picklist(FX_VALUES.screenFrame),
    shelterMesh: v.picklist(FX_VALUES.shelterMesh),
    treadmill: v.picklist(FX_VALUES.treadmill),
  }),
  sky: v.object({ top: hex, mid: v.optional(hex), bottom: hex }),
  fog: v.object({ color: hex, near: nonNeg, far: positive }),
  light: v.object({
    sun: hex,
    sunIntensity: nonNeg,
    ambient: hex,
    ambientIntensity: nonNeg,
    sunDir: v.tuple([v.number(), v.number(), v.number()]),
  }),
  materials: v.record(
    v.string(),
    v.object({ color: hex, roughness: v.optional(v.number()), metalness: v.optional(v.number()), emissive: v.optional(hex) }),
  ),
  rarity: v.record(id, hex),
  ui: v.object({ stat: hex, coins: hex, trophies: hex, ok: hex, no: hex, statIcon: name }),
  threat: v.object({ front: v.tuple([hex, hex]), edge: hex, body: hex, dust: hex, height: positive }),
  bonus: v.optional(v.object({ color: hex })),
});

const balanceSchema = v.object({
  stepLength: positive,
  gainPerStep: positive,
  gainTrigger: v.literal('step'),
  speedCurve: curve,
  jumpCurve: v.optional(curve),
  upgrade: v.object({
    attach: v.picklist(['feet', 'head', 'back', 'hand']),
    tiers: v.pipe(v.array(v.object({ id: id, mult: positive, price: nonNeg })), v.minLength(1)),
  }),
  rebirth: v.object({
    stepMult: positive,
    wallScale: v.pipe(v.array(positive), v.minLength(1)),
    lateEase: v.object({ fromWall: v.pipe(v.number(), v.integer()), toFactor: v.pipe(v.number(), v.minValue(0), v.maxValue(1)) }),
    wallScaleGrowth: positive,
    unlock: v.string(),
  }),
  trophies: v.object({ perSummit: v.string() }),
  gifts: v.object({ perZone: v.pipe(v.number(), v.integer(), v.minValue(1)), respawn: v.literal('onWaveGone') }),
  coins: v.object({ gatePass: positive, waveSurvived: positive, chest: positive }),
  pets: v.object({ slots: v.pipe(v.number(), v.integer()), inventory: v.pipe(v.number(), v.integer()) }),
  boost: v.object({ x2Sec: positive, statNowSec: positive }),
  caught: v.object({ rollSec: positive, maxSec: v.pipe(v.number(), v.maxValue(2)) }),
  threat: v.object({ newbieWaves: v.object({ count: v.pipe(v.number(), v.integer(), v.minValue(0)), warnBonusSec: nonNeg }) }),
  niche: v.object({ graceDist: nonNeg, graceMoving: nonNeg }),
  ui: v.object({ unlockMenusSec: nonNeg, unlockTimeRewardsSec: nonNeg }),
  ads: v.object({
    rewardedMinPlaySec: nonNeg,
    standStillSec: nonNeg,
    interstitialMinSec: v.pipe(v.number(), v.minValue(180)),
    interstitialCooldownSec: v.pipe(v.number(), v.minValue(180)),
    interstitialAfterRewardedSec: nonNeg,
    statNowCooldownSec: nonNeg,
    skipGate: v.object({ cooldownSec: nonNeg, standSec: nonNeg, distance: nonNeg, excludeLastWall: v.boolean() }),
    eggViews: v.pipe(v.number(), v.integer(), v.minValue(1)),
    eggPauseSec: nonNeg,
    skipFirstPortal: v.boolean(),
    wheelCooldownSec: nonNeg,
  }),
  iap: v.object({ showAfterPlaySec: nonNeg }),
  daily: v.object({ resetHours: positive }),
  quests: v.object({ perDay: v.pipe(v.number(), v.integer()) }),
  review: v.object({ after: v.array(v.string()), minPlaySec: nonNeg }),
  ftue: v.object({
    freeEggPet: id,
    scriptedWaveWall: v.pipe(v.number(), v.integer(), v.minValue(1)),
    triggerDist: positive,
    spawnAhead: positive,
    warnSec: positive,
    fallbackSec: positive,
    eggHatchSec: positive,
  }),
  hints: v.object({
    moveIdleSec: positive,
    moveRepeatUntilSec: nonNeg,
    moveDoneSec: positive,
    moveMax: v.pipe(v.number(), v.integer(), v.minValue(0)),
    jumpNearDist: positive,
    shoesSec: positive,
    waveCaveMax: v.pipe(v.number(), v.integer(), v.minValue(0)),
    caughtSec: positive,
    stuckSec: positive,
    stuckDist: positive,
    stuckMax: v.pipe(v.number(), v.integer(), v.minValue(0)),
    portalIdleSec: positive,
    portalMax: v.pipe(v.number(), v.integer(), v.minValue(0)),
  }),
});

const tuningSchema = v.object({
  controller: v.object({
    baseSpeed: positive,
    maxSpeed: positive,
    accel: positive,
    decel: positive,
    airControl: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
    jumpSpeed: positive,
    gravity: positive,
    fallMult: positive,
    coyoteSec: nonNeg,
    jumpBufferSec: nonNeg,
    variableJump: v.boolean(),
    stepUp: nonNeg,
  }),
  camera: v.object({
    distance: positive,
    height: v.number(),
    pitchDeg: v.number(),
    fov: v.pipe(v.number(), v.minValue(30), v.maxValue(120)),
    fovSpeedAdd: nonNeg,
    fovSmoothSec: nonNeg,
    damping: positive,
    leadSec: nonNeg,
    autoTurnDelaySec: nonNeg,
    autoTurnRate: nonNeg,
    autoTurnConeDeg: v.pipe(v.number(), v.minValue(0), v.maxValue(180)),
    zoomMin: positive,
    zoomMax: positive,
    pitchMinDeg: v.number(),
    pitchMaxDeg: v.number(),
    mouseDegPerPx: positive,
    touchDegPerPx: positive,
    sensitivity: positive,
    shake: nonNeg,
    collisionRadius: positive,
    retreatSpeed: positive,
    hideDistance: nonNeg,
  }),
  input: v.object({
    stickRadiusFrac: v.pipe(v.number(), v.minValue(0.05), v.maxValue(0.3)),
    deadZoneFrac: v.pipe(v.number(), v.minValue(0), v.maxValue(0.5)),
    tapMaxMs: positive,
    tapMovePx: positive,
    zoomStep: positive,
    jumpButtonFrac: v.pipe(v.number(), v.minValue(0.18), v.maxValue(0.4)),
  }),
  avalanche: v.object({
    shakeStrength: nonNeg,
    rumble: nonNeg,
    fadeSec: positive,
    spawnMinFromCamp: nonNeg,
    shotTriggerDist: positive,
    shotDistance: positive,
    shotReturnSec: positive,
    noise: nonNeg,
    bodyLength: positive,
    nearDist: positive,
    caughtFormSec: nonNeg,
    caughtPopSec: nonNeg,
    ballBounce: nonNeg,
  }),
});

const segmentSchema = v.looseObject({ type: v.picklist(SEGMENT_TYPES), z: nonNeg });

const worldSchema = v.object({
  id: id,
  index: v.pipe(v.number(), v.integer(), v.minValue(1)),
  length: positive,
  width: positive,
  spawnZ: nonNeg,
  egg: id,
  stretch: positive,
  wallCount: v.pipe(v.number(), v.integer(), v.minValue(1)),
  safeZones: v.pipe(v.array(v.tuple([nonNeg, nonNeg])), v.minLength(1)),
  threat: v.object({
    intervalSec: positive,
    firstIntervalSec: positive,
    warnSec: positive,
    speed: positive,
    from: v.picklist(['aboveHero', 'end', 'start']),
    spawnAhead: positive,
    firstWaveScripted: v.boolean(),
    safeZoneZ: v.tuple([nonNeg, nonNeg]),
  }),
  zones: v.pipe(v.array(v.object({ k: v.pipe(v.number(), v.integer()), rarity: id, gift: positive, zStart: nonNeg, zEnd: nonNeg })), v.minLength(1)),
  segments: v.pipe(v.array(segmentSchema), v.minLength(1)),
  treadmillMult: positive,
});

const worldsSchema = v.object({ schema: v.literal(1), generator: v.string(), worlds: v.pipe(v.array(worldSchema), v.minLength(1)) });

const specSchema = v.object({
  schema: v.literal(1),
  campLength: positive,
  summitLength: positive,
  width: positive,
  spawnZ: nonNeg,
  threat: v.object({ spawnAhead: positive, firstIntervalSec: positive, from: v.picklist(['aboveHero', 'end', 'start']), firstWaveScripted: v.boolean() }),
  rarities: v.pipe(v.array(id), v.minLength(1)),
  mountains: v.pipe(
    v.array(
      v.object({
        id: id,
        stretch: positive,
        intervalSec: positive,
        warnSec: positive,
        speed: positive,
        egg: id,
        gifts: v.pipe(v.array(positive), v.minLength(1)),
        walls: v.pipe(v.array(v.object({ requires: positive, treadmill: positive })), v.minLength(1)),
        campTreadmill: v.optional(positive),
      }),
    ),
    v.minLength(1),
  ),
});

const skinsSchema = v.object({
  default: id,
  skins: v.pipe(
    v.array(
      v.object({
        id: id,
        unlock: v.object({ kind: v.picklist(['default', 'trophies', 'daily', 'iap', 'tier']), value: v.optional(v.union([v.number(), v.string()])) }),
        colors: v.object({ head: hex, torso: hex, armL: hex, armR: hex, legL: hex, legR: hex }),
        face: id,
        hat: v.nullable(id),
      }),
    ),
    v.minLength(1),
  ),
});

const accessoriesSchema = v.object({
  accessories: v.array(
    v.object({
      id: id,
      attach: v.picklist(['head', 'back', 'feet', 'hand']),
      parts: v.pipe(
        v.array(
          v.object({
            shape: v.picklist(['box', 'sphere', 'cylinder', 'cone']),
            size: v.tuple([positive, positive, positive]),
            pos: v.tuple([v.number(), v.number(), v.number()]),
            color: hex,
          }),
        ),
        v.minLength(1),
      ),
    }),
  ),
});

const petsSchema = v.object({
  pets: v.pipe(v.array(v.object({ id: id, rarity: id, bonus: positive, color: hex, accent: hex })), v.minLength(1)),
});

const i18nSchema = v.record(v.string(), v.pipe(v.string(), v.minLength(1, 'empty text')));

const SCHEMAS: Record<PackFile, v.GenericSchema> = {
  'game.json': gameSchema,
  'theme.json': themeSchema,
  'balance.json': balanceSchema,
  'tuning.json': tuningSchema,
  'worlds.json': worldsSchema,
  'worlds-spec.json': specSchema,
  'skins.json': skinsSchema,
  'accessories.json': accessoriesSchema,
  'pets.json': petsSchema,
  'i18n/ru.json': i18nSchema,
  'i18n/en.json': i18nSchema,
};

function schemaErrors(file: PackFile, data: unknown): string[] {
  const res = v.safeParse(SCHEMAS[file], data);
  if (res.success) return [];
  return res.issues.map((issue) => `${file}: ${v.getDotPath(issue) || '(root)'} — ${issue.message}`);
}

function placeholders(s: string): string {
  const found = s.match(/\{[a-zA-Z]+\}/g) ?? [];
  return Array.from(new Set(found)).sort().join(',');
}

/** Schema check of a single tuning.json object (the ?debug=1 Export must pass it). */
export function validateTuning(data: unknown): ValidationResult {
  const errors = schemaErrors('tuning.json', data);
  return { ok: errors.length === 0, errors };
}

export function validatePack(files: PackFiles): ValidationResult {
  const errors: string[] = [];
  for (const file of PACK_FILES) {
    if (files[file] === undefined) errors.push(`${file}: file is missing`);
    else errors.push(...schemaErrors(file, files[file]));
  }
  if (errors.length) return { ok: false, errors };

  const game = files['game.json'] as GameJson;
  const theme = files['theme.json'] as { rarity: Record<string, string>; bonus?: unknown };
  const balance = files['balance.json'] as { speedCurve: unknown; jumpCurve?: unknown; threat: unknown; ads: unknown };
  const worlds = files['worlds.json'] as WorldsJson;
  const skins = files['skins.json'] as { default: string; skins: Array<{ id: string; hat: string | null }> };
  const accessories = files['accessories.json'] as { accessories: Array<{ id: string }> };
  const ru = files['i18n/ru.json'] as Record<string, string>;
  const en = files['i18n/en.json'] as Record<string, string>;

  // Stat effect ↔ its curve (docs/01a-content.md 14.2).
  if (game.stat.effect === 'jumpPower' && !balance.jumpCurve) errors.push('balance.json: jumpCurve — required for stat.effect "jumpPower"');
  if (game.threat.bonus && !theme.bonus) errors.push('theme.json: bonus — required when game.json has threat.bonus');

  // i18n parity: same keys, same placeholders (docs/02-tech.md 5.4).
  const ruKeys = Object.keys(ru).sort();
  const enKeys = Object.keys(en).sort();
  for (const k of ruKeys) if (!(k in en)) errors.push(`i18n/en.json: ${k} — missing key (present in ru)`);
  for (const k of enKeys) if (!(k in ru)) errors.push(`i18n/ru.json: ${k} — missing key (present in en)`);
  for (const k of ruKeys) {
    if (k in en && placeholders(ru[k] ?? '') !== placeholders(en[k] ?? ''))
      errors.push(`i18n/en.json: ${k} — placeholders differ from ru (${placeholders(ru[k] ?? '')} vs ${placeholders(en[k] ?? '')})`);
  }
  if (!ru['game.title']) errors.push('i18n/ru.json: game.title — missing');

  // Skins → accessories.
  const accIds = new Set(accessories.accessories.map((a) => a.id));
  const skinIds = new Set<string>();
  for (const [i, s] of skins.skins.entries()) {
    if (skinIds.has(s.id)) errors.push(`skins.json: skins[${i}].id — duplicate "${s.id}"`);
    skinIds.add(s.id);
    if (s.hat && !accIds.has(s.hat)) errors.push(`skins.json: skins[${i}].hat — unknown accessory "${s.hat}"`);
  }
  if (!skinIds.has(skins.default)) errors.push(`skins.json: default — unknown skin "${skins.default}"`);

  // The free egg of the first minute hatches a pet from pets.json (docs/01-gdd.md 6.2); its rarity has a colour.
  const pets = files['pets.json'] as { pets: Array<{ id: string; rarity: string }> };
  const freePet = (files['balance.json'] as { ftue: { freeEggPet: string } }).ftue.freeEggPet;
  if (!pets.pets.some((p) => p.id === freePet)) errors.push(`balance.json: ftue.freeEggPet — unknown pet "${freePet}" (pets.json)`);
  for (const [i, p] of pets.pets.entries()) if (!theme.rarity[p.rarity]) errors.push(`pets.json: pets[${i}].rarity — no colour "${p.rarity}" in theme.json rarity`);

  // Worlds: structure of the mountain template, then reachability by the controller physics (docs/02-tech.md 5.4).
  errors.push(...validateWorlds(worlds, theme.rarity));
  if (errors.length === 0) errors.push(...validateReachability(worlds, files['tuning.json'] as TuningJson));
  if (errors.length === 0) {
    const tuning = files['tuning.json'] as TuningJson;
    const curve = { ...(balance.speedCurve as Curve), base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
    const speedAt = (stat: number): number => (game.stat.effect === 'moveSpeed' ? moveSpeed(stat, curve) : tuning.controller.baseSpeed);
    errors.push(...validateFairness(worlds, speedAt));
  }

  // Remote flags: every path resolves to a number or boolean inside its range (docs/02-tech.md 11.11).
  if (game.flags) {
    const rootObj: Record<string, unknown> = { game, balance, worlds: Object.fromEntries(worlds.worlds.map((w) => [String(w.index), w])) };
    for (const [name, flag] of Object.entries(game.flags)) {
      const value = resolvePath(rootObj, flag.path);
      if (value === undefined) {
        errors.push(`game.json: flags.${name}.path — "${flag.path}" does not exist`);
        continue;
      }
      if (typeof value === 'number') {
        if (flag.min !== undefined && value < flag.min) errors.push(`game.json: flags.${name} — default ${value} is below min ${flag.min}`);
        if (flag.max !== undefined && value > flag.max) errors.push(`game.json: flags.${name} — default ${value} is above max ${flag.max}`);
      } else if (typeof value === 'boolean') {
        if (flag.values && !flag.values.includes(String(value))) errors.push(`game.json: flags.${name} — default ${value} not in values`);
      } else {
        errors.push(`game.json: flags.${name}.path — "${flag.path}" is not a number or boolean`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function resolvePath(root: Record<string, unknown>, path: string): unknown {
  let cur: unknown = root;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function num(seg: Segment, key: string): number {
  const val = seg[key];
  return typeof val === 'number' ? val : NaN;
}

export function validateWorlds(worlds: WorldsJson, rarityColors: Record<string, string>): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  let lastRequires = 0;
  let expectIndex = 1;
  for (const [wi, w] of worlds.worlds.entries()) {
    const at = `worlds.json: worlds[${wi}] (${w.id})`;
    if (ids.has(w.id)) errors.push(`${at}: id — duplicate`);
    ids.add(w.id);
    if (w.index !== expectIndex) errors.push(`${at}: index — expected ${expectIndex}, got ${w.index}`);
    expectIndex++;
    for (const [zi, zone] of w.zones.entries()) {
      if (!(zone.rarity in rarityColors)) errors.push(`${at}: zones[${zi}].rarity — "${zone.rarity}" has no color in theme.json`);
      if (zone.zEnd <= zone.zStart || zone.zEnd > w.length) errors.push(`${at}: zones[${zi}] — bad range ${zone.zStart}–${zone.zEnd}`);
    }
    for (const [si, s] of w.segments.entries()) {
      if (s.z < 0 || s.z > w.length) errors.push(`${at}: segments[${si}] (${s.type}) — z=${s.z} outside 0–${w.length}`);
    }
    for (const [zi, sz] of w.safeZones.entries()) {
      if (sz[0] >= sz[1] || sz[1] > w.length) errors.push(`${at}: safeZones[${zi}] — bad range ${sz[0]}–${sz[1]}`);
    }
    const gates = w.segments.filter((s) => s.type === 'gate').sort((a, b) => a.z - b.z);
    const niches = w.segments.filter((s) => s.type === 'niche');
    const checkpoints = w.segments.filter((s) => s.type === 'checkpoint');
    if (gates.length !== w.wallCount) errors.push(`${at}: gates — expected ${w.wallCount}, found ${gates.length}`);
    for (const [gi, g] of gates.entries()) {
      const req = num(g, 'requires');
      if (!(req > lastRequires)) errors.push(`${at}: gate ${gi + 1} — requires ${req} must grow (previous ${lastRequires})`);
      lastRequires = req;
      const zone = Math.ceil((gi + 1) / 2);
      if (!w.zones.some((z) => z.k === zone)) errors.push(`${at}: gate ${gi + 1} — zone ${zone} is not described`);
    }
    // One cave with a treadmill in every stretch (docs/01-gdd.md 5.2), caves between consecutive gates.
    const camp = w.safeZones[0]?.[1] ?? 0;
    for (let i = 1; i <= gates.length; i++) {
      const zStart = i === 1 ? camp : (gates[i - 2] as Segment).z;
      const zEnd = (gates[i - 1] as Segment).z;
      const inStretch = niches.filter((n) => n.z > zStart && n.z < zEnd);
      if (inStretch.length !== 1) errors.push(`${at}: stretch ${i} — expected 1 niche between z ${zStart} and ${zEnd}, found ${inStretch.length}`);
      for (const n of inStretch) {
        if (!(num(n, 'treadmill') > 0)) errors.push(`${at}: niche at z=${n.z} — treadmill multiplier must be > 0`);
        if (!(num(n, 'depth') >= 3) || !(num(n, 'length') >= 6)) errors.push(`${at}: niche at z=${n.z} — depth ≥ 3 and length ≥ 6 (docs/02-tech.md 8.2)`);
      }
      if (i >= 2 && !checkpoints.some((c) => c.z > zStart && c.z < zEnd)) errors.push(`${at}: stretch ${i} — no checkpoint behind gate ${i - 1}`);
    }
    if (!w.segments.some((s) => s.type === 'portal')) errors.push(`${at}: segments — no portal`);
    if (!w.segments.some((s) => s.type === 'chest')) errors.push(`${at}: segments — no chest`);
    if (!w.segments.some((s) => s.type === 'treadmill' && s.z < camp)) errors.push(`${at}: segments — no treadmill in the camp`);
    if (!w.segments.some((s) => s.type === 'eggStand' && s.z < camp)) errors.push(`${at}: segments — no egg stand in the camp`);
  }
  return errors;
}

export type { World };

/** Jump height from the controller constants: v² / (2g) (docs/02-tech.md 6.1: 6.4 units at 50 and 196.2). */
export function jumpHeight(tuning: TuningJson): number {
  const c = tuning.controller;
  return (c.jumpSpeed * c.jumpSpeed) / (2 * c.gravity);
}

/** Flight distance at run speed `v`: v × 2 × v0 / g. */
export function jumpDistance(tuning: TuningJson, runSpeed: number): number {
  const c = tuning.controller;
  return (runSpeed * 2 * c.jumpSpeed) / c.gravity;
}

export const REACH_MARGIN = 0.8;

/**
 * Reachability (docs/02-tech.md 5.4, M1-07): every ledge is lower than 80% of the jump height, every ramp is
 * walkable (normal.y ≥ 0.6), every step fits the step-up, every gap is shorter than 60% of the jump at the base
 * speed (the minimum speed of any stretch), and the cave floors sit at the track height.
 */
export function validateReachability(worlds: WorldsJson, tuning: TuningJson): string[] {
  const errors: string[] = [];
  const hJump = jumpHeight(tuning) * REACH_MARGIN;
  const dJump = jumpDistance(tuning, tuning.controller.baseSpeed) * 0.6;
  const stepUp = tuning.controller.stepUp;
  for (const [wi, w] of worlds.worlds.entries()) {
    const at = `worlds.json: worlds[${wi}] (${w.id})`;
    let level;
    try {
      level = buildLevel(w);
    } catch (err) {
      errors.push(`${at}: builder failed — ${(err as Error).message}`);
      continue;
    }
    for (const r of level.ramps) {
      const len = r.z1 - r.z0;
      const rise = r.y1 - r.y0;
      const ny = len / Math.hypot(len, rise);
      if (ny < 0.6) errors.push(`${at}: ramp at z=${r.z0} — too steep (normal.y ${ny.toFixed(2)} < 0.6)`);
    }
    for (const b of level.boxes) {
      if (b.kind !== 'ledge') continue;
      const h = b.max[1] - b.min[1];
      if (h > hJump) errors.push(`${at}: ledge at z=${b.min[2] + 2} — height ${h} above ${hJump.toFixed(2)} (80% of the jump)`);
    }
    for (const s of w.segments) {
      if (s.type === 'steps') {
        const h = typeof s['stepHeight'] === 'number' ? (s['stepHeight'] as number) : 0;
        if (h > stepUp) errors.push(`${at}: steps at z=${s.z} — step ${h} above stepUp ${stepUp}`);
      }
      if (s.type === 'gap') {
        const len = typeof s['length'] === 'number' ? (s['length'] as number) : 0;
        if (len > dJump) errors.push(`${at}: gap at z=${s.z} — ${len} units longer than ${dJump.toFixed(1)} (60% of the jump at ${tuning.controller.baseSpeed})`);
      }
    }
    for (const n of level.niches) {
      const floorY = level.floorYAt(n.z);
      if (Math.abs(floorY - n.y) > 0.01) errors.push(`${at}: niche at z=${n.z} — floor ${n.y} differs from the track ${floorY}`);
    }
    // Consecutive floors and ramps must connect without a hole or a step above stepUp.
    const pieces = [
      ...level.ramps.map((r) => ({ z0: r.z0, z1: r.z1, y0: r.y0, y1: r.y1 })),
      ...w.segments.filter((s) => s.type === 'floor').map((s) => ({ z0: s.z, z1: s.z + (s['length'] as number), y0: s['y'] as number, y1: s['y'] as number })),
    ].sort((a, b) => a.z0 - b.z0);
    for (let i = 1; i < pieces.length; i++) {
      const a = pieces[i - 1]!;
      const b = pieces[i]!;
      if (b.z0 - a.z1 > 0.01) errors.push(`${at}: hole in the track between z=${a.z1} and z=${b.z0}`);
      if (Math.abs(b.y0 - a.y1) > stepUp) errors.push(`${at}: step of ${Math.abs(b.y0 - a.y1)} at z=${b.z0} above stepUp ${stepUp}`);
    }
  }
  return errors;
}

/** Share of warnSec the run to shelter may take (docs/02-tech.md 5.4; docs/01-gdd.md 4.3). */
export const FAIRNESS_SHARE = 0.8;

export interface FairnessRow {
  world: string;
  /** Worst run to shelter on the mountain, seconds, and where it starts. */
  worstSec: number;
  worstZ: number;
  limitSec: number;
}

/**
 * Cave fairness (docs/02-tech.md 5.4, M2-03): from every point of the slope the hero can stand on, the nearest
 * cave or safe zone is reachable within warnSec × 0.8 at the minimum speed of that stretch — the speed of the
 * stat that opened the previous wall (stretch 1: stat 0). Newbie bonus seconds are not counted. The path is
 * measured conservatively: along the track to the cave mouth plus the whole track width across. Reachable
 * caves: the one of the hero's stretch (in front of its closed wall) and the one behind (the wall passed is open).
 */
export function fairnessReport(worlds: WorldsJson, speedAt: (stat: number) => number): FairnessRow[] {
  return worlds.worlds.map((w) => {
    const camp = w.safeZones[0]?.[1] ?? 0;
    const gates = w.segments.filter((s) => s.type === 'gate').sort((a, b) => a.z - b.z);
    const niches = w.segments.filter((s) => s.type === 'niche');
    const gateZ = (k: number): number => (k < 1 ? camp : (gates[k - 1] as Segment).z);
    let worstSec = 0;
    let worstZ = 0;
    for (let i = 1; i <= gates.length; i++) {
      const speed = speedAt(i === 1 ? 0 : num(gates[i - 2] as Segment, 'requires'));
      const shelters = niches
        .filter((n) => n.z > gateZ(i - 2) && n.z < gateZ(i))
        .map((n) => ({ z0: n.z - num(n, 'length') / 2, z1: n.z + num(n, 'length') / 2, across: w.width }));
      if (i === 1) shelters.push({ z0: 0, z1: camp, across: 0 });
      for (let z = gateZ(i - 1); z <= gateZ(i); z += 1) {
        let best = Infinity;
        for (const sh of shelters) {
          const dz = z < sh.z0 ? sh.z0 - z : z > sh.z1 ? z - sh.z1 : 0;
          best = Math.min(best, Math.hypot(dz, sh.across));
        }
        if (best / speed > worstSec) {
          worstSec = best / speed;
          worstZ = z;
        }
      }
    }
    return { world: w.id, worstSec, worstZ, limitSec: w.threat.warnSec * FAIRNESS_SHARE };
  });
}

export function validateFairness(worlds: WorldsJson, speedAt: (stat: number) => number): string[] {
  return fairnessReport(worlds, speedAt)
    .map((r, wi) => ({ r, wi }))
    .filter(({ r }) => r.worstSec > r.limitSec)
    .map(
      ({ r, wi }) =>
        `worlds.json: worlds[${wi}] (${r.world}): cave fairness — from z=${r.worstZ} the nearest cave or safe zone is ${r.worstSec.toFixed(2)} s away, above warnSec × ${FAIRNESS_SHARE} = ${r.limitSec.toFixed(2)} s`,
    );
}
