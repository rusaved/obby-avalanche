import { test, expect, waitTicks } from './fixtures.ts';
import { STAGES, flagOf, threshold } from './lv-stage-data.ts';

// «Лавина 23» on the phone (mobile project: 844 × 390, touch).

// R-04 (pass 21: «Continue from stage N» came 12–15 s after the roll-back, the avalanche plaque and toasts held the slot):
// after a fall it is in the slot within 3 s and stays there without blinking — with a wave warning and a toast over it too.
for (const busy of [false, true])
  test(`R-04: «Continue from stage N» within 3 s of the roll-back, no blinking${busy ? ' (a wave warning and a toast at once)' : ''}`, async ({ page, openGame }) => {
    test.setTimeout(180_000);
    await openGame('pace=stages&mock_ad=ok');
    await page.evaluate(() => window.__TEST__!.setFlag('giantFree', true));
    await waitTicks(page, 10);
    const st = STAGES[0]!.stages.find((x) => x.n > 2 && x.width === 'bridge' && STAGES[0]!.stages[x.n - 2]!.type === 'maze')!;
    await page.evaluate(([s, z, y]) => {
      window.__TEST__!.setPlaySec(400);
      window.__TEST__!.setStat(s);
      window.__TEST__!.teleport(z, 0, y + 0.5);
    }, [threshold(st.level) * 1.01, st.start - 4, st.y] as const);
    await waitTicks(page, 10);
    await page.evaluate((z) => window.__TEST__!.botPath([[30, z]]), st.start + 6);
    await page.waitForFunction(() => window.__TEST__!.state().caught !== null, undefined, { timeout: 20_000 });
    await page.evaluate(() => window.__TEST__!.botPath(null));
    await page.waitForFunction(() => !window.__TEST__!.state().caught, undefined, { timeout: 20_000 });
    // From the roll-back: the slot sampled every 100 ms for 6 s (page clock — the game's own runs on).
    const seen = await page.evaluate(async (b) => {
      if (b) {
        window.__TEST__!.triggerWave();
        window.__TEST__!.showToast('Уровень выше! 5', 3);
      }
      const out: boolean[] = [];
      for (let i = 0; i < 60; i++) {
        const el = document.querySelector<HTMLElement>('button.hud-ad[data-ad=continue_free]');
        out.push(!!el && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden' && Number(getComputedStyle(el).opacity) > 0.5);
        await new Promise((r) => setTimeout(r, 100));
      }
      return out;
    }, busy);
    const first = seen.indexOf(true);
    console.log(`R-04: «Continue from stage N» ${(first / 10).toFixed(1)} s after the roll-back${busy ? ' (a wave warning and a toast)' : ''}`);
    expect(first, 'shown within 3 s').toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(30);
    expect(seen.slice(first).every(Boolean), `no blinking: ${seen.map((v) => (v ? 1 : 0)).join('')}`).toBe(true);
    await expect(page.locator('button.hud-ad[data-ad=continue_free]')).toContainText(String(st.n));
  });

// R-03 (pass 21: 2 of 2 runs without shoes): a wave at the safe finish under the wall «13» — its belt brings the
// number while the wave runs; the wall stays shut, «Phew, made it!», never «Into a cave when it comes!».
test('R-03: the wall «13» stays shut through a wave at its finish; «Phew, made it!»', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await openGame('pace=stages');
  await page.evaluate(() => window.__TEST__!.setFlag('giantFree', true));
  const st = STAGES[0]!.stages.find((x) => x.n === 4)!;
  // The ridges of mountain 1 stand at the bottoms of stages 2…10: the one of stage 4 is the third.
  const gate = st.n - 2;
  await page.evaluate(([s, z]) => {
    window.__TEST__!.setStat(s);
    window.__TEST__!.teleport(z, 0);
  }, [threshold(st.level) * 0.9, st.z0 - 30] as const);
  await waitTicks(page, 10);
  await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'warn', undefined, { timeout: 90_000 });
  await page.evaluate(() => window.__TEST__!.stick(0, 1));
  const toasts = new Set<string>();
  let openInWave = false;
  for (let i = 0; i < 400; i++) {
    const s = await page.evaluate((g) => {
      const t = window.__TEST__!.state();
      return { phase: t.wave?.phase, toast: t.waveHud?.toast ?? '', open: t.gatesOpen[g]! };
    }, gate);
    if (s.toast) toasts.add(s.toast);
    if (s.open && (s.phase === 'warn' || s.phase === 'run')) openInWave = true;
    if (s.phase === 'gone' || s.phase === 'idle') {
      if ([...toasts].some((x) => x.startsWith('Уф'))) break;
    }
    await page.waitForTimeout(100);
  }
  await page.evaluate(() => window.__TEST__!.stick(0, 0));
  expect(openInWave, 'the wall stayed shut while the wave ran').toBe(false);
  expect([...toasts].join(' | ')).toContain('Уф, успел!');
  expect([...toasts].join(' | ')).not.toContain('когда идёт лавина');
});

// R-05 (pass 21: «Jump!» stood 0,1 s for a fast hero — the toasts of his Speed took the slot): from its first frame in the
// slot it holds it 2 s, «LEVEL UP!» toasts of a hero of level 30 on the plates of stage 5 wait.
test('R-05: «Jump!» holds the slot 2 s for a fast hero, his level-up toasts after it', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await openGame('pace=stages');
  await page.evaluate(() => {
    window.__TEST__!.setFlag('firstWaveDone', true);
    window.__TEST__!.noWaves(true);
  });
  const st = STAGES[0]!.stages.find((x) => x.n === 5)!;
  const f = flagOf(1, st);
  const seen = await page.evaluate(
    async ([s, z, y]) => {
      window.__TEST__!.setStat(s);
      window.__TEST__!.teleport(z, 0, y + 0.5);
      window.__TEST__!.stick(0, 1);
      const r: Array<{ jump: boolean; toast: boolean; t: number }> = [];
      for (let i = 0; i < 60; i++) {
        const slot = document.querySelector<HTMLElement>('[data-slot]')?.dataset['slot'];
        const tutor = document.querySelector('[data-role="tutor"]');
        r.push({ jump: slot === 'tutor' && !!tutor?.classList.contains('shown') && tutor.textContent === 'Прыгай!', toast: window.__TEST__!.state().waveHud.toast !== '', t: performance.now() });
        await new Promise((res) => setTimeout(res, 100));
      }
      window.__TEST__!.stick(0, 0);
      return r;
    },
    [threshold(30), f.z, f.y] as const,
  );
  const first = seen.findIndex((x) => x.jump);
  const line = seen.map((x) => (x.jump ? 'J' : x.toast ? 't' : '.')).join('');
  console.log(`R-05: ${line}`);
  expect(first, line).toBeGreaterThanOrEqual(0);
  // The first run of «Jump!» in the slot, by the page clock (a sample before it — the frame it came in).
  let end = first;
  while (end + 1 < seen.length && seen[end + 1]!.jump) end++;
  const held = (seen[Math.min(end + 1, seen.length - 1)]!.t - seen[Math.max(first - 1, 0)]!.t) / 1000;
  console.log(`R-05: «Jump!» held ${held.toFixed(1)} s`);
  expect(held, `2 s from its first frame: ${line}`).toBeGreaterThanOrEqual(2);
  expect(seen.some((x) => x.toast), `a level-up toast came meanwhile: ${line}`).toBe(true);
});
