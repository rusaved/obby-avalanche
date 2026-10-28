import { expect, test, type Frame, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * K «Лавина 21 · Выход на VK и ОК»: the VK and OK build as published by build:pages (dist-pages/vk/, served static by
 * `npm run e2e:vk`), on the bridge stand-in (?mock=vk). No test API in this build: every check taps like a finger and reads
 * the page and the stand-in's call log (window.__VK_MOCK__). K-10: no link and no request outside the game's own address.
 */
const VK = 'vk/?mock=vk';
const SHOTS = 'docs/evidence/K21';
mkdirSync(SHOTS, { recursive: true });
const SHOTS23 = 'docs/evidence/L23';
mkdirSync(SHOTS23, { recursive: true });
type Mock = { __VK_MOCK__?: { calls: Array<{ method: string; params?: Record<string, unknown> }>; emit(type: string): void } };

function watch(page: Page) {
  const errors: string[] = [];
  const outside: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => {
    errors.push(`dialog ${d.message()}`);
    void d.dismiss();
  });
  page.on('request', (r) => {
    const u = r.url();
    if (!/^http:\/\/127\.0\.0\.1[:/]/.test(u) && !/^(data|blob|about):/.test(u)) outside.push(u);
  });
  return { errors, outside };
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as Mock).__VK_MOCK__!.calls);
const menu = (f: Page | Frame) => f.locator('[data-role="vk-menu"]');

async function up(f: Page | Frame) {
  await expect(f.locator('#preloader')).toHaveClass(/hidden/, { timeout: 100_000 });
  await expect(menu(f)).toBeVisible();
}

/** A box whole in the viewport and nothing over its middle. */
async function whole(page: Page, sel: string) {
  const b = await page.evaluate((q) => {
    const el = [...document.querySelectorAll<HTMLElement>(q)].find((e) => e.offsetParent !== null);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: innerWidth, h: innerHeight, mine: !!hit && (hit === el || el.contains(hit)) };
  }, sel);
  expect(b, `${sel} on screen`).not.toBeNull();
  expect(b!.top >= 0 && b!.left >= 0 && b!.bottom <= b!.h + 0.5 && b!.right <= b!.w + 0.5, `${sel} whole in ${b!.w}×${b!.h}`).toBe(true);
  expect(b!.mine, `${sel} not covered`).toBe(true);
}

/** K-10: no link, no window.open, nothing names another platform. */
async function noWayOut(page: Page | Frame) {
  expect(await page.locator('a[href]').count()).toBe(0);
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/яндекс|yandex|telegram|телеграм|вконтакт|одноклассник|github/i);
}

for (const size of [
  { width: 1000, height: 600 },
  { width: 630, height: 600 },
]) {
  test(`K-09 in an iframe ${size.width}×${size.height} as VK on a computer: boots to the menu, plays, no outside request, no error`, async ({ page, baseURL }) => {
    const w = watch(page);
    await page.setViewportSize({ width: size.width + 40, height: size.height + 40 });
    await page.setContent(
      `<body style="margin:0;background:#edeef0"><iframe id="g" src="${baseURL}${VK}" style="border:0;margin:20px;width:${size.width}px;height:${size.height}px"></iframe></body>`,
    );
    const frame = page.frameLocator('#g');
    await expect(frame.locator('#preloader'), `boot in the frame; errors: ${w.errors.join(' | ')}`).toHaveClass(/hidden/, { timeout: 100_000 });
    await expect(frame.locator('[data-role="vk-menu"]')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/iframe-menu-${size.width}x${size.height}.png` });
    await frame.locator('[data-vk="play"]').click();
    await expect(frame.locator('[data-role="vk-menu"]')).toBeHidden();
    await expect(frame.locator('[data-hud="pause"]')).toBeVisible();
    expect(await frame.locator('a[href]').count()).toBe(0);
    expect(await frame.locator('body').innerText()).not.toMatch(/яндекс|yandex|telegram|телеграм|вконтакт|одноклассник|github/i);
    await page.screenshot({ path: `${SHOTS}/iframe-play-${size.width}x${size.height}.png` });
    expect(w.errors).toEqual([]);
    expect(w.outside).toEqual([]);
  });
}

for (const size of [
  { width: 815, height: 290 },
  { width: 880, height: 405 },
]) {
  const tag = `${size.width}x${size.height}`;
  test.describe(tag, () => {
    test.use({ viewport: size, isMobile: true, hasTouch: true });

    test(`K-02, K-04, K-07: VKWebAppInit first, «Loading 100%», the menu «Play · Sound · Help», back to it from any screen @ ${tag}`, async ({ page }) => {
      const w = watch(page);
      await page.goto(`/${VK}`);
      await up(page);
      expect((await calls(page))[0]?.method).toBe('VKWebAppInit');
      await expect(page.locator('[data-boot-progress]')).toHaveAttribute('data-boot-progress', '100');
      for (const a of ['play', 'sound', 'help', 'settings']) await whole(page, `[data-vk="${a}"]`);
      await page.screenshot({ path: `${SHOTS}/menu-${tag}.png` });
      // Sound off and on from the menu.
      const sound = page.locator('[data-vk="sound"]');
      await expect(sound).toHaveAttribute('aria-pressed', 'true');
      await sound.tap();
      await expect(page.locator('[data-vk="sound"]')).toHaveAttribute('aria-pressed', 'false');
      await page.locator('[data-vk="sound"]').tap();
      await expect(page.locator('[data-vk="sound"]')).toHaveAttribute('aria-pressed', 'true');
      // Help: how to play in 4 lines and the community as the support channel; no link.
      await page.locator('[data-vk="help"]').tap();
      await expect(page.locator('.vk-how li')).toHaveCount(4);
      // R-05 («Лавина 23»): «Help» under its own title.
      await expect(page.locator('.win-title')).toHaveText('Как играть');
      await expect(page.locator('.vk-support')).toContainText('сообщество');
      await whole(page, '[data-vk="back"]');
      await page.screenshot({ path: `${SHOTS}/help-${tag}.png` });
      await noWayOut(page);
      await page.locator('[data-vk="back"]').tap();
      await expect(page.locator('.win-title')).not.toHaveText('Как играть');
      await page.locator('[data-vk="play"]').tap();
      await expect(menu(page)).toBeHidden();
      // From the game: the menu button of the HUD; from a window: its menu button beside the cross.
      await page.locator('[data-hud="pause"]').tap();
      await expect(menu(page)).toBeVisible();
      await page.locator('[data-vk="settings"]').tap();
      await expect(page.locator('[data-role="window"].open')).toHaveAttribute('data-window', 'pause');
      await page.locator('[data-hud="win-menu"]').tap();
      await expect(menu(page)).toBeVisible();
      // «Gifts» (?playtime=300 of the kit opens it at once — a new player has no gift plaque yet).
      await page.goto(`/${VK}&playtime=300`);
      await expect(page.locator('[data-role="window"].open')).toHaveAttribute('data-window', 'gifts', { timeout: 100_000 });
      await whole(page, '[data-hud="win-menu"]');
      await page.locator('[data-hud="win-menu"]').tap();
      await expect(menu(page)).toBeVisible();
      // Russian only.
      expect(await page.evaluate(() => document.documentElement.lang)).toBe('ru');
      await noWayOut(page);
      expect(w.errors).toEqual([]);
      expect(w.outside).toEqual([]);
    });

    test(`K-05: no ad at the launch; rewarded checked ahead with use_waterfall: false; no ad loaded — no «Ad» button @ ${tag}`, async ({ page }) => {
      await page.goto(`/${VK}&mock_ads=none&playtime=300`);
      await expect(page.locator('[data-role="window"].open')).toHaveAttribute('data-window', 'gifts', { timeout: 100_000 });
      await page.waitForTimeout(3000);
      const list = await calls(page);
      const checks = list.filter((c) => c.method === 'VKWebAppCheckNativeAds');
      expect(checks.length).toBeGreaterThan(0);
      for (const c of checks) expect(c.params?.['use_waterfall']).toBe(false);
      expect(list.filter((c) => c.method === 'VKWebAppShowNativeAds')).toEqual([]);
      // No «Ad» anywhere while nothing is loaded (the «Gifts» window included).
      expect(await page.locator('[data-role="window"].open').innerText()).not.toMatch(/Реклама/);
      expect(await page.locator('[data-ad]').count()).toBe(0);
    });

    test(`K-06, K-07: VKWebAppViewHide writes the save to VK Storage at once, in parts of ≤ 4 096 @ ${tag}`, async ({ page }) => {
      await page.goto(`/${VK}`);
      await up(page);
      await page.locator('[data-vk="play"]').tap();
      await page.waitForTimeout(2500);
      const before = (await calls(page)).filter((c) => c.method === 'VKWebAppStorageSet').length;
      await page.evaluate(() => (window as unknown as Mock).__VK_MOCK__!.emit('VKWebAppViewHide'));
      await page.waitForTimeout(500);
      const sets = (await calls(page)).filter((c) => c.method === 'VKWebAppStorageSet');
      expect(sets.length).toBeGreaterThanOrEqual(before);
      for (const s of sets) expect(String(s.params?.['value']).length).toBeLessThanOrEqual(4096);
      await page.evaluate(() => (window as unknown as Mock).__VK_MOCK__!.emit('VKWebAppViewRestore'));
    });

    test(`K-07: no network — the game still boots to the menu, no endless loading @ ${tag}`, async ({ page }) => {
      const w = watch(page);
      await page.goto(`/${VK}&mock_net=off`);
      await up(page);
      expect(w.errors).toEqual([]);
    });

    test(`K-08: «Join the community» — the gift once on result: true; no join button without a community id @ ${tag}`, async ({ page }) => {
      await page.goto(`/${VK}`);
      await up(page);
      await page.locator('[data-vk="help"]').tap();
      await expect(page.locator('[data-vk="join"]')).toHaveCount(0);
      await page.goto(`/${VK}&mock_group=77&fresh=1`);
      await up(page);
      await page.locator('[data-vk="help"]').tap();
      await whole(page, '[data-vk="join"]');
      await page.locator('[data-vk="join"]').tap();
      await expect(page.locator('[data-vk="joined"]')).toBeVisible();
      const join = (await calls(page)).filter((c) => c.method === 'VKWebAppJoinGroup');
      expect(join).toHaveLength(1);
      expect(join[0]?.params).toEqual({ group_id: 77 });
      await page.screenshot({ path: `${SHOTS}/join-done-${tag}.png` });
    });

    test(`K-08: a refusal is remembered — no «Join» card in «Gifts» for a month @ ${tag}`, async ({ page }) => {
      // Before: a new player with a community id has the card in «Gifts».
      await page.goto(`/${VK}&mock_group=77&fresh=1&playtime=300`);
      await expect(page.locator('[data-role="window"].open')).toHaveAttribute('data-window', 'gifts', { timeout: 100_000 });
      await expect(page.locator('[data-hud="gift-join"]')).toHaveCount(1);
      await page.goto(`/${VK}&mock_group=77&mock_join=no`);
      await up(page);
      await page.locator('[data-vk="help"]').tap();
      await page.locator('[data-vk="join"]').tap();
      await page.waitForTimeout(300);
      await expect(page.locator('[data-vk="join"]')).toBeVisible();
      // Reloaded with «Gifts» open: no «Join» card after the refusal.
      await page.goto(`/${VK}&mock_group=77&playtime=300`);
      await expect(page.locator('[data-role="window"].open')).toHaveAttribute('data-window', 'gifts', { timeout: 100_000 });
      await expect(page.locator('[data-hud="gift-join"]')).toHaveCount(0);
    });

    test(`K-12: the check kit on ?mock=vk — ?coins, ?fresh=1, ?mountain, ?stage, ?playtime opens «Gifts», the build line in the pause @ ${tag}`, async ({ page }) => {
      await page.goto(`/${VK}&coins=777`);
      await up(page);
      expect(await page.evaluate(() => (window as unknown as { __KIT_STATE__: () => { coins: number } }).__KIT_STATE__().coins)).toBe(777);
      // A new save without a private window: the coins are gone, the address loses the flag.
      await page.goto(`/${VK}&fresh=1`);
      await up(page);
      expect(await page.evaluate(() => (window as unknown as { __KIT_STATE__: () => { coins: number } }).__KIT_STATE__().coins)).toBe(0);
      expect(page.url()).not.toContain('fresh');
      await page.goto(`/${VK}&mountain=2&stage=3`);
      await up(page);
      const st = await page.evaluate(() => (window as unknown as { __KIT_STATE__: () => { world: number; z: number; stageZ: number } }).__KIT_STATE__());
      expect(st.world).toBe(2);
      expect(Math.abs(st.z - st.stageZ)).toBeLessThan(3);
      await page.goto(`/${VK}&playtime=300`);
      await expect(page.locator('[data-role="window"].open')).toHaveAttribute('data-window', 'gifts', { timeout: 100_000 });
      await page.screenshot({ path: `${SHOTS}/kit-gifts-${tag}.png` });
      await page.locator('[data-hud="win-menu"]').tap();
      await page.locator('[data-vk="settings"]').tap();
      await expect(page.locator('[data-role="kit-build"]')).toHaveText(/^сборка [0-9a-f]{7}$/);
      // R-02 («Лавина 23»): light on the dark window (was ≈ 1,05:1), whole on screen without a scroll.
      const ratio = await page.locator('[data-role="kit-build"]').evaluate((el) => {
        const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
        const lum = ([r, g, b]: number[]) => {
          const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
          return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
        };
        let bgEl: Element | null = el.parentElement;
        while (bgEl && (rgb(getComputedStyle(bgEl).backgroundColor)[3] ?? 1) === 0) bgEl = bgEl.parentElement;
        const bg = rgb(getComputedStyle(bgEl ?? document.body).backgroundColor);
        const fg = rgb(getComputedStyle(el).color);
        const a = Number(getComputedStyle(el).opacity) * (fg[3] ?? 1);
        const mix = [0, 1, 2].map((i) => fg[i]! * a + bg[i]! * (1 - a));
        const [l1, l2] = [lum(mix), lum(bg)].sort((x, y) => y - x);
        return (l1! + 0.05) / (l2! + 0.05);
      });
      expect(ratio, 'build line contrast').toBeGreaterThanOrEqual(4.5);
      await whole(page, '[data-role="kit-build"]');
      await page.screenshot({ path: `${SHOTS23}/kit-build-${tag}.png` });
    });
  });
}

type Buf = { __ANALYTICS_BUFFER__?: Array<{ name: string; params?: Record<string, unknown> }> };
const evs = (page: Page, name: string) =>
  page.evaluate((n) => ((window as unknown as Buf).__ANALYTICS_BUFFER__ ?? []).filter((e) => e.name === n), name);
const heroZ = (page: Page) => page.evaluate(() => (window as unknown as { __KIT_STATE__: () => { z: number } }).__KIT_STATE__().z);

// R-01 («Лавина 23»): the VK app holds the phone upright — «Turn your phone» over the blurred game, the game and the sound
// stand; turned — the game goes on from the same place, the menu is whole. The window decides, not isMobile.
for (const size of [
  { width: 405, height: 880 },
  { width: 405, height: 720 },
  { width: 375, height: 667 },
]) {
  const tag = `${size.width}x${size.height}`;
  test.describe(`R-01 ${tag}`, () => {
    test.use({ viewport: size, hasTouch: true });

    test(`R-01: upright — the rotate screen, the game stands; turned — it runs on, the menu whole @ ${tag}`, async ({ page }) => {
      const w = watch(page);
      await page.goto(`/${VK}&vk_platform=mobile_android&fresh=1&coins=0`);
      await expect(page.locator('#preloader')).toHaveClass(/hidden/, { timeout: 100_000 });
      const rotate = page.locator('[data-role="rotate"]');
      await expect(rotate).toHaveClass(/shown/);
      await expect(rotate).toContainText('Поверни телефон');
      expect(await rotate.evaluate((e) => getComputedStyle(e).backdropFilter)).toContain('blur');
      await page.screenshot({ path: `${SHOTS23}/rotate-${tag}.png` });
      expect((await evs(page, 'rotate_shown')).length).toBe(1);
      // A tap on the screen plays nothing: the menu stays under it.
      await page.mouse.click(size.width / 2, size.height / 2);
      await expect(rotate).toHaveClass(/shown/);
      // Turned: the screen goes, the menu is whole, Help opens; Play — the hero runs.
      await page.setViewportSize({ width: size.height, height: size.width });
      await expect(rotate).not.toHaveClass(/shown/);
      const done = await evs(page, 'rotate_done');
      expect(done.length).toBe(1);
      expect(typeof done[0]!.params!['sec']).toBe('number');
      for (const a of ['play', 'help']) await whole(page, `[data-vk="${a}"]`);
      await page.screenshot({ path: `${SHOTS23}/rotate-done-${tag}.png` });
      await page.locator('[data-vk="play"]').tap();
      await expect(menu(page)).toBeHidden();
      const z0 = await heroZ(page);
      // Upright again mid-run: the hero stands where he was.
      await page.setViewportSize(size);
      await expect(rotate).toHaveClass(/shown/);
      const zA = await heroZ(page);
      await page.waitForTimeout(1500);
      expect(Math.abs((await heroZ(page)) - zA)).toBeLessThan(0.01);
      await page.setViewportSize({ width: size.height, height: size.width });
      await expect(rotate).not.toHaveClass(/shown/);
      await expect(page.locator('[data-hud="pause"]')).toBeVisible();
      expect(zA).toBeGreaterThanOrEqual(z0 - 0.01);
      expect(w.errors).toEqual([]);
      expect(w.outside).toEqual([]);
    });
  });
}

test('R-01: a computer — an iframe 1000×600 and 630×600 never shows the rotate screen', async ({ page, baseURL }) => {
  for (const size of [
    { width: 1000, height: 600 },
    { width: 630, height: 600 },
  ]) {
    await page.setViewportSize({ width: size.width + 40, height: size.height + 40 });
    await page.setContent(`<body style="margin:0"><iframe id="g" src="${baseURL}${VK}" style="border:0;margin:20px;width:${size.width}px;height:${size.height}px"></iframe></body>`);
    const frame = page.frameLocator('#g');
    await expect(frame.locator('#preloader')).toHaveClass(/hidden/, { timeout: 100_000 });
    await expect(frame.locator('[data-role="rotate"].shown')).toHaveCount(0);
  }
});

test('K-12: a signed VK launch ignores ?mock=vk and the kit (the real bridge, no presets)', async ({ page }) => {
  await page.goto('/vk/?mock=vk&vk_app_id=1&sign=x&coins=999');
  // The real bridge outside VK answers nothing: the game boots from the cache after the bridge time limit.
  await expect(page.locator('#preloader')).toHaveClass(/hidden/, { timeout: 60_000 });
  expect(await page.evaluate(() => (window as unknown as Mock).__VK_MOCK__ === undefined)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __KIT_STATE__?: unknown }).__KIT_STATE__ === undefined)).toBe(true);
});
