import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NO_INPUT, type HeroInput } from '../../src/sim/controller.ts';
import { createSim, type Sim } from '../../src/sim/world.ts';
import { buildLevel } from '../../src/level/builder.ts';
import type { BalanceJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const worlds = read('worlds.json') as WorldsJson;
const tuning = read('tuning.json') as TuningJson;
const balance = read('balance.json') as BalanceJson;
const DT = 1 / 60;
const RUN: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };
/** Gift of a zone on tier 0, docs/01a-content.md section 4 (mountain 1). */
const ZONE_GIFT = [5, 10, 20, 40, 80, 150];

function sim(tier = 0): Sim {
  const level = buildLevel(worlds.worlds[0]!);
  return createSim(level, tuning, { balance, speedCurve: balance.speedCurve, tier, stat: 1e6 });
}

/** Walks the hero up to gift `i` from 6 units below it, at its x. */
function walkInto(s: Sim, i: number): void {
  const g = s.gifts[i]!;
  s.teleport(g.x, s.level.floorYAt(g.z - 6) + 0.05, g.z - 6);
  for (let k = 0; k < 10; k++) s.step(NO_INPUT, DT);
  for (let k = 0; k < 40 && !g.taken; k++) s.step(RUN, DT);
}

// M2-04: gifts by zone rarity (docs/01-gdd.md 3.2, 5.2; docs/01a-content.md 4).
describe('gifts (M2-04)', () => {
  it('mountain 1 has 36 gifts, 3 per stretch, coins of their zone from docs/01a', () => {
    const s = sim();
    expect(s.gifts).toHaveLength(36);
    for (const g of s.gifts) expect(g.coins).toBe(ZONE_GIFT[g.zone - 1]);
  });

  it('a touch pays the coins of the zone and the gift disappears; one gift pays once', () => {
    const s = sim();
    const got: Array<{ index: number; coins: number; total: number }> = [];
    s.events.on('giftTake', (e) => got.push({ index: e.index, coins: e.coins, total: e.total }));
    walkInto(s, 0);
    expect(s.gifts[0]!.taken).toBe(true);
    expect(s.coins).toBe(5);
    expect(got).toEqual([{ index: 0, coins: 5, total: 5 }]);
    for (let k = 0; k < 30; k++) s.step(NO_INPUT, DT);
    s.teleport(s.gifts[0]!.x, s.level.floorYAt(s.gifts[0]!.z), s.gifts[0]!.z);
    for (let k = 0; k < 10; k++) s.step(NO_INPUT, DT);
    expect(s.coins).toBe(5);
    expect(got).toHaveLength(1);
    // A gift of zone 3 (stretch 5) pays 20.
    const z3 = s.gifts.findIndex((g) => g.zone === 3 && g.y === s.level.floorYAt(g.z));
    walkInto(s, z3);
    expect(s.coins).toBe(5 + 20);
  });

  it('the gift on a ledge needs a jump: running past it on the ground takes nothing', () => {
    const s = sim();
    const ledge = s.gifts.findIndex((g) => g.y > s.level.floorYAt(g.z) + 1);
    expect(ledge).toBeGreaterThanOrEqual(0);
    walkInto(s, ledge);
    expect(s.gifts[ledge]!.taken).toBe(false);
    expect(s.coins).toBe(0);
  });

  it('coins scale with wallScale[tier] (docs/01-gdd.md 8.1)', () => {
    const s = sim(3);
    walkInto(s, 0);
    expect(s.coins).toBe(5 * balance.rebirth.wallScale[3]!);
  });

  it('after the avalanche phase gone every gift is back in place', () => {
    const s = sim();
    walkInto(s, 0);
    walkInto(s, 1);
    expect(s.gifts.filter((g) => g.taken)).toHaveLength(2);
    let respawned = 0;
    s.events.on('giftsRespawn', () => respawned++);
    s.events.emit('waveGone', { tick: s.tick });
    expect(respawned).toBe(1);
    expect(s.gifts.every((g) => !g.taken)).toBe(true);
    const before = s.coins;
    walkInto(s, 0);
    expect(s.coins).toBe(before + 5);
  });
});
