import { afterEach, describe, expect, it } from 'vitest';
import { formatNumber, setNumberLocale, SUFFIX_KEYS } from '../../src/ui/format.ts';
import { stepGain, summitTrophies } from '../../src/sim/economy.ts';
import { addTrophies, leaderboardScore } from '../../src/meta/trophies.ts';
import { createSave } from '../../src/meta/save.ts';
import { PACK_FILES, validatePack, type PackFiles } from '../../src/level/validate.ts';
import { newMeta, runCycle, type ModelPack } from '../../scripts/balance-model.ts';
import game from '../../content/avalanche/game.json' with { type: 'json' };
import balanceJson from '../../content/avalanche/balance.json' with { type: 'json' };
import tuning from '../../content/avalanche/tuning.json' with { type: 'json' };
import petsJson from '../../content/avalanche/pets.json' with { type: 'json' };
import eggs from '../../content/avalanche/eggs.json' with { type: 'json' };
import worldsJson from '../../content/avalanche/worlds.json' with { type: 'json' };
import ru from '../../content/avalanche/i18n/ru.json' with { type: 'json' };
import en from '../../content/avalanche/i18n/en.json' with { type: 'json' };
import type { BalanceJson, EggsJson, GameJson, PetsJson, TuningJson, WorldsJson } from '../../src/content/types.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const balance = balanceJson as BalanceJson;
const pets = petsJson as PetsJson;
const worlds = (worldsJson as unknown as WorldsJson).worlds;
const pack: ModelPack = { game: game as unknown as GameJson, balance, tuning: tuning as TuningJson, pets, eggs: eggs as EggsJson, worlds };
const dict = (lang: Record<string, string>) => (k: string) => lang[`num.${k}`] ?? '?';

// M3-11: big numbers (docs/01-gdd.md 10.4, 8.4, 7.9).
describe('big numbers (M3-11)', () => {
  afterEach(() => setNumberLocale('en'));

  it('1 234 → «1,23K» in ru and «1.23K» in en: 3 significant digits, the separator from Intl.NumberFormat', () => {
    setNumberLocale('ru');
    expect(formatNumber(1234, dict(ru))).toBe('1,23K');
    setNumberLocale('en');
    expect(formatNumber(1234, dict(en))).toBe('1.23K');
    // Cut down, never rounded up: a price or a requirement is not shown as reached before it is.
    expect(formatNumber(1999)).toBe('1.99K');
    expect(formatNumber(999_999)).toBe('999K');
    expect(formatNumber(1050)).toBe('1.05K');
    expect(formatNumber(1150)).toBe('1.15K');
    expect(formatNumber(-1234)).toBe('-1.23K');
    expect(formatNumber(999.9)).toBe('999');
  });

  it('every suffix boundary up to Dc: the suffix keys come from i18n', () => {
    expect(SUFFIX_KEYS).toEqual(['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc']);
    for (const [lang, d] of [['ru', ru], ['en', en]] as const) {
      setNumberLocale(lang);
      const sep = lang === 'ru' ? ',' : '.';
      SUFFIX_KEYS.forEach((key, i) => {
        const at = Math.pow(10, 3 * (i + 1));
        const s = (d as Record<string, string>)[`num.${key}`];
        expect(s, key).toBeTruthy();
        // Exactly on the boundary, just below it (the previous suffix, 999), and 3 digits inside it.
        expect(formatNumber(at, dict(d)), `${key} at`).toBe(`1${s}`);
        expect(formatNumber(at * 0.9999999, dict(d)), `${key} below`).toBe(i === 0 ? '999' : `999${(d as Record<string, string>)[`num.${SUFFIX_KEYS[i - 1]}`]}`);
        expect(formatNumber(at * 1.234, dict(d)), `${key} 1.23`).toBe(`1${sep}23${s}`);
        expect(formatNumber(at * 12.34, dict(d)), `${key} 12.3`).toBe(`12${sep}3${s}`);
        expect(formatNumber(at * 123.4, dict(d)), `${key} 123`).toBe(`123${s}`);
      });
    }
    // Past Dc the number in front of Dc grows; never «Infinity» or «NaN» on the screen.
    expect(formatNumber(1e36)).toBe('1000Dc');
    expect(formatNumber(Infinity)).toBe('0');
    expect(formatNumber(NaN)).toBe('0');
  });

  it('Speed on tier 9 is finite and < 1e30', () => {
    // The bot of the balance model through tiers 0–9 (pets carried over, docs/01-gdd.md 8.5).
    const meta = newMeta();
    let last = 0;
    for (let n = 0; n <= 9; n++) {
      const r = runCycle(pack, { profile: 'greedy', tier: n, meta });
      last = r.walls[r.walls.length - 1]?.stat ?? 0;
    }
    expect(Number.isFinite(last)).toBe(true);
    expect(last).toBeGreaterThan(0);
    expect(last).toBeLessThan(1e30);
    // Upper bound of the game on tier 9: the best of everything on the strongest belt, 16 steps a second for 1000 hours.
    const belt = Math.max(...worlds.flatMap((w) => w.segments.map((s) => (typeof s['treadmill'] === 'number' ? (s['treadmill'] as number) : 1))));
    const bestPets = 1 + [...pets.pets.map((p) => p.bonus)].sort((a, b) => b - a).slice(0, balance.pets.slots).reduce((a, b) => a + b, 0);
    const top = balance.upgrade.tiers[balance.upgrade.tiers.length - 1]!.mult;
    // Trail ×5 and aura ×6 — the best of docs/01a-content.md 7 (their files arrive with M3-04).
    const perStep = stepGain(balance, { tier: 9, shoe: top, pets: bestPets, trail: 5, aura: 6, boost: true, vip: true }, belt);
    const max = perStep * (tuning.controller.maxSpeed / balance.stepLength) * 3600 * 1000;
    expect(Number.isFinite(max)).toBe(true);
    expect(max).toBeLessThan(1e30);
    expect(formatNumber(max)).toMatch(/^\d{1,3}([.]\d{1,2})?(Sx|Sp|Oc|No)$/);
  });

  it('the leaderboard goes by trophies over all time: whole, < 2^53', () => {
    // Q-004 switch: game.json leaderboard { name: "trophies", score: "trophiesTotal" } — the validator takes only whole counters.
    const files = {} as PackFiles;
    for (const f of PACK_FILES) files[f] = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../content/avalanche', f), 'utf8'));
    (files['game.json'] as GameJson).leaderboard = { name: 'trophies', score: 'trophiesTotal' };
    expect(validatePack(files).ok).toBe(true);
    (files['game.json'] as GameJson).leaderboard = { name: 'trophies', score: 'stat' };
    expect(validatePack(files).ok).toBe(false);

    const save = createSave(0);
    for (let n = 0; n <= 9; n++) for (let g = 1; g <= 5; g++) addTrophies(save, summitTrophies(balance, g, n));
    // 15 × (1 + 2 + … + 10) = 825 for tiers 0–9; spending lowers `trophies`, never the total.
    expect(save.trophiesTotal).toBe(825);
    save.trophies = (save.trophies ?? 0) - 500;
    expect(leaderboardScore(save, 'trophiesTotal')).toBe(825);
    expect(leaderboardScore(save, 'stat')).toBe(0);
    // A million rebirths: 15 × N(N + 1) / 2 ≈ 7.5e12 — still a safe integer.
    const big = 15 * ((1e6 * (1e6 + 1)) / 2);
    expect(big).toBeLessThan(2 ** 53);
    save.trophiesTotal = Number.MAX_SAFE_INTEGER - 3;
    addTrophies(save, 50);
    expect(save.trophiesTotal).toBe(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(leaderboardScore(save, 'trophiesTotal'))).toBe(true);
  });
});
