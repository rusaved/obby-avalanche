import type { Page } from '@playwright/test';
import { test, expect, waitTicks } from './fixtures.ts';
import { STAGES, threshold, ready } from './lv-stage-data.ts';
import spec from '../content/avalanche/pace/stages/worlds-spec.json' with { type: 'json' };
import stagesTuning from '../content/avalanche/pace/stages/tuning.json' with { type: 'json' };
import baseTuning from '../content/avalanche/tuning.json' with { type: 'json' };

// Z-01 (playtest G, Q-G-2 «A»): the rest of round 18 on mountain 1 of the stages pace — avalanches no more often than
// stages.avalanche.minGapSec, one command under the count, no «back» after «Phew», the first wave only where a shelter is
// in reach, a fall past the avalanche stage keeps its own start, a limit on every stage pad, the giant's toast in the
// queue, the camera out of grotto walls.
const W = STAGES[0]!;
const ST = (n: number) => W.stages.find((s) => s.n === n)!;
const GAP = (spec as unknown as { stages: { avalanche: { minGapSec: number[] } } }).stages.avalanche.minGapSec[0]!;
const TPS = 60;
/** The grotto in a rock of stage n (its first one up the slope): its centre. */
const grotto = (n: number): { x: number; z: number; size: number } => {
  const st = ST(n);
  const g = W.segments.filter((s) => s.type === 'island' && s.z >= st.z0 && s.z <= st.end).sort((a, b) => a.z - b.z)[0]!;
  return { x: g['x'] as number, z: g.z, size: g['size'] as number };
};
const lastTick = (page: Page, name: string, after = -1): Promise<number> =>
  page.evaluate(([n, a]) => window.__TEST__!.simEvents.filter((e) => e.name === n && e.tick > (a as number)).map((e) => e.tick).pop() ?? -1, [name, after] as const);
const firstTick = (page: Page, name: string, after: number): Promise<number> =>
  page.evaluate(([n, a]) => window.__TEST__!.simEvents.find((e) => e.name === n && e.tick > (a as number))?.tick ?? -1, [name, after] as const);
/** Records every toast text as it comes on screen, with its time (ms). */
const watchToasts = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const w = window as unknown as { __toasts: Array<{ text: string; on: boolean; t: number }> };
    w.__toasts = [];
    const el = document.querySelector('[data-role="toast"]')!;
    let last = '';
    const note = (): void => {
      const on = el.classList.contains('shown');
      const key = `${on}|${el.textContent}`;
      if (key === last) return;
      last = key;
      w.__toasts.push({ text: el.textContent ?? '', on, t: performance.now() });
    };
    new MutationObserver(note).observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
  });
const toasts = (page: Page): Promise<Array<{ text: string; on: boolean; t: number }>> =>
  page.evaluate(() => (window as unknown as { __toasts: Array<{ text: string; on: boolean; t: number }> }).__toasts);

test.describe('Z-01 · avalanche of mountain 1 (stages)', () => {
  test.use({ viewport: { width: 880, height: 405 } });

  test('Z-01: no wave sooner than minGapSec after the last one ended, and anew after a roll-back', async ({ page, openGame }) => {
    test.setTimeout(240_000);
    expect(GAP).toBeGreaterThanOrEqual(45);
    await openGame('pace=stages');
    await page.evaluate((s) => {
      window.__TEST__!.setFlag('giantFree', true);
      window.__TEST__!.setStat(s);
    }, threshold(ST(6).level + 2));
    await ready(page);
    const end = await lastTick(page, 'waveEnd');
    expect(end).toBeGreaterThan(0);
    // Into the grotto of the start of stage 5: its zone wants a wave seconds after entering (SD-06) — the gap holds it.
    const g = grotto(5);
    await page.evaluate((p) => window.__TEST__!.teleport(p.z, p.x), g);
    let warn = -1;
    for (let i = 0; i < GAP + 20 && warn < 0; i++) {
      await page.evaluate(() => window.__TEST__!.runSim(1));
      warn = await firstTick(page, 'waveWarn', end);
    }
    expect(warn, 'a wave of stage 5 came').toBeGreaterThan(0);
    expect((warn - end) / TPS, 'seconds from the end of the last wave').toBeGreaterThanOrEqual(GAP - 0.05);

    // Let that wave pass in the grotto, then 30 s later a fall: the pause counts from the roll-back.
    await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 5_000 }).catch(() => undefined);
    for (let i = 0; i < 20 && (await page.evaluate(() => window.__TEST__!.state().wave!.phase)) !== 'idle'; i++) await page.evaluate(() => window.__TEST__!.runSim(1));
    const end2 = await lastTick(page, 'waveEnd');
    await page.evaluate(() => window.__TEST__!.runSim(30));
    expect(await firstTick(page, 'waveWarn', end2)).toBe(-1);
    await page.evaluate(([z, x]) => window.__TEST__!.teleport(z, x, 24), [ST(5).start + 10, g.x] as const);
    let fall = -1;
    for (let i = 0; i < 20 && fall < 0; i++) {
      await page.evaluate(() => window.__TEST__!.runSim(0.25));
      fall = await firstTick(page, 'fall', end2);
    }
    expect(fall, 'fell into the pit').toBeGreaterThan(0);
    let warn2 = -1;
    for (let i = 0; i < GAP + 20 && warn2 < 0; i++) {
      await page.evaluate(() => window.__TEST__!.runSim(1));
      warn2 = await firstTick(page, 'waveWarn', fall);
    }
    expect(warn2, 'the next wave came').toBeGreaterThan(0);
    expect((warn2 - fall) / TPS, 'seconds from the roll-back').toBeGreaterThanOrEqual(GAP - 0.05);
  });

  test('Z-01: under «Avalanche in N» one command — «Duck behind a rock!», no other plaque', async ({ page, openGame }) => {
    await openGame('pace=stages');
    await page.evaluate((s) => {
      window.__TEST__!.setFlag('giantFree', true);
      window.__TEST__!.setStat(s);
    }, threshold(ST(5).level + 2));
    await ready(page);
    const st = ST(4);
    await page.evaluate((z) => {
      window.__TEST__!.teleport(z, 0);
      window.__TEST__!.triggerWave();
    }, st.start + 20);
    await waitTicks(page, 20);
    const s = await page.evaluate(() => window.__TEST__!.state());
    expect(s.wave!.phase).toBe('warn');
    expect(s.waveHud.banner).toMatch(/^Лавина через \d+$/);
    expect(s.waveHud.sub).toBe('Спрячься за камень!');
    await expect(page.locator('[data-role="wave-sub"]')).toBeVisible();
    await expect(page.locator('[data-role="wave-sub"]')).toHaveText('Спрячься за камень!');
    expect(s.hintsVisible, 'no hint plaque besides it').toBe(0);
    await expect(page.locator('[data-role="tutor"].shown')).toHaveCount(0);
  });

  test('Z-01: out of the back of the grotto right after «Phew» into the pit — back into the grotto, no «back to the stage start»', async ({ page, openGame }) => {
    await openGame('pace=stages');
    await page.evaluate((s) => {
      window.__TEST__!.setFlag('giantFree', true);
      window.__TEST__!.setStat(s);
    }, threshold(ST(6).level + 2));
    await ready(page);
    const g = grotto(5);
    await page.evaluate((p) => {
      window.__TEST__!.teleport(p.z, p.x);
      window.__TEST__!.triggerWave();
    }, g);
    await watchToasts(page);
    for (let i = 0; i < 60 && (await page.evaluate(() => window.__TEST__!.state().wave!.outcome)) !== 'survived'; i++) await page.evaluate(() => window.__TEST__!.runSim(0.25));
    expect(await page.evaluate(() => window.__TEST__!.state().wave!.outcome)).toBe('survived');
    const from = await lastTick(page, 'waveSurvived');
    // Straight up the slope: out of the open back of the grotto, into the pit of the plates.
    await page.evaluate(() => window.__TEST__!.stick(0, 1));
    let fall = -1;
    for (let i = 0; i < 40 && fall < 0; i++) {
      await page.evaluate(() => window.__TEST__!.runSim(0.1));
      fall = await firstTick(page, 'fall', from);
    }
    await page.evaluate(() => window.__TEST__!.stick(0, 0));
    expect(fall, 'fell into the pit behind the grotto').toBeGreaterThan(0);
    await page.evaluate(() => window.__TEST__!.runSim(4));
    const s = await page.evaluate(() => window.__TEST__!.state());
    expect(s.caught).toBeNull();
    expect(s.inShelter, `hero at ${s.hero!.x.toFixed(1)}, ${s.hero!.z.toFixed(1)}`).toBe(true);
    expect(s.stage).toBe(5);
    await page.waitForTimeout(500);
    const seen = (await toasts(page)).map((x) => x.text);
    expect(seen.some((x) => /Назад к началу/.test(x)), seen.join(' | ')).toBe(false);
  });

  test('Z-01: the first wave waits at the closed wall (safe finish), comes where a grotto is in reach', async ({ page, openGame }) => {
    await openGame('pace=stages');
    expect(await page.evaluate(() => window.__TEST__!.state().wave!.scriptedPending)).toBe(true);
    // The finish pad of stage 2 under its closed ridge: a safe place, no grotto in reach.
    const st = ST(2);
    await page.evaluate((z) => window.__TEST__!.teleport(z, 0), st.finish[0] + 8);
    await page.evaluate(() => window.__TEST__!.runSim(45));
    let s = await page.evaluate(() => window.__TEST__!.state());
    expect(s.simTick / TPS, 'past ftue.fallbackSec').toBeGreaterThan(40);
    expect(s.wave!.scriptedPending).toBe(true);
    expect(s.wave!.phase, `hero z ${s.hero!.z.toFixed(1)}`).toBe('idle');
    // Down on stage 1 among its grottos: the wave comes at once.
    await page.evaluate((z) => window.__TEST__!.teleport(z, 0), ST(1).end - 40);
    await page.evaluate(() => window.__TEST__!.runSim(0.5));
    s = await page.evaluate(() => window.__TEST__!.state());
    expect(s.wave!.phase).toBe('warn');
    expect(s.wave!.shelter).toBeGreaterThanOrEqual(0);
  });

  test('Z-01: a fall on the plates of stage 5 keeps its own start, never back under the wave of stage 4', async ({ page, openGame }) => {
    await openGame('pace=stages');
    await page.evaluate((s) => {
      window.__TEST__!.setFlag('giantFree', true);
      window.__TEST__!.setStat(s);
    }, threshold(ST(6).level + 2));
    await ready(page);
    expect(ST(4).type).toBe('avalanche');
    expect(ST(5).type).toBe('plates');
    await page.evaluate((z) => window.__TEST__!.teleport(z, 0, 24), ST(5).start + 10);
    let fall = -1;
    for (let i = 0; i < 20 && fall < 0; i++) {
      await page.evaluate(() => window.__TEST__!.runSim(0.25));
      fall = await lastTick(page, 'fall');
    }
    expect(fall).toBeGreaterThan(0);
    await page.evaluate(() => window.__TEST__!.runSim(4));
    const s = await page.evaluate(() => window.__TEST__!.state());
    expect(s.caught).toBeNull();
    expect(s.stage).toBe(5);
    expect(s.hero!.z).toBeGreaterThanOrEqual(ST(5).z0);
  });

  test('Z-01: the farthest stage pad pays padBehindTakes times too, then it never flies to the camp', async ({ page, openGame }) => {
    await openGame('pace=stages');
    const st = ST(2);
    await page.evaluate((s) => {
      window.__TEST__!.setPlaySec(400);
      window.__TEST__!.setFlag('firstWaveDone', true);
      window.__TEST__!.setFlag('giantFree', true);
      window.__TEST__!.holdWave(9000);
      window.__TEST__!.setStat(s);
    }, threshold(st.level + 3));
    const takes = (W as unknown as { padBehindTakes: number }).padBehindTakes;
    expect(takes).toBeGreaterThanOrEqual(1);
    for (let i = 0; i <= takes; i++) {
      await page.evaluate((p) => window.__TEST__!.teleport(p.z, p.x), st.pad);
      await waitTicks(page, 3);
      await page.evaluate(() => window.__TEST__!.runSim(0.9));
      const s = await page.evaluate(() => window.__TEST__!.state());
      expect(s.stageBest, 'the pad of the farthest stage').toBeLessThanOrEqual(st.n);
      if (i < takes) expect(s.hero!.z, `take ${i + 1}: in the camp`).toBeLessThan(ST(1).z0 + 1);
      else expect(Math.abs(s.hero!.z - st.pad.z), 'spent: stays on the pad').toBeLessThan(3);
    }
  });

  test('Z-01: «Run round the giant from the side!» holds its time, «Level up!» comes after it', async ({ page, openGame }) => {
    await openGame('pace=stages');
    await page.evaluate((s) => {
      window.__TEST__!.setFlag('firstWaveDone', true);
      window.__TEST__!.setFlag('giantFree', true);
      window.__TEST__!.holdWave(9000);
      window.__TEST__!.setStat(s);
    }, threshold(4));
    await waitTicks(page, 10);
    await watchToasts(page);
    const zone = await page.evaluate(() => window.__TEST__!.state().boss!.zones[0]!.zone);
    await page.evaluate((z) => window.__TEST__!.teleport(z, 0), zone[0] + 2);
    await page.waitForFunction(() => /великана/.test(document.querySelector('[data-role="toast"].shown')?.textContent ?? ''), undefined, { timeout: 10_000 });
    await page.evaluate((s) => window.__TEST__!.setStat(s), threshold(5));
    await page.waitForFunction(() => /уровень выше/i.test(document.querySelector('[data-role="toast"].shown')?.textContent ?? ''), undefined, { timeout: 15_000 });
    const log = await toasts(page);
    const bossOn = log.find((x) => x.on && /великана/.test(x.text))!;
    const bossOff = log.find((x) => x.t > bossOn.t && (!x.on || !/великана/.test(x.text)))!;
    const levelOn = log.find((x) => x.on && /уровень выше/i.test(x.text))!;
    expect((bossOff.t - bossOn.t) / 1000, log.map((x) => `${x.on ? '+' : '-'}${x.text}@${Math.round(x.t)}`).join(' ')).toBeGreaterThanOrEqual(2.5);
    expect(levelOn.t).toBeGreaterThanOrEqual(bossOff.t);
  });

  test('Z-11: into the giant\'s zone while «Avalanche in N» counts — the banner and its command stay, no giant toast over them', async ({ page, openGame }) => {
    await openGame('pace=stages');
    await page.evaluate((s) => {
      window.__TEST__!.setFlag('firstWaveDone', true);
      window.__TEST__!.setFlag('giantFree', true);
      window.__TEST__!.setTutor(9);
      window.__TEST__!.setStat(s);
    }, threshold(4));
    await waitTicks(page, 10);
    const zone = await page.evaluate(() => window.__TEST__!.state().boss!.zones[0]!.zone);
    await page.evaluate((z) => window.__TEST__!.teleport(z, 0), zone[0] - 30);
    await waitTicks(page, 5);
    await page.evaluate(() => window.__TEST__!.triggerWave());
    await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'warn', undefined, { timeout: 10_000 });
    await page.evaluate((z) => window.__TEST__!.teleport(z, 0), zone[0] + 2);
    await waitTicks(page, 30);
    const s = await page.evaluate(() => window.__TEST__!.state());
    expect(s.wave!.phase).toBe('warn');
    expect(s.waveHud.banner).not.toBeNull();
    expect(s.waveHud.toast).not.toMatch(/великана/);
  });

  test('Z-01: the camera turned round in a grotto of a stage never stands in its walls', async ({ page, openGame }) => {
    await openGame('pace=stages');
    await page.evaluate((s) => {
      window.__TEST__!.setFlag('firstWaveDone', true);
      window.__TEST__!.setFlag('giantFree', true);
      window.__TEST__!.setStat(s);
    }, threshold(ST(5).level + 2));
    const g = grotto(4);
    await page.evaluate((p) => {
      window.__TEST__!.holdWave(9000);
      window.__TEST__!.teleport(p.z + 2, p.x);
    }, g);
    await waitTicks(page, 30);
    expect(await page.evaluate(() => window.__TEST__!.state().inShelter)).toBe(true);
    const walls = await page.evaluate(() => window.__TEST__!.shelterWalls());
    expect(walls.length).toBeGreaterThan(0);
    const cam = { ...baseTuning.camera, ...(stagesTuning as unknown as { camera: Partial<typeof baseTuning.camera> }).camera };
    const r = cam.collisionRadius;
    const degPerPx = cam.mouseDegPerPx;
    const px = 360 / (48 * degPerPx);
    const bad: string[] = [];
    for (let i = 0; i < 48; i++) {
      await page.mouse.move(400, 200);
      await page.mouse.down();
      await page.mouse.move(400 + px, 200, { steps: 2 });
      await page.mouse.up();
      await waitTicks(page, 4);
      const [x, y, z] = await page.evaluate(() => window.__TEST__!.cameraPos());
      const h = (await page.evaluate(() => window.__TEST__!.state().hero))!;
      // In a wall, or a wall between the camera and the hero's chest (sampled along the way).
      for (const b of walls)
        for (let k = 0; k <= 20; k++) {
          const q = [x + ((h.x - x) * k) / 20, y + ((h.y + 1.5 - y) * k) / 20, z + ((h.z - z) * k) / 20] as const;
          const d = Math.hypot(...[0, 1, 2].map((a) => q[a]! - Math.min(b.max[a]!, Math.max(b.min[a]!, q[a]!))));
          if (d < (k === 0 ? r * 0.5 : 1e-3)) {
            bad.push(`${i}: cam ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)} k${k}`);
            break;
          }
        }
    }
    expect(bad).toEqual([]);
  });
});
