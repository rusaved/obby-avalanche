import { test, expect, testState } from './fixtures.ts';
import { forbiddenSymbols, hudBoxes, labelsOverHud, MU_VIEW, scaleText, VISIBLE_H } from './mu-checks.ts';
import { STAGES, threshold } from './lv-stage-data.ts';
import stagesWorlds from '../content/avalanche/pace/stages/worlds.json' with { type: 'json' };
import type { Page } from '@playwright/test';

// MU-03…MU-09, MU-12, MU-13 (docs/07-mobile-ui.md, docs/mockups): the screens of the phone at 812×375 with touch.
test.use({ viewport: MU_VIEW });

const SLOT = '[data-role="hint"], [data-role="need"], [data-role="tutor"], [data-role="wave-banner"], [data-role="ads"], [data-role="toast"]';

async function prepare(page: Page, extra = ''): Promise<void> {
  await page.evaluate((x) => {
    const t = window.__TEST__!;
    t.setPlaySec(400);
    t.setCoins(5300);
    t.setTrophies(3);
    t.holdWave(900);
    if (x) eval(x);
  }, extra);
  await page.touchscreen.tap(400, 200);
  await page.waitForTimeout(300);
}

/** Message carriers of the slot visible now. */
async function slotShown(page: Page): Promise<string[]> {
  return page.evaluate((sel) =>
    Array.from(document.querySelectorAll(sel))
      .filter((e) => {
        const s = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        return r.width > 0 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05;
      })
      .map((e) => (e as HTMLElement).dataset['role'] ?? ''),
  SLOT);
}

async function tap(page: Page, hud: string): Promise<void> {
  const b = page.locator(`[data-hud="${hud}"]`).first();
  await b.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
  // The click a phone sends after the tap (the HUD drops it, ui/hud.ts dropTapClick).
  await b.dispatchEvent('click', { detail: 1 });
}

/** One finger swipes up over (x, y) by `dy` px (CDP touch events, MU-13). */
async function swipe(page: Page, x: number, y: number, dy: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - (dy * i) / 8 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** The open window: its panel box, the cross, the HUD under it, the buttons under 44 px. */
async function windowFacts(page: Page): Promise<{ id: string; w: number; h: number; bottom: number; cross: number; hudShown: boolean; small: string[] }> {
  return page.evaluate(() => {
    const dim = document.querySelector('[data-role="window"].open') as HTMLElement;
    const p = dim.querySelector('.win-panel')!.getBoundingClientRect();
    const cross = dim.querySelector('[data-hud="win-close"]') as HTMLElement;
    const pause = document.querySelector('[data-hud="pause"]')!;
    const small = Array.from(dim.querySelectorAll('button'))
      .filter((b) => b.getBoundingClientRect().width > 0 && getComputedStyle(b).display !== 'none')
      .filter((b) => b.getBoundingClientRect().height < 43.5 || b.getBoundingClientRect().width < 43.5)
      .map((b) => b.className);
    return {
      id: dim.dataset['window'] ?? '',
      w: p.width,
      h: p.height,
      bottom: p.bottom,
      cross: cross.hidden ? 0 : cross.getBoundingClientRect().width,
      hudShown: getComputedStyle(pause).visibility !== 'hidden',
      small,
    };
  });
}

test.describe('MU phone screens', () => {
  test('MU-03 gate: the dark sign in the world and one plaque «N more levels to the gate» in the slot, nothing else', async ({ page, openGame }) => {
    await openGame('pace=stages');
    const st = STAGES[0]!.stages[3]!;
    const need = st.level;
    // Round of fixes 3: by the ridge, as l2 — the sign on its post right of the hero (further off it hides under the HUD).
    // MU round 5: not the first run of mountain 1 (there the plaque points to a treadmill — truthful-pad-hints).
    await prepare(page, `window.__TEST__.setSummits(1); window.__TEST__.setStat(${threshold(Math.max(1, need - 3))}); window.__TEST__.teleport(${st.z0 - 5});`);
    await page.waitForTimeout(500);
    await expect(page.locator('[data-role="need"]')).toHaveText(/Ещё 3 уровня до рубежа/);
    await expect.poll(() => slotShown(page)).toEqual(['need']);
    await expect(page.locator('.hud-goal')).toBeHidden();
    // Signs farther than they read are not drawn.
    const far = await page.evaluate(() => {
      const t = window.__TEST__!;
      const st = t.state();
      return st.gatesOpen.map((_, i) => ({ i, box: t.signBox(i) })).filter((x) => Math.abs(x.box.center[2] - (st.hero?.z ?? 0)) > 80 && !x.box.hidden).length;
    });
    expect(far).toBe(0);
    // Round of fixes 2: on the phone the board is a plaque of the HUD over the post (round 3: nothing of it in the world).
    await expect(page.locator('[data-role="gate-sign"].shown'), 'the ridge sign by the hero is shown').toBeVisible();
    expect(await labelsOverHud(page), 'world labels 8 px off the HUD').toEqual([]);
    await page.screenshot({ path: 'docs/evidence/MU/l2-gate.png' });
  });

  test('MU-04 finish: the light plaque before the pad, one «+N» with the coin on it, the counter gets the coins', async ({ page, openGame }) => {
    await openGame('pace=stages');
    const st = STAGES[0]!.stages[2]!;
    await prepare(page, `window.__TEST__.setStat(${threshold(st.level + 2)}); window.__TEST__.teleport(${st.finish[0] + 2}, ${st.pad.x}, ${st.y + 1});`);
    await expect(page.locator('[data-role="pad-label"].shown')).toBeVisible();
    await expect(page.locator('[data-role="pad-label"]')).toContainText(/Награда этапа/);
    await expect(page.locator('[data-role="pad-label"] .hud-pad-sub')).toHaveText(/можно бежать мимо/);
    expect(await labelsOverHud(page), 'world labels 8 px off the HUD').toEqual([]);
    await page.screenshot({ path: 'docs/evidence/MU/l3-stage-finish-before.png' });
    const before = (await testState(page)).coins;
    let toasts = 0;
    await page.exposeFunction('__toastSeen', () => void toasts++);
    await page.evaluate(() => {
      const el = document.querySelector('[data-role="toast"]')!;
      new MutationObserver(() => {
        if (el.classList.contains('shown')) {
          const w = window as unknown as { __toastSeen: () => void; __toastTexts?: string[] };
          (w.__toastTexts ??= []).push(el.textContent ?? '');
          w.__toastSeen();
        }
      }).observe(el, { attributes: true, attributeFilter: ['class'] });
    });
    await page.evaluate((p) => window.__TEST__!.teleport(p.z, p.x, p.y + 1), st.pad);
    await page.waitForFunction(() => window.__TEST__!.state().padsTaken > 0, undefined, { timeout: 20_000 });
    await page.waitForTimeout(300);
    await expect(page.locator('[data-role="toast"] .hud-toast-main')).toContainText('+');
    expect(await page.locator('[data-role="toast"] .hud-toast-main svg').count()).toBe(1);
    await page.screenshot({ path: 'docs/evidence/MU/l3-stage-finish.png' });
    await page.waitForTimeout(2500);
    console.log('TOASTS', toasts, await page.evaluate(() => (window as unknown as { __toastTexts?: string[] }).__toastTexts));
    expect(toasts).toBe(1);
    expect((await testState(page)).coins).toBeGreaterThan(before);
    await expect(page.locator('[data-role="coin-gain"]')).toBeHidden();
  });

  test('MU-05 toast: «LEVEL UP!» in the slot 1.2 s over «Level N», not on the hero, the hint hides and comes back, «+N» one at a time', async ({ page, openGame }) => {
    await openGame('pace=stages');
    await prepare(page, `window.__TEST__.setStat(${threshold(4)});`);
    await page.waitForTimeout(400);
    // What the slot held when the toast came up and when it went (the machine may be slow: the page records it).
    await page.evaluate(() => {
      const el = document.querySelector('[data-role="toast"]')!;
      const hud = document.querySelector('[data-role="hud"]')!;
      const w = window as unknown as { __toast: Array<Record<string, unknown>> };
      w.__toast = [];
      new MutationObserver(() => {
        const r = el.getBoundingClientRect();
        const t = window.__TEST__!;
        const h = t.state().hero!;
        w.__toast.push({
          shown: el.classList.contains('shown'),
          main: el.querySelector('.hud-toast-main')?.textContent,
          sub: el.querySelector('.hud-toast-sub')?.textContent,
          bottom: r.bottom,
          slot: hud.getAttribute('data-slot'),
          gains: document.querySelectorAll('.hud-gain.show').length,
          gainVisible: Array.from(document.querySelectorAll('.hud-gain')).some((g) => getComputedStyle(g).visibility !== 'hidden' && g.classList.contains('show')),
          heroY: t.project(h.x, h.y + 1.6, h.z).y,
          at: performance.now(),
        });
      }).observe(el, { attributes: true, attributeFilter: ['class'] });
    });
    await page.evaluate((n) => window.__TEST__!.setStat(n), threshold(5) + 1);
    await page.waitForFunction(() => (window as unknown as { __toast: Array<{ shown: boolean }> }).__toast.some((x) => !x.shown), undefined, { timeout: 20_000 });
    const log = await page.evaluate(() => (window as unknown as { __toast: Array<{ shown: boolean; main: string; sub: string; bottom: number; slot: string; gainVisible: boolean; heroY: number; at: number }> }).__toast);
    const up = log.find((x) => x.shown)!;
    const down = log.find((x) => !x.shown)!;
    expect(up.main).toBe('УРОВЕНЬ ВЫШЕ!');
    expect(up.sub).toBe('Уровень 5');
    expect(up.slot).toBe('toast');
    expect(up.bottom).toBeLessThanOrEqual(96 + 1);
    expect(up.heroY).toBeGreaterThan(up.bottom);
    expect(up.gainVisible).toBe(false);
    expect(down.at - up.at).toBeGreaterThan(900);
    expect(down.at - up.at).toBeLessThan(2500);
    // A run: «+N» by the hero is one number, never more than one node up; one message in the slot.
    await page.evaluate(() => window.__TEST__!.stick(0, -1));
    let most = 0;
    for (let i = 0; i < 12; i++) {
      most = Math.max(most, await page.locator('.hud-gain.show').count());
      const shown = await slotShown(page);
      expect(shown.length, shown.join(',')).toBeLessThanOrEqual(1);
      await page.waitForTimeout(100);
    }
    await page.evaluate(() => window.__TEST__!.stick(0, 0));
    expect(most).toBeLessThanOrEqual(1);
  });

  test('round of fixes 3 (staff 19.10): over a run from the camp past bots, a pad and a ridge no world label comes within 8 px of the HUD', async ({ page, openGame }) => {
    await openGame('pace=stages');
    await prepare(page, `window.__TEST__.setStat(${threshold(30)});`);
    await page.waitForTimeout(1500);
    // The bots stand up the slope — on the phone camera that is the top band of the HUD, their names hide there.
    const bad = new Set<string>();
    await page.evaluate(() => window.__TEST__!.stick(0, 1));
    for (let i = 0; i < 40; i++) {
      for (const b of await labelsOverHud(page)) bad.add(b);
      await page.waitForTimeout(250);
    }
    await page.evaluate(() => window.__TEST__!.stick(0, 0));
    expect([...bad]).toEqual([]);
  });

  test('round of fixes 4 (staff 19.10): «+N» with the coin, «LEVEL UP!» at 130 % text and the giant\'s words stand in the slot, 8 px under the stage strip', async ({ page, openGame }) => {
    await openGame('pace=stages');
    const st = STAGES[0]!.stages[2]!;
    await prepare(page, `window.__TEST__.setStat(${threshold(st.level + 2)});`);
    /** The glyphs of the toast shown now (a range over its text: the line box is tighter than the letters) and the strip. */
    const gap = (): Promise<{ text: string; top: number; bottom: number; strip: number }> =>
      page.evaluate(() => {
        const el = document.querySelector('[data-role="toast"]')!;
        const range = document.createRange();
        range.selectNodeContents(el);
        const rs = Array.from(range.getClientRects()).filter((r) => r.width > 0);
        const icon = el.querySelector('svg')?.getBoundingClientRect();
        if (icon) rs.push(icon);
        return {
          text: el.textContent ?? '',
          top: Math.min(...rs.map((r) => r.top)),
          bottom: Math.max(...rs.map((r) => r.bottom)),
          strip: document.querySelector('.hud-mountain')!.getBoundingClientRect().bottom,
        };
      });
    // The coins of a stage finish: «+N» with the coin.
    await page.evaluate((p) => window.__TEST__!.teleport(p.z, p.x, p.y + 1), st.pad);
    await page.waitForFunction(() => window.__TEST__!.state().padsTaken > 0, undefined, { timeout: 20_000 });
    await expect(page.locator('[data-role="toast"].shown .hud-toast-main svg')).toHaveCount(1);
    const coins = await gap();
    expect(coins.top - coins.strip, `«${coins.text}» under the strip`).toBeGreaterThanOrEqual(8);
    await page.screenshot({ path: 'docs/evidence/MU/l3-stage-finish.png' });
    // The giant's words and «LEVEL UP!» at 130 % text.
    await scaleText(page, 1.3);
    for (const [text, sub] of [['Обеги великана сбоку!', ''], ['УРОВЕНЬ ВЫШЕ!', 'Уровень 20']] as const) {
      await expect(page.locator('[data-role="toast"].shown')).toHaveCount(0, { timeout: 10_000 });
      await page.evaluate(([a, b]) => {
        window.__TEST__!.showToast(a, 2, true);
        if (b) document.querySelector('[data-role="toast"] .hud-toast-sub')!.textContent = b;
      }, [text, sub] as const);
      await page.waitForTimeout(350);
      const g = await gap();
      expect(g.text).toContain(text);
      // Round 3: the strip slides in and out (0.3 s) — a subpixel of its slide is not a breach of the 8 px.
      expect(g.top - g.strip, `«${text}» at 130 %: under the strip`).toBeGreaterThanOrEqual(7.5);
      if (sub) await page.screenshot({ path: 'docs/evidence/MU/l4-level-up-130.png' });
    }
  });

  for (const view of [MU_VIEW, { width: 915, height: 412 }]) {
    test(`round of fixes 5 (staff 19.10) at ${view.width} × ${view.height}: «Gifts» whole, «Shop → Steps» and «Wardrobe» show their first row whole and the next one peeking, tabs stay over the list`, async ({ page, openGame }) => {
      await page.setViewportSize(view);
      await openGame('pace=stages');
      await prepare(page, `window.__TEST__.setStat(${threshold(30)});`);
      const body = (): Promise<{ top: number; bottom: number; scroll: number; client: number; cards: Array<{ top: number; bottom: number }>; tabs: number | null }> =>
        page.evaluate(() => {
          const b = document.querySelector('[data-role="window"].open .win-body')!;
          const r = b.getBoundingClientRect();
          const tabs = b.querySelector('.win-tabs');
          return {
            top: r.top,
            bottom: r.bottom,
            scroll: b.scrollHeight,
            client: b.clientHeight,
            cards: Array.from(b.querySelectorAll('.card')).map((c) => c.getBoundingClientRect()).filter((c) => c.width > 0).map((c) => ({ top: c.top, bottom: c.bottom })),
            tabs: tabs ? tabs.getBoundingClientRect().top : null,
          };
        });
      // «Gifts»: everything in the panel, the bottom row whole — no scrolling at all.
      await tap(page, 'gift');
      await expect(page.locator('[data-role="window"].open')).toBeVisible();
      const g = await body();
      expect(g.scroll, 'gifts: nothing under the fold').toBeLessThanOrEqual(g.client + 1);
      for (const c of g.cards) expect(c.bottom, 'gifts: a card cut').toBeLessThanOrEqual(g.bottom + 0.5);
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
      await page.waitForTimeout(400);
      for (const [id, open] of [
        ['shop steps', async () => { await tap(page, 'menu-shop'); await page.locator('[data-hud="shop-tab-steps"]').click(); }],
        ['wardrobe', async () => { await tap(page, 'menu-more'); await page.locator('[data-hud="more-wardrobe"]').click(); }],
      ] as const) {
        await open();
        await expect(page.locator('[data-role="window"].open')).toBeVisible();
        await page.waitForTimeout(200);
        const w = await body();
        const first = Math.min(...w.cards.map((c) => c.top));
        const row = w.cards.filter((c) => Math.abs(c.top - first) < 2);
        for (const c of row) expect(c.bottom, `${id}: the first row whole`).toBeLessThanOrEqual(w.bottom + 0.5);
        const next = w.cards.filter((c) => c.top > first + 2);
        // Round of fixes 2: the five sets of steps fit one row (as «Footsteps»); a longer list peeks and scrolls.
        if (next.length > 0) {
          expect(Math.min(...next.map((c) => c.top)), `${id}: the next row peeks`).toBeLessThan(w.bottom - 8);
          expect(w.scroll, `${id}: the list scrolls`).toBeGreaterThan(w.client);
        }
        // Scrolled down, the tabs stay at the top of the middle.
        expect(w.tabs, `${id}: tabs`).not.toBeNull();
        await page.evaluate(() => {
          const b = document.querySelector('[data-role="window"].open .win-body')!;
          b.scrollTop = b.scrollHeight;
        });
        await page.waitForTimeout(150);
        const after = await body();
        // Round of fixes 2: the wardrobe keeps its tabs under the hero in the side column — they stay where they were.
        expect(Math.abs(after.tabs! - (id === 'wardrobe' ? w.tabs! : after.top)), `${id}: tabs pinned over the list`).toBeLessThanOrEqual(1);
        await page.screenshot({ path: `docs/evidence/MU/w-${id.replace(' ', '-')}-${view.width}-scrolled.png` });
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
        await page.waitForTimeout(400);
      }
    });
  }

  test('round of fixes 6 (staff 19.10): sneakers drawn, «+N per step», buttons of a row on one line, both balances in the shop head; «Take» of the calendar no wider than «Continue»', async ({ page, openGame }) => {
    await openGame('pace=stages');
    await prepare(page, `window.__TEST__.setStat(${threshold(30)});`);
    await tap(page, 'pause');
    const cont = await page.locator('.mu-continue').boundingBox();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
    await page.waitForTimeout(400);
    await tap(page, 'menu-shop');
    await page.locator('[data-hud="shop-tab-shoes"]').click();
    const win = page.locator('[data-role="window"].open');
    await expect(win.locator('[data-role="shop-coins"] svg')).toHaveCount(1);
    await expect(win.locator('[data-role="shop-trophies"] svg')).toHaveCount(1);
    await expect(win.locator('[data-role="shop-trophies"]')).toHaveText('3');
    const cards = win.locator('[data-role="shop-grid"] .card');
    expect(await cards.count()).toBeGreaterThan(1);
    expect(await win.locator('[data-role="shop-grid"] .card-swatch').count(), 'no empty squares').toBe(0);
    expect(await win.locator('[data-role="shop-grid"] .card-pic svg').count()).toBe(await cards.count());
    await expect(win.locator('[data-role="shop-grid"] .card-big').first()).toHaveText(/^\+\d+ за шаг$/);
    // The last element of every card (button or lock) ends on one line within a row.
    const rows = await page.evaluate(() => {
      const out: Record<string, number[]> = {};
      for (const c of Array.from(document.querySelectorAll('[data-role="window"].open [data-role="shop-grid"] .card'))) {
        const r = c.getBoundingClientRect();
        const last = c.lastElementChild!.getBoundingClientRect();
        (out[Math.round(r.top)] ??= []).push(Math.round(r.bottom - last.bottom));
      }
      return Object.values(out);
    });
    for (const row of rows) expect(Math.max(...row) - Math.min(...row), `bottoms of a row ${row.join(',')}`).toBeLessThanOrEqual(1);
    await page.screenshot({ path: 'docs/evidence/MU/w-shop.png' });
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
    await page.waitForTimeout(400);
    await tap(page, 'menu-more');
    await page.locator('[data-hud="more-daily"]').click();
    const take = await page.locator('[data-hud="daily-claim"]').boundingBox();
    expect(take!.width, '«Take» no wider than «Continue»').toBeLessThanOrEqual(cont!.width + 1);
    await page.screenshot({ path: 'docs/evidence/MU/w-daily.png' });
  });

  test('round of fixes 7 (staff 19.10): every window — numbers «5 300», a title alone on the line of the cross, 8 px from a mark to its words, body text not bold, a lock on one line inside its card, tiers counted from 1, tabs at the top of the list', async ({ page, openGame }) => {
    test.setTimeout(240_000);
    await openGame('pace=stages');
    await prepare(page, `window.__TEST__.setStat(${threshold(30)});`);
    const more = (id: string) => async (): Promise<void> => {
      await tap(page, 'menu-more');
      await page.locator(`[data-hud="more-${id}"]`).click();
    };
    const open: Array<[string, () => Promise<void>]> = [
      ['gifts', () => tap(page, 'gift')], ['camp-teleport', () => tap(page, 'menu-teleport')], ['pause', () => tap(page, 'pause')], ['more', () => tap(page, 'menu-more')],
      ['shop', () => tap(page, 'menu-shop')], ['pets', () => tap(page, 'menu-pets')], ['footsteps', more('footsteps')], ['wardrobe', more('wardrobe')], ['rebirth', more('rebirth')],
      ['records', more('records')], ['quests', more('quests')], ['daily', more('daily')],
    ];
    const tiers: string[] = [];
    for (const [id, fn] of open) {
      await fn();
      await expect(page.locator('[data-role="window"].open')).toBeVisible();
      await page.waitForTimeout(250);
      const r = await page.evaluate(() => {
        const w = document.querySelector('[data-role="window"].open')!;
        const bad: string[] = [];
        const text = (w as HTMLElement).innerText;
        for (const m of text.matchAll(/\d{4,}/g)) bad.push(`number without a space: ${m[0]}`);
        const title = w.querySelector('.win-title')!.getBoundingClientRect();
        const sub = w.querySelector('.win-sub') as HTMLElement;
        const cross = (w.querySelector('.win-close') as HTMLElement).getBoundingClientRect();
        if (!sub.textContent && cross.width > 0 && Math.abs(title.top + title.height / 2 - (cross.top + cross.height / 2)) > 2) bad.push('the title off the line of the cross');
        for (const b of Array.from(w.querySelectorAll('button'))) {
          const mark = b.querySelector(':scope > .mark:first-child');
          const words = Array.from(b.childNodes).find((n) => n.nodeType === 3 && n.textContent!.trim());
          if (!mark || !words) continue;
          const range = document.createRange();
          range.selectNodeContents(words);
          const tr = range.getBoundingClientRect();
          const mr = mark.getBoundingClientRect();
          const gap = mr.left < tr.left ? tr.left - mr.right : mr.left - tr.right;
          if (gap < 6 || gap > 13) bad.push(`mark ${Math.round(gap)} px from «${b.textContent!.trim()}»`);
        }
        for (const e of Array.from(w.querySelectorAll('.mu-row-label, .qs-text, .rb-list, .win-row'))) if (Number(getComputedStyle(e).fontWeight) > 500) bad.push(`bold body text «${e.textContent!.trim().slice(0, 20)}»`);
        for (const e of Array.from(w.querySelectorAll<HTMLElement>('.card-lock, .foot-lock'))) {
          const lr = e.getBoundingClientRect();
          const card = e.closest('.card')?.getBoundingClientRect();
          const line = Number.parseFloat(getComputedStyle(e).fontSize) * 1.6;
          const words = Array.from(e.querySelectorAll('span')).map((x) => x.getBoundingClientRect()).filter((x) => x.width > 0 && x.height < line);
          if (words.length === 0 && lr.width > 0) bad.push(`lock on two lines «${e.textContent!.trim()}»`);
          if (card && (lr.left < card.left - 0.5 || lr.right > card.right + 0.5)) bad.push(`lock out of its card «${e.textContent!.trim()}»`);
        }
        const tabs = w.querySelector('.win-tabs');
        if (tabs && !tabs.parentElement!.classList.contains('win-body') && !tabs.parentElement!.classList.contains('wr-side')) bad.push('tabs out of the list top');
        return { bad, tiers: text.match(/Ступень \d+/g) ?? [] };
      });
      expect(r.bad, id).toEqual([]);
      tiers.push(...r.tiers.map((x) => `${id}: ${x}`));
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
      await page.waitForTimeout(400);
    }
    // One numbering: a newcomer is on tier 1 (records), the rebirth brings tier 2, no «Ступень 0» anywhere.
    expect(tiers).toContain('records: Ступень 1');
    expect(tiers).toContain('rebirth: Ступень 2');
    expect(tiers.filter((x) => x.endsWith('Ступень 0'))).toEqual([]);
  });

  test('MU-06 camp: «Camp · mountain 1», no shoes button, no ads or group buttons on the scene, bot names 11 px', async ({ page, openGame }) => {
    await openGame('pace=stages');
    await prepare(page, `window.__TEST__.setStat(${threshold(30)});`);
    await expect(page.locator('.hud-mountain-label')).toHaveText('Лагерь · гора 1');
    await expect(page.locator('[data-hud="shoes"]')).toBeHidden();
    await expect(page.locator('.base-gifts .community-gift:visible')).toHaveCount(0);
    await expect(page.locator('[data-hud^="ad-stat_now"]:visible')).toHaveCount(0);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.bot-labels')!).fontSize)).toBe('11px');
    expect(await labelsOverHud(page), 'world labels 8 px off the HUD').toEqual([]);
    await page.screenshot({ path: 'docs/evidence/MU/l5-camp.png' });
  });

  test('MU-07, MU-08, MU-13: windows of one style — width, height by the content, the HUD hidden, one at a time, cross 44, Esc and the veil close, swipes scroll', async ({ page, openGame }) => {
    await openGame('pace=stages');
    await prepare(page, `window.__TEST__.setStat(${threshold(30)});`);
    const open: Array<[string, () => Promise<void>, number]> = [
      ['gifts', () => tap(page, 'gift'), 640],
      ['camp-teleport', () => tap(page, 'menu-teleport'), 560],
      ['pause', () => tap(page, 'pause'), 640],
      ['more', () => tap(page, 'menu-more'), 560], // MU round 4: three in a row at 130 %
      ['shop', () => tap(page, 'menu-shop'), 640],
      ['pets', () => tap(page, 'menu-pets'), 640],
      ['footsteps', async () => { await tap(page, 'menu-more'); await page.locator('[data-hud="more-footsteps"]').click(); }, 640],
      ['wardrobe', async () => { await tap(page, 'menu-more'); await page.locator('[data-hud="more-wardrobe"]').click(); }, 640],
      ['rebirth', async () => { await tap(page, 'menu-more'); await page.locator('[data-hud="more-rebirth"]').click(); }, 640],
      ['records', async () => { await tap(page, 'menu-more'); await page.locator('[data-hud="more-records"]').click(); }, 560],
      ['quests', async () => { await tap(page, 'menu-more'); await page.locator('[data-hud="more-quests"]').click(); }, 560],
      // MU round 4 (producer 20.10: 7 days in a row at any size): the calendar up to 760 wide.
      ['daily', async () => { await tap(page, 'menu-more'); await page.locator('[data-hud="more-daily"]').click(); }, 760],
      ['promo', async () => { await tap(page, 'pause'); await page.locator('[data-hud="promo"]').click(); }, 480],
    ];
    for (const [id, how, width] of open) {
      await how();
      await expect(page.locator('[data-role="window"].open')).toHaveCount(1);
      const f = await windowFacts(page);
      expect(Math.abs(f.w - Math.min(width, MU_VIEW.width - 32)), `${id} width`).toBeLessThanOrEqual(2);
      // Round 3 (producer: windows by their content, not 300): up to the visible height minus 16 px a side.
      expect(f.h, `${id} height`).toBeLessThanOrEqual(VISIBLE_H - 16 + 0.5);
      expect(f.bottom, `${id} bottom`).toBeLessThanOrEqual(VISIBLE_H + 0.5);
      expect(f.cross, `${id} cross`).toBeGreaterThanOrEqual(44);
      expect(f.hudShown, `${id}: the HUD under it`).toBe(false);
      expect(f.small, `${id}: buttons under 44 px`).toEqual([]);
      expect(await forbiddenSymbols(page), id).toEqual([]);
      expect((await testState(page)).paused, `${id}: the game stands`).toBe(true);
      await page.screenshot({ path: `docs/evidence/MU/w-${id}.png` });
      // MU-13: a finger swipe over the middle scrolls it when it is taller than the window.
      const body = page.locator('[data-role="window"].open .win-body');
      const sizes = await body.evaluate((b) => ({ sh: b.scrollHeight, ch: b.clientHeight }));
      if (sizes.sh > sizes.ch + 4) {
        const r = (await body.boundingBox())!;
        await swipe(page, r.x + r.width / 2, r.y + r.height - 10, Math.min(120, r.height - 20));
        await page.waitForTimeout(400);
        expect(await body.evaluate((b) => b.scrollTop), `${id}: a swipe scrolls`).toBeGreaterThan(0);
      }
      if (id === 'pause' || id === 'gifts') {
        // A tap on the veil closes it.
        await page.touchscreen.tap(8, 8);
      } else await page.keyboard.press('Escape');
      await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
    }
  });

  test('MU-07 w5-summit: no cross, rows «chest · cup · next · tomorrow», the quiet «Ad: ×2» by the chest, the blue «Next»', async ({ page, openGame }) => {
    await openGame('pace=stages');
    await prepare(page);
    const w = (stagesWorlds as unknown as { worlds: Array<{ segments: Array<{ type: string; z: number }> }> }).worlds[0]!;
    const portal = w.segments.find((x) => x.type === 'portal')!;
    const last = STAGES[0]!.stages[STAGES[0]!.stages.length - 1]!;
    await page.evaluate(([s, z, y]) => {
      window.__TEST__!.setStat(s);
      window.__TEST__!.teleport(z, 0, y + 0.5);
    }, [threshold(last.level) * 2, last.finish[0] + 2, last.y] as const);
    await page.waitForTimeout(300);
    await page.evaluate((z) => window.__TEST__!.botPath([[0, z + 2]]), portal.z);
    await expect(page.locator('[data-role="window"][data-window="summit"]')).toBeVisible({ timeout: 40_000 });
    await page.evaluate(() => window.__TEST__!.botPath(null));
    const win = page.locator('[data-role="window"].open');
    await expect(win.locator('[data-hud="win-close"]')).toBeHidden();
    await expect(win.locator('[data-hud="win-next"]')).toBeVisible();
    await expect(win.locator('.sm-label')).toContainText(['Сундук', 'Кубок вершины', 'Следующая гора']);
    const panel = (await win.locator('.win-panel').boundingBox())!;
    expect(Math.abs(panel.width - 480)).toBeLessThanOrEqual(2);
    expect(panel.height).toBeLessThanOrEqual(VISIBLE_H - 16 + 0.5);
    const ad = win.locator('[data-hud="summit-ad"]');
    await expect(ad).toContainText('Реклама: ×2');
    const a = (await ad.boundingBox())!;
    expect(a.y + a.height, 'the ad is not in the bottom third').toBeLessThan(panel.y + (panel.height * 2) / 3);
    expect(await forbiddenSymbols(page)).toEqual([]);
    await page.screenshot({ path: 'docs/evidence/MU/w-summit.png' });
  });

  test('MU-12: a set of steps bought in the «Steps» tab of the shop is chosen in the «Footsteps» window; no second purchase', async ({ page, openGame }) => {
    await openGame('pace=stages');
    await prepare(page);
    await tap(page, 'menu-shop');
    await page.locator('[data-hud="shop-tab-steps"]').click();
    const velvet = page.locator('[data-role="window"].open [data-item="velvet_snow"]');
    await velvet.locator('[data-hud="shop-item"]').click();
    await expect(velvet.locator('.foot-chosen')).toBeVisible();
    await expect(velvet.locator('button[data-hud="shop-item"]')).toHaveCount(0);
    expect((await testState(page)).coins).toBe(5300 - 150);
    expect((await testState(page)).footsteps!.bought).toContain('velvet_snow');
    await page.screenshot({ path: 'docs/evidence/MU/w-shop-steps.png' });
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
    await tap(page, 'menu-more');
    await page.locator('[data-hud="more-footsteps"]').click();
    await expect(page.locator('[data-footsteps="velvet_snow"]')).toHaveAttribute('data-state', 'on');
    await expect(page.locator('[data-footsteps="magic_snow"] [data-hud="footsteps-shop"]')).toBeVisible();
    await expect(page.locator('[data-hud="footsteps-buy"]')).toHaveCount(0);
  });

  test('MU-09, MU-13 (4): an upright touch screen gets «Turn your phone», the game stands; turned back — gone without a reload', async ({ page, openGame }) => {
    await openGame('pace=stages');
    await page.evaluate(() => ((window as unknown as { __mark: number }).__mark = 7));
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator('[data-role="rotate"].shown')).toBeVisible();
    await expect(page.locator('[data-role="rotate"]')).toContainText('Поверни телефон');
    await expect(page.locator('[data-role="rotate"]')).toContainText('Так видно весь склон');
    expect((await testState(page)).pauseReasons).toContain('orientation');
    await page.screenshot({ path: 'docs/evidence/MU/p1-rotate.png' });
    await page.setViewportSize(MU_VIEW);
    await expect(page.locator('[data-role="rotate"].shown')).toHaveCount(0);
    expect((await testState(page)).pauseReasons).not.toContain('orientation');
    expect(await page.evaluate(() => (window as unknown as { __mark?: number }).__mark)).toBe(7);
    expect((await hudBoxes(page)).length).toBeGreaterThan(5);
  });
});
