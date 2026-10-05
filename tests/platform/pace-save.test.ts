import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinCloud, mirrorKey, splitCloud } from '../../src/platform/pace-save.ts';
import { YandexPlatform } from '../../src/platform/yandex.ts';
import { NullPlatform } from '../../src/platform/null.ts';
import { createSave, type SaveData } from '../../src/meta/save.ts';

// PR-01: a save per pace (docs/01-gdd.md 16.1): classic at the root of the cloud data and in the mirror key `save` (the
// saves made before the paces), another pace under `paces.<pace>` and in `save.<pace>`; one never touches the other.
const save = (frontierWall: number, rev = 1): SaveData => ({ ...createSave(0), rev, frontierWall });

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => Array.from(m.keys())[i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

function fakeYa(cloud: { data: Record<string, unknown> }) {
  const player = {
    getData: vi.fn(async () => JSON.parse(JSON.stringify(cloud.data)) as Record<string, unknown>),
    setData: vi.fn(async (d: Record<string, unknown>) => void (cloud.data = JSON.parse(JSON.stringify(d)) as Record<string, unknown>)),
    isAuthorized: () => false,
    getName: () => '',
    getUniqueID: () => '',
    getMode: () => 'lite',
  };
  const sdk = {
    environment: { i18n: { lang: 'ru', tld: 'ru' }, app: { id: '0' }, browser: { lang: 'ru' }, payload: null },
    deviceInfo: { type: 'desktop' },
    features: { LoadingAPI: { ready: () => {} }, GameplayAPI: { start: () => {}, stop: () => {} } },
    on: () => () => {},
    off: () => {},
    getPlayer: async () => player,
    serverTime: () => 1000,
  };
  return { init: async () => sdk as never };
}

describe('saves per pace (PR-01)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('split and join: classic keeps the root and carries the other paces; a pace slot carries the root', () => {
    expect(mirrorKey()).toBe('save');
    expect(mirrorKey('fast')).toBe('save.fast');
    const cloud = { ...save(3), paces: { fast: save(2) } };
    const c = splitCloud(cloud);
    expect(c.mine).toEqual(save(3));
    expect(joinCloud(c.rest, save(4))).toEqual({ ...save(4), paces: { fast: save(2) } });
    const f = splitCloud(cloud, 'fast');
    expect(f.mine).toEqual(save(2));
    expect(joinCloud(f.rest, save(5), 'fast')).toEqual({ ...save(3), paces: { fast: save(5) } });
    // A save made before the paces: classic as it was; the fast slot is empty (a new player of that pace).
    const old = save(7);
    expect(splitCloud(old).mine).toEqual(old);
    expect(joinCloud(splitCloud(old).rest, old)).toBe(old);
    expect(splitCloud(old, 'fast').mine).toBeNull();
    expect(joinCloud(splitCloud(old, 'fast').rest, save(1), 'fast')).toEqual({ ...old, paces: { fast: save(1) } });
    expect(splitCloud(null, 'fast')).toEqual({ mine: null, rest: {} });
  });

  it('YandexPlatform: fast writes its slot, classic progress stays in the cloud and the mirror; F5 loads each its own', async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const cloud = { data: save(3) as unknown as Record<string, unknown> };
    localStorage.setItem('avalanche:save', JSON.stringify(save(3)));
    const opts = { packId: 'avalanche', leaderboardName: '', track: () => {} };

    const fast = new YandexPlatform({ ...opts, saveSlot: 'fast' }, { yaGames: fakeYa(cloud) });
    await fast.init();
    expect(await fast.loadSave()).toBeNull();
    fast.markDirty(save(2), { flush: true });
    await fast.flushNow();
    expect(cloud.data['frontierWall']).toBe(3);
    expect((cloud.data['paces'] as Record<string, SaveData>)['fast']!.frontierWall).toBe(2);
    expect(JSON.parse(localStorage.getItem('avalanche:save')!).frontierWall).toBe(3);
    expect(JSON.parse(localStorage.getItem('avalanche:save.fast')!).frontierWall).toBe(2);

    const classic = new YandexPlatform(opts, { yaGames: fakeYa(cloud) });
    await classic.init();
    const loaded = await classic.loadSave();
    expect(loaded?.frontierWall).toBe(3);
    expect(loaded && 'paces' in loaded).toBe(false);
    classic.markDirty({ ...loaded!, rev: 2, frontierWall: 4 }, { flush: true });
    await classic.flushNow();
    expect(cloud.data['frontierWall']).toBe(4);
    expect((cloud.data['paces'] as Record<string, SaveData>)['fast']!.frontierWall).toBe(2);

    const again = new YandexPlatform({ ...opts, saveSlot: 'fast' }, { yaGames: fakeYa(cloud) });
    await again.init();
    expect((await again.loadSave())?.frontierWall).toBe(2);
  });

  it('NullPlatform: the mirror key of the slot', async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const opts = { packId: 'avalanche', leaderboardName: '', track: () => {} };
    const classic = new NullPlatform(opts);
    const fast = new NullPlatform({ ...opts, saveSlot: 'fast' });
    classic.markDirty(save(3));
    fast.markDirty(save(1));
    expect((await classic.loadSave())?.frontierWall).toBe(3);
    expect((await fast.loadSave())?.frontierWall).toBe(1);
    expect(localStorage.getItem('avalanche:save.fast')).not.toBeNull();
  });
});
