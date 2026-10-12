import type { Page } from '@playwright/test';
import { test, expect, testState, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };
import openBalance from '../content/avalanche/pace/open/balance.json' with { type: 'json' };

// PS-11: «▶ Ad: continue from here» of the open slope (docs/01-gdd.md 9.1, 17.11; docs/03 section 2) on the SDK mock.
// After «Snowed in!» or «The giant caught you!» the button comes at the pop of the snowball, for 6 s or until the first
// move; the reward (onRewarded only) puts the hero back on the record flag with the threat over; once in 2 min.
type OpenWorld = { bosses: Array<{ zone: [number, number]; requires: number }> };
const world = (openWorlds as unknown as { worlds: OpenWorld[] }).worlds[0]!;
const zone = world.bosses[0]!.zone;
const advice = world.bosses[0]!.requires;
const SHOW_SEC = openBalance.ads.continueShowSec;
const BUTTON = '[data-hud="ad-continue_here"]';

/** 60 s of play and the first avalanche over: the common conditions of 9.1. */
async function ready(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setPlaySec(61));
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
}

/** Into the giant's zone at half his advice: caught, rolled back; resolves at the pop with the play time of it. */
async function giantCatch(page: Page): Promise<number> {
  const count = (): Promise<[number, number]> =>
    page.evaluate(() => [window.__TEST__!.simEvents.filter((e) => e.name === 'bossCaught').length, window.__TEST__!.simEvents.filter((e) => e.name === 'caughtEnd').length]);
  const [caught, before] = await count();
  await page.evaluate(([z, s]) => {
    window.__TEST__!.setStat(s);
    window.__TEST__!.teleport(z);
  }, [zone[0] - 6, advice / 2] as const);
  await page.evaluate((z) => window.__TEST__!.botPath([[0, z]]), zone[1] + 20);
  await page.waitForFunction((n) => window.__TEST__!.simEvents.filter((e) => e.name === 'bossCaught').length > n, caught, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await page.waitForFunction((n) => window.__TEST__!.simEvents.filter((e) => e.name === 'caughtEnd').length > n, before, { timeout: 30_000 });
  return (await testState(page)).timeSec;
}

test('no button before 60 s of play and the first avalanche; then at the pop of «Snowed in!» ≤ 1 s, gone after 6 s', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await openGame('pace=open');
  await giantCatch(page);
  for (let i = 0; i < 20; i++) {
    expect((await testState(page)).adButtons).not.toContain('continue_here');
    await waitTicks(page, 6);
  }
  await ready(page);
  // «Snowed in!»: the hero stands on the open slope of section 2 under a normal wave.
  const pops = await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'caughtEnd').length);
  await page.evaluate(() => window.__TEST__!.teleport(350, 0));
  await page.evaluate(() => window.__TEST__!.setTimeScale(4));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction((n) => window.__TEST__!.simEvents.filter((e) => e.name === 'caughtEnd').length > n, pops, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  const pop = (await testState(page)).timeSec;
  await page.waitForFunction(() => window.__TEST__!.state().adButtons.includes('continue_here'), undefined, { timeout: 10_000 });
  expect((await testState(page)).timeSec - pop).toBeLessThanOrEqual(1);
  await expect(page.locator(BUTTON)).toHaveText('▶ Реклама: продолжить отсюда');
  // Play seconds, as the game clock.
  await page.waitForFunction(() => !window.__TEST__!.state().adButtons.includes('continue_here'), undefined, { timeout: 20_000 });
  const sec = (await testState(page)).timeSec - pop;
  expect(sec).toBeGreaterThanOrEqual(SHOW_SEC - 0.5);
  expect(sec).toBeLessThanOrEqual(SHOW_SEC + 1);
});

test('after the giant’s catch the button goes with the first move', async ({ page, openGame }) => {
  test.setTimeout(150_000);
  await openGame('pace=open');
  await ready(page);
  await giantCatch(page);
  await page.waitForFunction(() => window.__TEST__!.state().adButtons.includes('continue_here'), undefined, { timeout: 10_000 });
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => !window.__TEST__!.state().adButtons.includes('continue_here'), undefined, { timeout: 5_000 });
  await page.keyboard.up('KeyW');
  await waitTicks(page, 30);
  expect((await testState(page)).adButtons).not.toContain('continue_here');
});

test('?mock_ad=ok: back on the record flag, the threat at rest, ad_resume_ok; again within 120 s — no button', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await openGame('pace=open&mock_ad=ok');
  await ready(page);
  await giantCatch(page);
  const record = (await testState(page)).record!;
  expect(record.z).toBeGreaterThan(zone[0]);
  await page.waitForFunction(() => window.__TEST__!.state().adButtons.includes('continue_here'), undefined, { timeout: 10_000 });
  // Every toast shown from here on (a hint may take the place of the reward's toast before the test looks, under load).
  await page.evaluate(() => {
    const el = document.querySelector('[data-role="toast"]')!;
    const seen: string[] = [];
    (window as unknown as { __toasts: string[] }).__toasts = seen;
    new MutationObserver(() => {
      if (el.classList.contains('shown') && seen[seen.length - 1] !== el.textContent) seen.push(el.textContent ?? '');
    }).observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
  });
  await page.locator(BUTTON).click();
  await page.waitForFunction(() => window.__TEST__!.state().adBusy === null && window.__TEST__!.analytics().some((e) => e.name === 'ad_resume_ok'), undefined, { timeout: 30_000 });
  const s = await testState(page);
  expect(Math.abs(s.hero!.z - record.z)).toBeLessThan(1);
  expect(Math.abs(s.hero!.x - record.x)).toBeLessThan(1);
  expect(s.caught).toBeNull();
  expect(['idle', 'gone']).toContain(s.wave!.phase);
  expect(s.boss!.zones[0]!.giants.every((gi) => gi.mode !== 'chase')).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts)).toContain('Награда получена');
  const resume = await page.evaluate(() => window.__TEST__!.analytics().filter((e) => e.name === 'ad_resume_ok').map((e) => e.params));
  expect(resume).toEqual([{ placement: 'continue_here', type: 'rewarded' }]);
  // Caught again well within 2 min: no offer.
  await giantCatch(page);
  for (let i = 0; i < 20; i++) {
    expect((await testState(page)).adButtons).not.toContain('continue_here');
    await waitTicks(page, 6);
  }
});

for (const [mode, toast] of [
  ['noshow', 'Награда не получена'],
  ['error', 'Видео сейчас недоступно'],
  ['closenoreward', 'Награда не получена'],
] as const) {
  test(`?mock_ad=${mode}: «${toast}», the hero where he was, no reward`, async ({ page, openGame }) => {
    test.setTimeout(150_000);
    await openGame(`pace=open&mock_ad=${mode}`);
    await ready(page);
    await giantCatch(page);
    await page.waitForFunction(() => window.__TEST__!.state().adButtons.includes('continue_here'), undefined, { timeout: 10_000 });
    const before = (await testState(page)).hero!;
    await page.locator(BUTTON).click();
    await page.waitForFunction(() => window.__TEST__!.state().adBusy === null && window.__TEST__!.analytics().some((e) => e.name === 'ad_resume_ok'), undefined, { timeout: 30_000 });
    await expect.poll(async () => (await testState(page)).waveHud.toast).toBe(toast);
    const s = await testState(page);
    expect(Math.abs(s.hero!.z - before.z)).toBeLessThan(1);
    expect(s.hero!.z).toBeLessThan(zone[0]);
  });
}

for (const lang of ['ru', 'en'] as const) {
  test(`640×360 ${lang}: the label fits its button and the screen`, async ({ page, openGame }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 640, height: 360 });
    await openGame(`pace=open&mock_lang=${lang}`);
    await ready(page);
    await giantCatch(page);
    await page.waitForFunction(() => window.__TEST__!.state().adButtons.includes('continue_here'), undefined, { timeout: 10_000 });
    const btn = page.locator(BUTTON);
    await expect(btn).toHaveText(lang === 'ru' ? '▶ Реклама: продолжить отсюда' : '▶ Ad: continue from here');
    const fit = await btn.evaluate((b) => ({ sw: b.scrollWidth, cw: b.clientWidth, sh: b.scrollHeight, ch: b.clientHeight }));
    expect(fit.sw).toBeLessThanOrEqual(fit.cw);
    expect(fit.sh).toBeLessThanOrEqual(fit.ch);
    const box = (await btn.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(640);
    expect(box.y + box.height).toBeLessThanOrEqual(360);
  });
}
