import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Loads dev/yasdk-mock/sdk.js into a fake window (docs/02-tech.md 11.9). */
type Fn = (...args: unknown[]) => unknown;
interface FakeWindow {
  location: { search: string };
  console: { error: Fn; warn: Fn; log: Fn };
  setTimeout: typeof setTimeout;
  localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  YaGames?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __YA_MOCK__?: any;
}
const code = readFileSync(resolve(__dirname, '../../dev/yasdk-mock/sdk.js'), 'utf8');

async function init(ya: { init(): Promise<any> }) {
  const p = ya.init();
  await vi.advanceTimersByTimeAsync(0);
  return p;
}

function load(search = '') {
  const errors: string[] = [];
  const win: FakeWindow = {
    location: { search },
    console: { error: (...a: unknown[]) => errors.push(a.map(String).join(' ')), warn: () => {}, log: () => {} },
    setTimeout: ((fn: Fn, ms: number) => setTimeout(fn, ms)) as unknown as typeof setTimeout,
  };
  new Function('window', code)(win);
  return { win, errors, mock: win.__YA_MOCK__, ya: win.YaGames };
}

describe('yasdk mock', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('mock_lang and mock_device change environment and deviceInfo', async () => {
    const { ya } = load('?mock_lang=en&mock_device=mobile');
    const p = ya.init();
    await vi.advanceTimersByTimeAsync(0);
    const sdk = await p;
    expect(sdk.environment.i18n.lang).toBe('en');
    expect(sdk.deviceInfo.type).toBe('mobile');
    expect(sdk.deviceInfo.isMobile()).toBe(true);
    const def = load('');
    const sdk2 = await (async () => {
      const q = def.ya.init();
      await vi.advanceTimersByTimeAsync(0);
      return q;
    })();
    expect(sdk2.environment.i18n.lang).toBe('ru');
    expect(sdk2.deviceInfo.type).toBe('desktop');
  });

  it('mock_init_delay delays init', async () => {
    const { ya } = load('?mock_init_delay=15000');
    let done = false;
    ya.init().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(14000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1100);
    expect(done).toBe(true);
  });

  it('mock_auth / mock_player drive the player; getData is empty for a new player', async () => {
    const a = load('?mock_auth=1');
    const sdkA = await init(a.ya);
    const pA = await sdkA.getPlayer();
    expect(pA.isAuthorized()).toBe(true);
    expect(pA.getName()).not.toBe('');
    expect(await pA.getData()).toEqual({});
    const b = load('?mock_player=lite');
    const sdkB = await init(b.ya);
    const pB = await sdkB.getPlayer();
    expect(pB.isAuthorized()).toBe(false);
    expect(pB.getName()).toBe('');
  });

  it('mock_save=fail: three rejections then success; data round-trips', async () => {
    const { ya } = load('?mock_save=fail');
    const sdk = await init(ya);
    const player = await sdk.getPlayer();
    for (let i = 0; i < 3; i++) await expect(player.setData({ v: 1 })).rejects.toThrow();
    await expect(player.setData({ v: 1, coins: 5 })).resolves.toBeUndefined();
    expect(await player.getData()).toEqual({ v: 1, coins: 5 });
  });

  it('mock_time_offset shifts serverTime; advance() moves the clock', async () => {
    const { ya, mock } = load('?mock_time_offset=86400000');
    const sdk = await init(ya);
    const now = Date.now();
    expect(sdk.serverTime() - now).toBeGreaterThanOrEqual(86400000);
    mock.advance(5000);
    expect(sdk.serverTime() - now).toBeGreaterThanOrEqual(86405000);
  });

  it('mock_flags merges with defaults; mock_flags=error rejects', async () => {
    const { ya } = load('?mock_flags=' + encodeURIComponent('{"w1_warnSec":"10"}'));
    const sdk = await init(ya);
    expect(await sdk.getFlags({ defaultFlags: { w1_warnSec: '8', other: '1' } })).toEqual({ w1_warnSec: '10', other: '1' });
    const e = load('?mock_flags=error');
    const sdkE = await init(e.ya);
    await expect(sdkE.getFlags({ defaultFlags: {} })).rejects.toThrow();
  });

  it('mocks= JSON is exposed in environment.mocks', async () => {
    const { ya } = load('?mocks=' + encodeURIComponent('{"lockedOrientation":"landscape"}'));
    const sdk = await init(ya);
    expect(sdk.environment.mocks).toEqual({ lockedOrientation: 'landscape' });
  });

  it('mock_ad=ok: pause → onOpen → onRewarded → onClose → resume; fullscreen onClose(true)', async () => {
    const { ya, mock } = load('?mock_ad=ok');
    const sdk = await init(ya);
    const seq: string[] = [];
    sdk.on('game_api_pause', () => seq.push('pause'));
    sdk.on('game_api_resume', () => seq.push('resume'));
    sdk.adv.showRewardedVideo({
      callbacks: { onOpen: () => seq.push('open'), onRewarded: () => seq.push('rewarded'), onClose: () => seq.push('close'), onError: () => seq.push('error') },
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(seq).toEqual(['pause', 'open', 'rewarded', 'close', 'resume']);
    const seq2: string[] = [];
    sdk.adv.showFullscreenAdv({ callbacks: { onOpen: () => seq2.push('open'), onClose: (shown: boolean) => seq2.push(`close:${shown}`) } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(seq2).toEqual(['open', 'close:true']);
    expect(mock.calls.filter((c: { name: string }) => c.name === 'event:game_api_pause')).toHaveLength(2);
  });

  it('mock_ad=slow: onOpen after 5 s', async () => {
    const { ya } = load('?mock_ad=slow');
    const sdk = await init(ya);
    const seq: string[] = [];
    sdk.adv.showFullscreenAdv({ callbacks: { onOpen: () => seq.push('open'), onClose: () => seq.push('close') } });
    await vi.advanceTimersByTimeAsync(4900);
    expect(seq).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(seq).toEqual(['open']);
    await vi.advanceTimersByTimeAsync(1600);
    expect(seq).toEqual(['open', 'close']);
  });

  it('mock_ad=error: onError then onClose(false); noshow: onClose(false) only; closenoreward: no onRewarded', async () => {
    const e = load('?mock_ad=error');
    const sdkE = await init(e.ya);
    const seq: string[] = [];
    sdkE.adv.showFullscreenAdv({ callbacks: { onOpen: () => seq.push('open'), onError: () => seq.push('error'), onClose: (s: boolean) => seq.push(`close:${s}`) } });
    await vi.advanceTimersByTimeAsync(100);
    expect(seq).toEqual(['error', 'close:false']);

    const n = load('?mock_ad=noshow');
    const sdkN = await init(n.ya);
    const seqN: string[] = [];
    sdkN.adv.showFullscreenAdv({ callbacks: { onOpen: () => seqN.push('open'), onClose: (s: boolean) => seqN.push(`close:${s}`) } });
    await vi.advanceTimersByTimeAsync(100);
    expect(seqN).toEqual(['close:false']);

    const c = load('?mock_ad=closenoreward');
    const sdkC = await init(c.ya);
    const seqC: string[] = [];
    sdkC.adv.showRewardedVideo({ callbacks: { onOpen: () => seqC.push('open'), onRewarded: () => seqC.push('rewarded'), onClose: () => seqC.push('close') } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(seqC).toEqual(['open', 'close']);
  });

  it('mock_startup_ad=1: pause right after init, resume 2 s later', async () => {
    const { ya } = load('?mock_startup_ad=1');
    const seq: string[] = [];
    const p = ya.init();
    await vi.advanceTimersByTimeAsync(0);
    const sdk = await p;
    sdk.on('game_api_pause', () => seq.push('pause'));
    sdk.on('game_api_resume', () => seq.push('resume'));
    await vi.advanceTimersByTimeAsync(10);
    expect(seq).toEqual(['pause']);
    await vi.advanceTimersByTimeAsync(2100);
    expect(seq).toEqual(['pause', 'resume']);
  });

  it('limits: second ready() throws and is recorded; 101st setData in 5 minutes fails; getPlayer > 20 fails', async () => {
    const { ya, mock, errors } = load('');
    const sdk = await init(ya);
    sdk.features.LoadingAPI.ready();
    expect(() => sdk.features.LoadingAPI.ready()).toThrow();
    expect(mock.violations).toHaveLength(1);
    expect(errors).toHaveLength(1);
    const player = await sdk.getPlayer();
    for (let i = 0; i < 100; i++) await player.setData({ i });
    await expect(player.setData({ i: 100 })).rejects.toThrow();
    expect(mock.violations).toHaveLength(2);
    mock.advance(5 * 60 * 1000 + 1);
    await expect(player.setData({ i: 101 })).resolves.toBeUndefined();
    // the first getPlayer stamp fell out of the 5-minute window after advance(): 20 more pass, the 21st fails
    for (let i = 0; i < 20; i++) await sdk.getPlayer();
    await expect(sdk.getPlayer()).rejects.toThrow();
    expect(mock.violations).toHaveLength(3);
    expect(mock.calls.filter((c: { name: string }) => c.name === 'player.setData')).toHaveLength(102);
  });

  it('setScore more than once per second is a violation', async () => {
    const { ya, mock } = load('');
    const sdk = await init(ya);
    await sdk.leaderboards.setScore('trophies', 1);
    await expect(sdk.leaderboards.setScore('trophies', 2)).rejects.toThrow();
    expect(mock.violations).toHaveLength(1);
    mock.advance(1001);
    await expect(sdk.leaderboards.setScore('trophies', 3)).resolves.toBeUndefined();
    const entry = await sdk.leaderboards.getPlayerEntry('trophies');
    expect(entry.score).toBe(3);
  });

  it('every call is visible in __YA_MOCK__.calls', async () => {
    const { ya, mock } = load('');
    const sdk = await init(ya);
    sdk.features.GameplayAPI.start();
    sdk.features.GameplayAPI.stop();
    await sdk.getStorage();
    expect(mock.calls.map((c: { name: string }) => c.name)).toEqual(['init', 'GameplayAPI.start', 'GameplayAPI.stop', 'getStorage']);
  });
});
