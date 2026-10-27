import type { Page } from '@playwright/test';
import { test, expect, testState, waitTicks } from './fixtures.ts';
import { STAGES, flagOf, threshold } from './lv-stage-data.ts';

// K-01 (the rest of D20, staff's answer to Q-D20-2): on the plates of mountain 1 the run off the edge jumps by itself and
// the plaque says «Jump!» (held ≥ 2 s), never «Stand on the treadmill» over the water; at the canopy of a closed ridge the
// avalanche comes within 90 s and says «Under the roof!»; «Phew, made it!» before «LEVEL UP! N»; bot names never overlap.
const W1 = STAGES[0]!;
const ST = (n: number) => W1.stages.find((s) => s.n === n)!;
const TPS = 60;

/** Every change of an element (shown, text) with the real time — the D-05 watcher, for any selector. */
const watch = (page: Page, sel: string, name: string): Promise<void> =>
  page.evaluate(
    ([s, n]) => {
      const w = window as unknown as Record<string, Array<{ text: string; on: boolean; t: number }>>;
      w[n] = [];
      const el = document.querySelector(s)!;
      let last = '';
      const note = (): void => {
        const on = el.classList.contains('shown');
        const key = `${on}|${el.textContent}`;
        if (key === last) return;
        last = key;
        w[n]!.push({ text: el.textContent ?? '', on, t: performance.now() });
      };
      note();
      new MutationObserver(note).observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
    },
    [sel, name] as const,
  );
const logOf = (page: Page, name: string): Promise<Array<{ text: string; on: boolean; t: number }>> =>
  page.evaluate((n) => (window as unknown as Record<string, Array<{ text: string; on: boolean; t: number }>>)[n]!, name);
const fmt = (log: Array<{ text: string; on: boolean; t: number }>): string => log.map((x) => `${x.on ? '+' : '-'}${x.text}@${Math.round(x.t)}`).join(' ');

test.describe('K-01 · plates, canopy, toasts, names (880 × 405)', () => {
  test.use({ viewport: { width: 880, height: 405 } });

  test('K-01: forward only over the plates of stage 5 — at most 3 falls, «Jump!» held ≥ 2 s, never «Stand on the treadmill»', async ({ page, openGame }) => {
    test.setTimeout(180_000);
    await openGame('pace=stages&mock_device=mobile');
    const st = ST(5);
    const f = flagOf(1, st);
    await page.evaluate(
      ([s, z, y]) => {
        window.__TEST__!.setFlag('firstWaveDone', true);
        window.__TEST__!.setFlag('giantFree', true);
        window.__TEST__!.holdWave(9000);
        // The treadmill step of the tutorial still up (playtest D20: its plaque hung over the water).
        window.__TEST__!.setTutor(0);
        window.__TEST__!.setStat(s);
        window.__TEST__!.teleport(z, 0, y + 0.5);
      },
      [threshold(st.level) * 1.01, f.z, f.y] as const,
    );
    await waitTicks(page, 10);
    await watch(page, '[data-role=tutor]', '__tutor');
    const from = (await testState(page)).simTick;
    await page.evaluate(() => window.__TEST__!.stick(0, 1));
    await page.waitForFunction((end) => (window.__TEST__!.state().hero?.z ?? 0) > end + 2, st.end, { timeout: 150_000 });
    await page.evaluate(() => window.__TEST__!.stick(0, 0));
    // The last «Jump!» runs out its hold past the stage.
    await page.waitForTimeout(2500);
    const s = await testState(page);
    const falls = await page.evaluate((a) => window.__TEST__!.simEvents.filter((e) => e.name === 'fall' && e.tick > a).length, from);
    const log = await logOf(page, '__tutor');
    console.log('K-01 plates', JSON.stringify({ falls, sec: (s.simTick - from) / TPS }), fmt(log));
    expect(falls, 'falls on the plates').toBeLessThanOrEqual(3);
    expect(log.filter((x) => x.on && /Встань на дорожку/.test(x.text)), fmt(log)).toEqual([]);
    const ons = log.flatMap((x, i) => (x.on && /Прыгай/.test(x.text) && !(log[i - 1]?.on && /Прыгай/.test(log[i - 1]!.text)) ? [i] : []));
    expect(ons.length, `«Jump!» shown: ${fmt(log)}`).toBeGreaterThan(0);
    for (const i of ons) {
      const off = log.slice(i + 1).find((x) => !x.on || !/Прыгай/.test(x.text));
      expect(off, `«Jump!» went off: ${fmt(log)}`).toBeDefined();
      expect((off!.t - log[i]!.t) / 1000, fmt(log)).toBeGreaterThanOrEqual(2);
    }
  });

  test('K-01: 3 units under the wall «8» the avalanche warns within 90 s — «Under the roof!»; in the canopy «Phew, made it!» before «LEVEL UP! 5»', async ({ page, openGame }) => {
    test.setTimeout(180_000);
    await openGame('pace=stages&mock_device=mobile');
    const ridge = ST(3).z0;
    await page.evaluate(
      ([z, s]) => {
        window.__TEST__!.setFlag('firstWaveDone', true);
        window.__TEST__!.setFlag('giantFree', true);
        window.__TEST__!.setStat(s);
        window.__TEST__!.teleport(z, 20);
      },
      [ridge - 3, threshold(4)] as const,
    );
    await waitTicks(page, 5);
    const from = (await testState(page)).simTick;
    let warn = -1;
    for (let i = 0; i < 100 && warn < 0; i++) {
      await page.evaluate(() => window.__TEST__!.runSim(1));
      warn = await page.evaluate((a) => window.__TEST__!.simEvents.find((e) => e.name === 'waveWarn' && e.tick > a)?.tick ?? -1, from);
    }
    expect(warn, 'a wave warned').toBeGreaterThan(0);
    console.log('K-01 wall 8: first warning after', (warn - from) / TPS, 's');
    expect((warn - from) / TPS).toBeLessThanOrEqual(90);
    // Slowed down while the plaque is read (the warning of the first wave is 5 s).
    await page.evaluate(() => window.__TEST__!.setTimeScale(0.1));
    await expect(page.locator('[data-role="wave-sub"]')).toHaveText('Под навес!');
    await expect(page.locator('[data-role="tutor"].shown', { hasText: 'Спрячься за камень' })).toHaveCount(0);
    // Into the canopy; a level grows under the banner — «Phew, made it!» comes first.
    await watch(page, '[data-role="toast"]', '__toasts');
    const roof = W1.segments.find((q) => q.type === 'niche' && q['through'] === true && Math.abs(q.z - (ridge - 6)) < 9)!;
    await page.evaluate(
      ([z, s, y]) => {
        window.__TEST__!.teleport(z, 0, y + 0.5);
        window.__TEST__!.setStat(s);
      },
      [ridge - 6, threshold(5), roof['y'] as number] as const,
    );
    await page.evaluate(() => window.__TEST__!.setTimeScale(1));
    await page.waitForFunction(() => /уровень выше/i.test(document.querySelector('[data-role="toast"].shown')?.textContent ?? ''), undefined, { timeout: 60_000 });
    const log = await logOf(page, '__toasts');
    const phew = log.findIndex((x) => x.on && /Уф, успел/.test(x.text));
    const level = log.findIndex((x) => x.on && /уровень выше/i.test(x.text));
    expect(phew, fmt(log)).toBeGreaterThanOrEqual(0);
    expect(phew, fmt(log)).toBeLessThan(level);
    expect(log[level]!.text, 'the level in the toast').toMatch(/УРОВЕНЬ ВЫШЕ! 5/);
  });

  test('K-01: bot names never run into each other (6 bots, the first seconds of the run)', async ({ page, openGame }) => {
    await openGame('pace=stages&mock_device=mobile&quality=high&seed=5');
    await page.evaluate(() => window.__TEST__!.setFlag('firstWaveDone', true));
    await page.evaluate(() => window.__TEST__!.stick(0, 1));
    let seen = 0;
    for (let k = 0; k < 40; k++) {
      await page.waitForTimeout(150);
      const boxes = await page.locator('[data-role="bot-label"]').evaluateAll((els) =>
        els.filter((e) => Number((e as HTMLElement).style.opacity || 0) > 0 && e.textContent !== '').map((e) => {
          const r = e.getBoundingClientRect();
          return { t: e.textContent, x0: r.left, y0: r.top, x1: r.right, y1: r.bottom };
        }),
      );
      seen = Math.max(seen, boxes.length);
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const [a, b] = [boxes[i]!, boxes[j]!];
          const cross = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
          expect(cross, `${a.t} and ${b.t}: ${JSON.stringify([a, b])}`).toBe(false);
        }
    }
    expect(seen, 'names on screen').toBeGreaterThan(0);
  });
});
