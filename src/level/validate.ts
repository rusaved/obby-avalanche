/**
 * Content validator (docs/02-tech.md 5.4): valibot schemas per file, cross-file links, enums, i18n parity.
 * Pure: takes the parsed files, returns messages "file: path — what is wrong". Reachability by the controller
 * physics (M1) and cave fairness against warnSec (M2-03).
 */
import * as v from 'valibot';
import type { AurasJson, BalanceJson, BotsJson, Curve, EggsJson, TrailsJson, GameJson, Reward, Segment, SkinsJson, TuningJson, World, WorldsJson, WorldsSpecJson } from '../content/types.ts';
import { summitTrophies } from '../sim/economy.ts';
import { LEADERBOARD_SCORES } from '../meta/trophies.ts';
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
  'eggs.json',
  'trails.json',
  'auras.json',
  'sfx.json',
  'bots.json',
  'i18n/ru.json',
  'i18n/en.json',
] as const;

export type PackFile = (typeof PACK_FILES)[number];

/** Texts of the rebirth screen, the «All mountains cleared!» screen and the tier toast (docs/01a-content.md 11.3, 11.5). */
export const REBIRTH_KEYS = [
  'btn.rebirth', 'rebirth.title', 'rebirth.toTier', 'rebirth.resets', 'rebirth.resetList', 'rebirth.keeps', 'rebirth.keepList',
  'rebirth.gets', 'rebirth.step', 'rebirth.moreTrophies', 'rebirth.higher', 'rebirth.reward', 'rebirth.spendHint',
  'rebirth.locked', 'rebirth.progress', 'allDone.title', 'allDone.text', 'btn.later', 'btn.stay', 'btn.doRebirth',
  'btn.toEggs', 'toast.tier',
] as const;
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
  // The leaderboard scores by a whole counter of the save (trophies over all time), never by the stat (docs/01-gdd.md 7.9, 8.4).
  leaderboard: v.nullable(v.object({ name: v.string(), score: v.picklist(LEADERBOARD_SCORES) })),
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

/** Quest kinds the game counts (docs/01a-content.md 10); a new one needs its counter in src/app/quests-view.ts. */
const QUEST_IDS = ['q_walls', 'q_caves', 'q_gifts', 'q_steps', 'q_treadmill', 'q_egg', 'q_shoes', 'q_summit', 'q_gold'] as const;
const rewardSchema = v.variant('kind', [
  v.object({ kind: v.literal('coins'), gifts: positive }),
  v.object({ kind: v.literal('trophies'), n: positive }),
  v.object({ kind: v.literal('boost'), min: positive }),
  v.object({ kind: v.literal('egg'), id: v.string() }),
  v.object({ kind: v.literal('skin'), id: v.string() }),
  v.object({ kind: v.literal('wings'), id: v.string() }),
  v.object({ kind: v.literal('pet'), id: v.string(), wings: v.optional(v.string()) }),
]);
const dailyRewardSchema = v.intersect([rewardSchema, v.object({ alt: v.optional(rewardSchema) })]);

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
  boost: v.object({ x2Sec: positive, x2Mult: positive, statNowSec: positive }),
  caught: v.object({ rollSec: positive, maxSec: v.pipe(v.number(), v.maxValue(2)) }),
  threat: v.object({ newbieWaves: v.object({ count: v.pipe(v.number(), v.integer(), v.minValue(0)), warnBonusSec: nonNeg }), resumeSec: positive }),
  niche: v.object({ graceDist: nonNeg, graceMoving: nonNeg }),
  ui: v.object({ unlockMenusSec: nonNeg, unlockTimeRewardsSec: nonNeg, menuStepSec: nonNeg, statMilestones: v.array(v.number()) }),
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
  iap: v.object({ showAfterPlaySec: nonNeg, vipMult: positive }),
  daily: v.object({ resetHours: positive, days: v.pipe(v.array(dailyRewardSchema), v.length(7)) }),
  quests: v.object({
    perDay: v.pipe(v.number(), v.integer(), v.minValue(1)),
    farWalls: v.pipe(v.number(), v.integer(), v.minValue(1)),
    reward: v.array(rewardSchema),
    bonus: v.array(rewardSchema),
    list: v.pipe(v.array(v.object({ id: v.picklist(QUEST_IDS), n: positive })), v.minLength(1)),
  }),
  timeRewards: v.pipe(v.array(v.object({ min: positive, reward: rewardSchema })), v.minLength(1)),
  wheel: v.object({ sectors: v.pipe(v.array(rewardSchema), v.minLength(2)) }),
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
  hud: v.object({ gainHeight: v.number(), gainSide: v.pipe(v.number(), v.minValue(-0.5), v.maxValue(0.5)) }),
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
    minDistance: nonNeg,
    raiseMaxDeg: v.pipe(v.number(), v.minValue(0), v.maxValue(85)),
    raiseStepDeg: positive,
    raiseReturnRate: positive,
    occludeRadius: nonNeg,
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
    caveShot: v.object({ pos: v.tuple([v.number(), v.number(), v.number()]), look: v.tuple([v.number(), v.number(), v.number()]), fov: v.pipe(v.number(), v.minValue(30), v.maxValue(120)) }),
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
  threat: v.object({
    spawnAhead: positive,
    firstIntervalSec: positive,
    laterFirstIntervalSec: v.optional(v.tuple([positive, positive])),
    from: v.picklist(['aboveHero', 'end', 'start']),
    firstWaveScripted: v.boolean(),
  }),
  rarities: v.pipe(v.array(id), v.minLength(1)),
  mountains: v.pipe(
    v.array(
      v.object({
        id: id,
        stretch: positive,
        intervalSec: positive,
        firstIntervalSec: v.optional(positive),
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
  // Wings (docs/01-gdd.md 7.4, M3-04b): looks only, an accessory of the same id on the back.
  wings: v.optional(v.array(v.object({ id: id, unlock: v.object({ kind: v.picklist(['default', 'trophies', 'daily', 'iap', 'tier']), value: v.optional(v.union([v.number(), v.string()])) }) }))),
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

/** eggs.json (docs/02-tech.md 5.1, docs/01a-content.md 6): price at tier 0 and the pool of pets with chances. */
const eggsSchema = v.object({
  eggs: v.array(
    v.object({ id: id, price: positive, pool: v.pipe(v.array(v.object({ pet: id, chance: positive })), v.minLength(1)) }),
  ),
});

/** trails.json, auras.json (docs/01a-content.md 7): step multiplier ≥ 1, price in trophies, colour. */
const cosmetic = v.object({ id: id, mult: v.pipe(v.number(), v.minValue(1)), price: v.pipe(v.number(), v.integer(), v.minValue(1)), color: hex });
const trailsSchema = v.object({ trails: v.array(cosmetic) });
const aurasSchema = v.object({ auras: v.array(cosmetic) });

/** ZzFX takes up to 21 numbers (docs/02-tech.md 10). */
const sfxSchema = v.record(name, v.pipe(v.array(v.number()), v.minLength(1), v.maxLength(21)));

const range = v.pipe(
  v.tuple([nonNeg, nonNeg]),
  v.check(([a, b]) => a <= b, 'expected [min, max] with min ≤ max'),
);
const count = v.pipe(v.number(), v.integer(), v.minValue(0));
const botsSchema = v.object({
  count: v.object({ high: count, medium: count, low: count }),
  showNames: v.boolean(),
  names: v.array(v.pipe(v.string(), v.regex(/^bot\.[a-z0-9]+$/, 'expected an i18n key bot.*'))),
  palette: v.object({
    jackets: v.pipe(v.array(hex), v.minLength(1)),
    pants: v.pipe(v.array(hex), v.minLength(1)),
    hats: v.pipe(v.array(hex), v.minLength(1)),
    heads: v.pipe(v.array(hex), v.minLength(1)),
    hat: id,
    faces: v.pipe(v.array(id), v.minLength(1)),
  }),
  speedFactor: range,
  treadmillSec: range,
  hideChance: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
  leashWalls: v.pipe(v.number(), v.integer(), v.minValue(1)),
  spawnCampMax: count,
  awaySec: range,
  campReleaseSec: range,
  label: v.object({ nearDist: positive, fadeDist: nonNeg }),
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
  'eggs.json': eggsSchema,
  'trails.json': trailsSchema,
  'auras.json': aurasSchema,
  'sfx.json': sfxSchema,
  'bots.json': botsSchema,
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
  // Skins and wings (M3-04b): a price in trophies is a number, a tier or a calendar day too; wings are back accessories;
  // names skin.<id> and wings.<id> in both languages.
  const backIds = new Set((accessories.accessories as Array<{ id: string; attach?: string }>).filter((a) => a.attach === 'back').map((a) => a.id));
  const looks = [
    ...(skins as SkinsJson).skins.map((x) => ({ key: `skin.${x.id}`, unlock: x.unlock, wings: false, id: x.id })),
    ...((skins as SkinsJson).wings ?? []).map((x) => ({ key: `wings.${x.id}`, unlock: x.unlock, wings: true, id: x.id })),
  ];
  const wingIds = new Set<string>();
  for (const l of looks) {
    if (['trophies', 'daily', 'tier'].includes(l.unlock.kind) && typeof l.unlock.value !== 'number') errors.push(`skins.json: ${l.id} — unlock ${l.unlock.kind} needs a number value`);
    if (l.wings) {
      if (wingIds.has(l.id)) errors.push(`skins.json: wings ${l.id} — duplicate id`);
      wingIds.add(l.id);
      if (!backIds.has(l.id)) errors.push(`skins.json: wings ${l.id} — no back accessory of that id (accessories.json)`);
    }
    for (const [file, dict] of [['i18n/ru.json', ru], ['i18n/en.json', en]] as const) if (!dict[l.key]) errors.push(`${file}: ${l.key} — missing (skins.json)`);
  }

  // Round numbers of the stat (docs/01-gdd.md 10.4, Q-023): a growing list from 1000 up, and the toast text in both languages.
  const milestones = (files['balance.json'] as { ui: { statMilestones: number[] } }).ui.statMilestones;
  milestones.forEach((m, i) => {
    if (m < 1000) errors.push(`balance.json: ui.statMilestones[${i}] — ${m} is below 1000`);
    if (i > 0 && m <= (milestones[i - 1] ?? 0)) errors.push(`balance.json: ui.statMilestones[${i}] — ${m} must grow`);
  });
  if (milestones.length > 0) {
    for (const [file, dict] of [['i18n/ru.json', ru], ['i18n/en.json', en]] as const) {
      if (!dict['toast.statMilestone']) errors.push(`${file}: toast.statMilestone — missing (balance.json has ui.statMilestones)`);
    }
  }

  // Rebirth (docs/01-gdd.md 7.5, M3-06): «summitWorldN» names a mountain of worlds.json; the screen texts in both languages.
  const unlock = (files['balance.json'] as Pick<BalanceJson, 'rebirth'>).rebirth.unlock;
  const goal = /^summitWorld(\d+)$/.exec(unlock);
  if (!goal || Number(goal[1]) < 1 || Number(goal[1]) > worlds.worlds.length) errors.push(`balance.json: rebirth.unlock — "${unlock}" is not summitWorldN of a mountain in worlds.json`);
  for (const [file, dict] of [['i18n/ru.json', ru], ['i18n/en.json', en]] as const)
    for (const key of REBIRTH_KEYS) if (!dict[key]) errors.push(`${file}: ${key} — missing (rebirth screen, docs/01-gdd.md 7.5)`);

  // Trophies for a summit (docs/01-gdd.md 8.1): the formula of the data gives a whole positive number.
  const trophies = files['balance.json'] as Pick<BalanceJson, 'trophies'>;
  try {
    for (const [world, tier] of [[1, 0], [5, 9]] as const) {
      const n = summitTrophies(trophies, world, tier);
      if (!Number.isInteger(n) || n < 1) errors.push(`balance.json: trophies.perSummit — ${n} for world ${world}, tier ${tier} (a whole number ≥ 1)`);
    }
  } catch (err) {
    errors.push(`balance.json: trophies.perSummit — ${(err as Error).message}`);
  }

  // The free egg of the first minute hatches a pet from pets.json (docs/01-gdd.md 6.2); its rarity has a colour.
  const pets = files['pets.json'] as { pets: Array<{ id: string; rarity: string }> };
  const freePet = (files['balance.json'] as { ftue: { freeEggPet: string } }).ftue.freeEggPet;
  if (!pets.pets.some((p) => p.id === freePet)) errors.push(`balance.json: ftue.freeEggPet — unknown pet "${freePet}" (pets.json)`);
  for (const [i, p] of pets.pets.entries()) if (!theme.rarity[p.rarity]) errors.push(`pets.json: pets[${i}].rarity — no colour "${p.rarity}" in theme.json rarity`);

  // Eggs (docs/01a-content.md 6): pets of the pool exist, chances sum to 1, every mountain's egg is in eggs.json.
  const eggs = files['eggs.json'] as EggsJson;
  const petIds = new Set(pets.pets.map((p) => p.id));
  for (const [i, e] of eggs.eggs.entries()) {
    for (const [j, slot] of e.pool.entries()) if (!petIds.has(slot.pet)) errors.push(`eggs.json: eggs[${i}].pool[${j}].pet — unknown pet "${slot.pet}" (pets.json)`);
    const sum = e.pool.reduce((a, slot) => a + slot.chance, 0);
    if (Math.abs(sum - 1) > 1e-9) errors.push(`eggs.json: eggs[${i}].pool — chances sum to ${sum}, expected 1`);
  }
  for (const w of worlds.worlds) if (!eggs.eggs.some((e) => e.id === w.egg)) errors.push(`worlds.json: worlds[${w.index - 1}].egg — unknown egg "${w.egg}" (eggs.json)`);
  // Rewards of the calendar, quests, time rewards and the wheel (docs/01a-content.md 10): every id exists in its file;
  // the calendar cards have their texts daily.r<N> (and daily.r<N>alt for a day with `alt`) in both languages.
  const bal = files['balance.json'] as BalanceJson;
  const skinData = files['skins.json'] as SkinsJson;
  const rewardIds: Record<string, Set<string>> = {
    egg: new Set([...eggs.eggs.map((e) => e.id), 'best']),
    skin: new Set(skinData.skins.map((x) => x.id)),
    wings: new Set((skinData.wings ?? []).map((x) => x.id)),
    pet: petIds,
  };
  const checkReward = (where: string, r: Reward): void => {
    if ('id' in r && !rewardIds[r.kind]?.has(r.id)) errors.push(`balance.json: ${where} — unknown ${r.kind} "${r.id}"`);
    if (r.kind === 'pet' && r.wings && !rewardIds['wings']!.has(r.wings)) errors.push(`balance.json: ${where} — unknown wings "${r.wings}"`);
  };
  bal.daily.days.forEach((day, i) => {
    checkReward(`daily.days[${i}]`, day);
    if (day.alt) checkReward(`daily.days[${i}].alt`, day.alt);
    for (const key of [`daily.r${i + 1}`, ...(day.alt ? [`daily.r${i + 1}alt`] : [])]) {
      for (const [file, dict] of [['i18n/ru.json', ru], ['i18n/en.json', en]] as const) if (!dict[key]) errors.push(`${file}: ${key} — missing (balance.json daily.days)`);
    }
  });
  bal.quests.reward.forEach((r, i) => checkReward(`quests.reward[${i}]`, r));
  bal.quests.bonus.forEach((r, i) => checkReward(`quests.bonus[${i}]`, r));
  bal.timeRewards.forEach((x, i) => checkReward(`timeRewards[${i}].reward`, x.reward));
  bal.wheel.sectors.forEach((r, i) => checkReward(`wheel.sectors[${i}]`, r));
  if (new Set(bal.quests.list.map((q) => q.id)).size !== bal.quests.list.length) errors.push('balance.json: quests.list — duplicate id');
  const questPool = bal.quests.list.filter((q) => q.id !== 'q_gold' || !!game.threat.bonus).length;
  if (questPool < bal.quests.perDay) errors.push(`balance.json: quests.perDay — ${bal.quests.perDay} of only ${questPool} quests`);
  for (const [file, dict] of [['i18n/ru.json', ru], ['i18n/en.json', en]] as const) {
    for (const q of bal.quests.list) if (!dict[`quests.${q.id}`]) errors.push(`${file}: quests.${q.id} — missing (balance.json quests.list)`);
    for (const key of ['btn.quests', 'btn.timeRewards', 'btn.spin', 'quests.title', 'quests.bonus', 'quests.new', 'time.title', 'time.at', 'time.played', 'wheel.title', 'wheel.free', 'wheel.next', 'reward.coins', 'reward.trophies', 'reward.boost', 'reward.bestEgg']) {
      if (!dict[key]) errors.push(`${file}: ${key} — missing (quests, time rewards, wheel, docs/01-gdd.md 7.7–7.13)`);
    }
  }
  for (const key of ['daily.title', 'daily.day', 'daily.next', 'daily.soon', 'btn.daily', 'btn.claim', 'toast.reward', 'toast.tomorrow', 'toast.boostOn']) {
    for (const [file, dict] of [['i18n/ru.json', ru], ['i18n/en.json', en]] as const) if (!dict[key]) errors.push(`${file}: ${key} — missing (calendar, docs/01-gdd.md 7.6)`);
  }
  // Trails and auras (docs/01a-content.md 7): unique ids, names in both languages (keys trail.<id>, aura.<id>).
  const cosmetics = [
    ...(files['trails.json'] as TrailsJson).trails.map((x) => ({ file: 'trails.json', key: `trail.${x.id}`, id: x.id })),
    ...(files['auras.json'] as AurasJson).auras.map((x) => ({ file: 'auras.json', key: `aura.${x.id}`, id: x.id })),
  ];
  const seen = new Set<string>();
  for (const c of cosmetics) {
    if (seen.has(c.id)) errors.push(`${c.file}: ${c.id} — duplicate id`);
    seen.add(c.id);
    for (const [file, dict] of [['i18n/ru.json', ru], ['i18n/en.json', en]] as const) if (!dict[c.key]) errors.push(`${file}: ${c.key} — missing (${c.file})`);
  }
  // Collection counter (docs/01-gdd.md 7.2, Q-024, M3-13): the hatch toast and the «Pets» button texts, egg names.
  for (const [file, dict] of [['i18n/ru.json', ru], ['i18n/en.json', en]] as const) {
    for (const key of ['toast.hatchCount', 'btn.petsCount', ...eggs.eggs.map((e) => `egg.${e.id}`)]) if (!dict[key]) errors.push(`${file}: ${key} — missing (eggs.json, docs/01-gdd.md 7.2)`);
  }

  // Bots (docs/01-gdd.md 7.12; docs/03, 4.3): names are i18n keys with texts in both languages, character names
  // without digits, enough of them for every bot on a mountain to have its own; a palette without the hero's look.
  const bots = files['bots.json'] as BotsJson;
  const most = Math.max(bots.count.high, bots.count.medium, bots.count.low);
  if (new Set(bots.names).size !== bots.names.length) errors.push('bots.json: names — duplicate key');
  if (bots.names.length < most) errors.push(`bots.json: names — ${bots.names.length} names for ${most} bots (names on a mountain do not repeat)`);
  for (const key of bots.names) {
    for (const [file, dict] of [['i18n/ru.json', ru], ['i18n/en.json', en]] as const) {
      const text = dict[key];
      if (!text) errors.push(`${file}: ${key} — missing (bots.json names)`);
      else if (/\d/.test(text)) errors.push(`${file}: ${key} — bot name "${text}" has digits`);
    }
  }
  if (!accIds.has(bots.palette.hat)) errors.push(`bots.json: palette.hat — unknown accessory "${bots.palette.hat}"`);
  const heroSkin = (files['skins.json'] as SkinsJson).skins.find((x) => x.id === skins.default);
  if (heroSkin && bots.palette.jackets.some((c) => c.toLowerCase() === heroSkin.colors.torso.toLowerCase()))
    errors.push('bots.json: palette.jackets — has the hero\'s torso colour (bots never wear the default look)');

  // Worlds: structure of the mountain template, then reachability by the controller physics (docs/02-tech.md 5.4).
  errors.push(...validateWorlds(worlds, theme.rarity));
  if (errors.length === 0) errors.push(...validateReachability(worlds, files['tuning.json'] as TuningJson));
  if (errors.length === 0) {
    const tuning = files['tuning.json'] as TuningJson;
    const curve = { ...(balance.speedCurve as Curve), base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
    const speedAt = (stat: number): number => (game.stat.effect === 'moveSpeed' ? moveSpeed(stat, curve) : tuning.controller.baseSpeed);
    errors.push(...validateFairness(worlds, speedAt));
    if (game.threat.bonus) errors.push(...validateGoldFairness(worlds, speedAt, game.threat.bonus.distMax));
  }
  // The count of 01a against the generated mountains (M3-05): after fairness, so a broken number still gets its seconds named.
  errors.push(...validateContentCount(worlds, files['worlds-spec.json'] as WorldsSpecJson, (files['balance.json'] as BalanceJson).gifts.perZone));

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

/**
 * Content count (docs/01-gdd.md 5.4, GDD-14; M3-05): worlds.json carries every mountain of worlds-spec.json (the tables
 * of docs/01a-content.md 2–4) — the same walls with the same numbers, a cave with the same treadmill before each wall,
 * `gifts.perZone` gift places in every zone, the threat numbers of the mountain, and portals chained 1 → 2 → … → last.
 */
export function validateContentCount(worlds: WorldsJson, spec: WorldsSpecJson, perZone: number): string[] {
  const errors: string[] = [];
  if (worlds.worlds.length !== spec.mountains.length) errors.push(`worlds.json: worlds — ${worlds.worlds.length} mountains, worlds-spec.json has ${spec.mountains.length} (npm run gen:worlds)`);
  for (const [mi, m] of spec.mountains.entries()) {
    const w = worlds.worlds[mi];
    if (!w) continue;
    const at = `worlds.json: worlds[${mi}] (${w.id})`;
    if (w.id !== m.id) errors.push(`${at}: id — worlds-spec.json has "${m.id}"`);
    const gates = w.segments.filter((s) => s.type === 'gate').sort((a, b) => a.z - b.z);
    const niches = w.segments.filter((s) => s.type === 'niche').sort((a, b) => a.z - b.z);
    if (gates.length !== m.walls.length) errors.push(`${at}: walls — ${gates.length}, worlds-spec.json has ${m.walls.length}`);
    if (niches.length !== m.walls.length) errors.push(`${at}: caves — ${niches.length}, expected one per wall (${m.walls.length})`);
    for (const [i, wall] of m.walls.entries()) {
      const g = gates[i];
      const n = niches[i];
      if (g && num(g, 'requires') !== wall.requires) errors.push(`${at}: wall ${i + 1} — requires ${num(g, 'requires')}, worlds-spec.json has ${wall.requires}`);
      if (n && num(n, 'treadmill') !== wall.treadmill) errors.push(`${at}: cave ${i + 1} — treadmill ×${num(n, 'treadmill')}, worlds-spec.json has ×${wall.treadmill}`);
    }
    const zoneCount = Math.ceil(m.walls.length / 2);
    if (w.zones.length !== zoneCount) errors.push(`${at}: zones — ${w.zones.length}, expected ${zoneCount} (two stretches each)`);
    const gifts = w.segments.filter((s) => s.type === 'gift');
    for (const zone of w.zones) {
      // A zone is two stretches; the last one of an odd count has one, and half the places (docs/01a-content.md 4).
      const want = (perZone * Math.min(2, m.walls.length - 2 * (zone.k - 1))) / 2;
      const inZone = gifts.filter((s) => num(s, 'zone') === zone.k);
      if (inZone.length !== want) errors.push(`${at}: zone ${zone.k} — ${inZone.length} gift places, expected ${want} (balance.json gifts.perZone ${perZone})`);
      if (inZone.some((s) => num(s, 'coins') !== m.gifts[zone.k - 1])) errors.push(`${at}: zone ${zone.k} — gift coins differ from worlds-spec.json (${m.gifts[zone.k - 1]})`);
    }
    for (const key of ['intervalSec', 'warnSec', 'speed'] as const)
      if (w.threat[key] !== m[key]) errors.push(`${at}: threat.${key} — ${w.threat[key]}, worlds-spec.json has ${m[key]}`);
    const first = m.firstIntervalSec ?? spec.threat.firstIntervalSec;
    if (w.threat.firstIntervalSec !== first) errors.push(`${at}: threat.firstIntervalSec — ${w.threat.firstIntervalSec}, worlds-spec.json has ${first}`);
    const portal = w.segments.find((s) => s.type === 'portal');
    const next = mi + 1 < spec.mountains.length ? mi + 2 : null;
    if (portal && (portal['next'] ?? null) !== next) errors.push(`${at}: portal — leads to ${String(portal['next'])}, expected ${String(next)}`);
  }
  errors.push(...validateFirstIntervals(worlds, spec));
  return errors;
}

/**
 * First avalanche of a mountain (docs/01-gdd.md 4.1; Q-022, M3-12): mountain 1 — worlds-spec.json threat.firstIntervalSec
 * (the teaching mountain waits); mountains 2+ — inside threat.laterFirstIntervalSec, each its own value.
 */
export function validateFirstIntervals(worlds: WorldsJson, spec: WorldsSpecJson): string[] {
  const errors: string[] = [];
  const [w1, ...later] = worlds.worlds;
  if (w1 && w1.threat.firstIntervalSec !== spec.threat.firstIntervalSec)
    errors.push(`worlds.json: worlds[0] (${w1.id}): threat.firstIntervalSec — ${w1.threat.firstIntervalSec}, mountain 1 needs ${spec.threat.firstIntervalSec} (worlds-spec.json threat.firstIntervalSec)`);
  const range = spec.threat.laterFirstIntervalSec;
  if (!range) return errors;
  const seen = new Map<number, string>();
  for (const w of later) {
    const at = `worlds.json: worlds[${w.index - 1}] (${w.id}): threat.firstIntervalSec`;
    const sec = w.threat.firstIntervalSec;
    if (sec < range[0] || sec > range[1]) errors.push(`${at} — ${sec} outside ${range[0]}–${range[1]} s (worlds-spec.json threat.laterFirstIntervalSec)`);
    const twin = seen.get(sec);
    if (twin) errors.push(`${at} — ${sec} s, the same as ${twin} (each mountain its own value)`);
    seen.set(sec, w.id);
  }
  return errors;
}

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

/** Share of the warning plus the front's way down that the golden gift run may take (docs/01-gdd.md 4.9). */
export const GOLD_FAIRNESS_SHARE = 0.6;

export interface GoldFairnessRow {
  world: string;
  /** Stretch of the cave, its run «cave → gift at distMax → cave» at the minimum speed of the stretch, and the limit. */
  stretch: number;
  sec: number;
  limitSec: number;
}

/**
 * Golden gift fairness (docs/02-tech.md 5.4; docs/01-gdd.md 4.9): from every cave of every mountain the way «cave →
 * gift at distMax → cave» at the minimum speed of the cave's stretch (the stat that opened the wall below it; stretch
 * 1 — the last wall of the mountain before, stat 0 on mountain 1) takes ≤ 60% of warnSec + spawnAhead / threat.speed (the speed of the front, not the stat).
 */
export function goldFairnessReport(worlds: WorldsJson, speedAt: (stat: number) => number, distMax: number): GoldFairnessRow[] {
  const rows: GoldFairnessRow[] = [];
  // Stretch 1 of a mountain is run with the stat of the last wall of the mountain before it (stat 0 on mountain 1).
  let carried = 0;
  for (const w of worlds.worlds) {
    const gates = w.segments.filter((s) => s.type === 'gate').sort((a, b) => a.z - b.z);
    const limitSec = GOLD_FAIRNESS_SHARE * (w.threat.warnSec + w.threat.spawnAhead / w.threat.speed);
    for (const n of w.segments.filter((s) => s.type === 'niche')) {
      const stretch = num(n, 'stretch');
      const speed = speedAt(stretch <= 1 ? carried : num(gates[stretch - 2] as Segment, 'requires'));
      rows.push({ world: w.id, stretch, sec: (2 * distMax) / speed, limitSec });
    }
    const last = gates[gates.length - 1];
    if (last) carried = num(last, 'requires');
  }
  return rows;
}

export function validateGoldFairness(worlds: WorldsJson, speedAt: (stat: number) => number, distMax: number): string[] {
  return goldFairnessReport(worlds, speedAt, distMax)
    .filter((r) => r.sec > r.limitSec)
    .map(
      (r) =>
        `game.json: threat.bonus — golden gift fairness on ${r.world}, cave of stretch ${r.stretch}: cave → ${distMax} units → cave takes ${r.sec.toFixed(2)} s, above ${GOLD_FAIRNESS_SHARE} × (warnSec + spawnAhead / speed) = ${r.limitSec.toFixed(2)} s`,
    );
}
