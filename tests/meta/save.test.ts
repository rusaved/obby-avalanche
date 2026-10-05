import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSave, migrate, newerSave, parseSave, SAVE_VERSION } from '../../src/meta/save.ts';
import { SaveQueue, SAVE_MIN_GAP_MS } from '../../src/platform/save-queue.ts';
import { YandexPlatform } from '../../src/platform/yandex.ts';
import { NullPlatform } from '../../src/platform/null.ts';
import { createSim } from '../../src/sim/world.ts';
import { buildLevel } from '../../src/level/builder.ts';
import tuningJson from '../../content/avalanche/tuning.json' with { type: 'json' };
import worldsJson from '../../content/avalanche/worlds.json' with { type: 'json' };
import balanceJson from '../../content/avalanche/balance.json' with { type: 'json' };
import petsJson from '../../content/avalanche/pets.json' with { type: 'json' };
import trailsJson from '../../content/avalanche/trails.json' with { type: 'json' };
import aurasJson from '../../content/avalanche/auras.json' with { type: 'json' };
import skinsJson from '../../content/avalanche/skins.json' with { type: 'json' };
import type { BalanceJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

const balance = balanceJson as BalanceJson;
const tuning = tuningJson as TuningJson;
const worlds = worldsJson as unknown as WorldsJson;
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };

/** In-memory Storage for the mirror. */
function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// M3-07: SaveData v, rev, savedAt, migrations, broken data, size (docs/02-tech.md 4.4, 11.6; docs/03 SAV-02, SAV-05).
describe('SaveData (M3-07)', () => {
  it('migration v1 → v2: the climb starts from zero, everything else stays; a current save passes as is', () => {
    const v1 = { v: 1, rev: 7, savedAt: 500, sessions: 3, settings: { sound: false, music: true, autoRun: true, cameraSens: 1.4, quality: 'low' }, pets: ['bunny'], tier: 2 };
    const m = migrate(structuredClone(v1))!;
    expect(m).toEqual({ ...v1, v: 2, stat: 0, bestStat: 0, coins: 0, world: 1, frontierWall: 0 });
    const s = parseSave(structuredClone(v1))!;
    expect(s.v).toBe(SAVE_VERSION);
    expect(s.settings).toEqual(v1.settings);
    expect(s.pets).toEqual(['bunny']);
    const cur = { ...createSave(10), stat: 120, coins: 30, world: 2, frontierWall: 5 };
    expect(parseSave(structuredClone(cur))).toEqual(cur);
  });

  it('broken saves give a clean start: null for garbage, wrong fields dropped, settings back to defaults', () => {
    for (const bad of [null, undefined, 'x', 42, [], {}, { v: 'x', rev: 1 }, { v: 1 }, { v: 1, rev: Number.NaN }, { v: 0, rev: 1 }, { v: 1.5, rev: 1 }]) {
      expect(parseSave(bad), JSON.stringify(bad)).toBeNull();
    }
    const s = parseSave({ v: SAVE_VERSION, rev: 3, savedAt: 'yesterday', settings: 'loud', stat: -5, coins: 'many', pets: 'bunny', flags: [1], world: 2, frontierWall: 4 })!;
    expect(s.savedAt).toBe(0);
    expect(s.sessions).toBe(0);
    expect(s.settings).toEqual(createSave(0).settings);
    expect(s.stat).toBeUndefined();
    expect(s.coins).toBeUndefined();
    expect(s.pets).toBeUndefined();
    expect(s.flags).toBeUndefined();
    expect(s.world).toBe(2);
    expect(s.frontierWall).toBe(4);
  });

  it('cloud or mirror: the bigger rev wins, on a tie the later savedAt', () => {
    const a = { ...createSave(100), rev: 5 };
    const b = { ...createSave(200), rev: 4 };
    expect(newerSave(a, b)).toBe(a);
    expect(newerSave(b, a)).toBe(a);
    const c = { ...createSave(300), rev: 5 };
    expect(newerSave(a, c)).toBe(c);
    expect(newerSave(null, b)).toBe(b);
    expect(newerSave(null, null)).toBeNull();
  });

  it('loadSave: broken mirror and broken cloud → null without a console error; broken cloud → the mirror', async () => {
    const err = vi.spyOn(console, 'error');
    const storage = memStorage();
    vi.stubGlobal('localStorage', storage);
    storage.setItem('avalanche:save', '{"v":2,"rev":');
    let cloud: unknown = { v: 'broken' };
    const player = { getData: async () => cloud, setData: async () => {} };
    const sdk = { serverTime: () => 1000, getPlayer: async () => player, on: () => {}, environment: {}, deviceInfo: { type: 'desktop' } };
    const p = new YandexPlatform({ packId: 'avalanche', leaderboardName: '', track: () => {} }, { yaGames: { init: async () => sdk as never } });
    await p.init();
    expect(await p.loadSave()).toBeNull();
    const local = { ...createSave(900), rev: 4, stat: 77 };
    storage.setItem('avalanche:save', JSON.stringify(local));
    expect((await p.loadSave())?.stat).toBe(77);
    cloud = { ...createSave(950), rev: 9, stat: 99 };
    expect((await p.loadSave())?.stat).toBe(99);
    const n = new NullPlatform({ packId: 'avalanche', leaderboardName: '', track: () => {} });
    storage.setItem('avalanche:save', 'not json');
    expect(await n.loadSave()).toBeNull();
    expect(err).not.toHaveBeenCalled();
  });

  it('a heavy player after 100 rebirths with every purchase fits in 20 KB', () => {
    const s = createSave(Date.now());
    const pets = petsJson.pets.map((x) => x.id);
    Object.assign(s, {
      rev: 9_999_999,
      sessions: 99_999,
      tier: 100,
      summits: 5,
      shoes: balance.upgrade.tiers.length - 1,
      stat: 1.7976e300,
      bestStat: 1.7976e300,
      coins: 9.99e299,
      world: 5,
      frontierWall: 12,
      trophies: 123_456_789,
      trophiesTotal: 987_654_321,
      totalPlaySec: 3_600_000.123456,
      wavesNormal: 99_999,
      pets: Array.from({ length: balance.pets.inventory }, (_, i) => pets[i % pets.length]!),
      petsOn: Array.from({ length: balance.pets.slots }, (_, i) => i),
      trails: trailsJson.trails.map((x) => x.id),
      trail: trailsJson.trails[0]!.id,
      auras: aurasJson.auras.map((x) => x.id),
      aura: aurasJson.auras[0]!.id,
      skins: skinsJson.skins.map((x) => x.id),
      skin: skinsJson.skins[0]!.id,
      wings: skinsJson.wings.map((x) => x.id),
      wing: skinsJson.wings[0]!.id,
      flags: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`flag_number_${i}`, true])),
      hints: Object.fromEntries(Object.keys(balance.hints).map((k) => [k, 3])),
      daily: { n: 9999, last: Date.now(), dayStart: Date.now() },
      boostSec: 3600,
      adEgg: 2,
      quests: { day: Date.now(), list: ['q_walls', 'q_caves', 'q_steps'].map((id) => ({ id, n: 1000, k: 999, got: false })), bonus: false },
      timeRw: { day: Date.now(), sec: 86_400, got: [0, 1, 2, 3, 4, 5, 6, 7] },
      wheel: { day: Date.now() },
    });
    const bytes = new TextEncoder().encode(JSON.stringify(s)).length;
    expect(bytes).toBeLessThanOrEqual(20 * 1024);
  });
});

// M3-07: cloud writes — debounce 2 s, at most 10 s of waiting, one write per 3.5 s, retries 5 / 15 / 60 s (11.6).
describe('SaveQueue (M3-07)', () => {
  const make = (fail = 0) => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const writes: Array<{ t: number; data: number }> = [];
    let failLeft = fail;
    const q = new SaveQueue<number>({
      now: () => Date.now(),
      write: async (data) => {
        writes.push({ t: Date.now(), data });
        if (failLeft > 0) {
          failLeft--;
          throw new Error('setData failed');
        }
      },
    });
    return { q, writes };
  };

  it('debounce: 2 s after the last change, but never more than 10 s after the first', async () => {
    const { q, writes } = make();
    q.push(1);
    await vi.advanceTimersByTimeAsync(1500);
    q.push(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toEqual([{ t: 3500, data: 2 }]);
    // A change every second for 30 s: a write every 10 s, never starved.
    for (let i = 0; i < 30; i++) {
      q.push(100 + i);
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(writes.slice(1).map((w) => w.t)).toEqual([13_500, 23_500, 33_500]);
  });

  it('flush writes at once, but the bucket keeps 3.5 s between writes: ≤ 86 in any 5 minutes', async () => {
    const { q, writes } = make();
    q.push(1, true);
    expect(writes).toHaveLength(1);
    // A flush every 100 ms for 15 minutes.
    for (let t = 0; t < 15 * 60 * 10; t++) {
      q.push(t, true);
      await vi.advanceTimersByTimeAsync(100);
    }
    for (let i = 1; i < writes.length; i++) expect(writes[i]!.t - writes[i - 1]!.t).toBeGreaterThanOrEqual(SAVE_MIN_GAP_MS);
    let maxIn5 = 0;
    for (const w of writes) maxIn5 = Math.max(maxIn5, writes.filter((x) => x.t >= w.t && x.t < w.t + 300_000).length);
    expect(maxIn5).toBeLessThanOrEqual(86);
    expect(maxIn5).toBeGreaterThan(80);
    // The last data always goes out.
    await q.flush();
    await vi.advanceTimersByTimeAsync(SAVE_MIN_GAP_MS);
    expect(writes.at(-1)!.data).toBe(15 * 60 * 10 - 1);
  });

  it('a failed write is retried after 5, 15 and 60 s with the newest data, then the counter resets', async () => {
    const { q, writes } = make(3);
    q.push(1, true);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    q.push(2);
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(writes).toEqual([
      { t: 0, data: 1 },
      { t: 5000, data: 1 },
      { t: 20_000, data: 2 },
      { t: 80_000, data: 2 },
    ]);
    expect(q.hasPending).toBe(false);
  });
});

// M3-07: back after F5 at the flag of the farthest wall passed (docs/01-gdd.md 6.6, 7.10).
describe('resume at the frontier (M3-07)', () => {
  it('walls up to frontierWall passed and open, walls the stat reaches open, the hero at the flag behind the wall; no coins again', () => {
    const level = buildLevel(worlds.worlds[0]!);
    const req = level.gates.map((g) => g.requires);
    const stat = req[3]! + 1;
    const sim = createSim(level, tuning, { balance, speedCurve: curve, stat, coins: 55, resume: { frontierWall: 3 } });
    expect(sim.gatesPassed.slice(0, 4)).toEqual([true, true, true, false]);
    expect(sim.gatesOpen.slice(0, 5)).toEqual([true, true, true, true, false]);
    const flag = level.checkpoints.find((c) => c.wall === 3)!;
    expect(sim.hero.pos.z).toBeCloseTo(flag.z, 5);
    expect(sim.checkpoint).toBe(level.checkpoints.indexOf(flag));
    expect(sim.coins).toBe(55);
    const opened: number[] = [];
    sim.events.on('gateOpen', ({ wall }) => opened.push(wall));
    sim.step({ moveX: 0, moveZ: 0, jump: false, jumpHeld: false }, 1 / 60);
    expect(opened).toEqual([]);
    // Without a frontier: the camp spawn.
    const fresh = createSim(level, tuning, { balance, speedCurve: curve, stat: 0, resume: { frontierWall: 0 } });
    expect(fresh.hero.pos.z).toBeCloseTo(level.spawn[2], 5);
    expect(fresh.gatesOpen.every((o) => !o)).toBe(true);
  });

  it('the first avalanche after a return comes after balance.threat.resumeSec', () => {
    const w2 = worlds.worlds[1]!;
    const level = buildLevel(w2);
    const sim = createSim(level, tuning, {
      balance,
      speedCurve: curve,
      threat: { threat: w2.threat, balance, avalanche: tuning.avalanche, scriptedPending: false, normalWavesDone: 9, firstSec: balance.threat.resumeSec },
    });
    expect(sim.threat!.state.timer).toBe(30);
    expect(w2.threat.firstIntervalSec).not.toBe(30);
  });
});
