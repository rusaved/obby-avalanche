import type { Page } from '@playwright/test';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import tuning from '../content/avalanche/tuning.json' with { type: 'json' };

// Q-067 (playtest of «Размах», cycle 3: in every shelter the screen went white for 1.5–2 s as the snow went by — the cave
// frame stood over the roof inside the snow body — and «Phew, made it!» and the hatch of the free egg came on that white):
// with avalanche.shotUntilClear the cave frame is inside the shelter behind the hero until the whole snow body has passed
// him, and with the hero in a shelter there is no white veil whatever the camera. In a side grotto, a ridge grotto, a
// grotto with a chest and a rock grotto of mountain 1 — in from the siren, run in late, run in late and turned by hand on
// the run: white frames with the hero in the shelter ≤ WHITE of the frames of the run, and fewer than the same waves
// without the flag (the frame over the roof); «Phew, made it!» first shows with the snow body past the hero. The scripted first wave: its free egg
// shows only once the snow has passed. Screenshots of the frame.
const WHITE = 0.05;
const EVIDENCE = 'docs/evidence/sp';
const BODY = tuning.avalanche.bodyLength;
/** Running in late: from the mouth when the front is this far above the hero (units). */
const LATE = 30;
type Shelter = { kind: string; z: number; mouth: [number, number]; inside: [number, number]; belt: [number, number] | null };

/** The flag as the open pace has it (its avalanche frame avalanche.waveShot inside the shelter), or off (the frame over
 * the roof, the snow body not waited for — as before). */
async function setFlag(page: Page, on: boolean): Promise<void> {
  await page.evaluate((flag) => window.__TEST__!.setTuning('avalanche.shotUntilClear', flag), on ? 1 : 0);
}

/** A wave over the hero standing in shelter `n` (on its belt when it has one): white frames of its run, and whether
 * «Phew, made it!» first showed with the snow body past him. */
async function waveIn(page: Page, n: Shelter, late: boolean, hand: boolean, shot?: string): Promise<{ run: number; white: number; phewAfter: boolean | null }> {
  const at = n.belt ?? n.inside;
  // In the shelter from the siren on, or — as children do — in front of its mouth, running in as the front comes close.
  const start = late ? n.mouth : at;
  // Out of the shelter first: its cave frame is set anew (with the tuning of this run) when he comes in.
  await page.evaluate(([z, x]) => {
    window.__TEST__!.holdWave(900);
    window.__TEST__!.teleport(z, x);
  }, [n.mouth[1], n.mouth[0] + (n.mouth[0] > n.inside[0] ? 8 : -8)] as const);
  await waitTicks(page, 20);
  await page.evaluate(([z, x]) => window.__TEST__!.teleport(z, x), [start[1], start[0]] as const);
  await waitTicks(page, 40);
  // No toast of the last wave left (the waves of this test come one right after another: a toast still up when the next
  // siren sounds goes back to the queue and comes when its banner goes — in the game the waves are 50–90 s apart).
  await page.waitForFunction(() => !document.querySelector('.toasting'), undefined, { timeout: 20_000 });
  if (!late) expect((await testState(page)).inShelter, `${n.kind} z ${n.z}`).toBe(true);
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'run', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.resetCameraStats());
  // The moment «Phew, made it!» comes on screen, read in the page then: is the snow body past the hero.
  await page.evaluate((body) => {
    const w = window as unknown as { __phew?: { past: boolean; front: number; hero: number } | null };
    w.__phew = null;
    const el = document.querySelector('[data-role="toast"]')!;
    const mo = new MutationObserver(() => {
      if (w.__phew || !el.classList.contains('shown') || !(el.textContent ?? '').includes('Уф')) return;
      const st = window.__TEST__!.state();
      w.__phew = { past: st.wave!.phase !== 'run' || st.wave!.frontZ + body < st.hero!.z, front: st.wave!.frontZ, hero: st.hero!.z };
      mo.disconnect();
    });
    mo.observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
  }, BODY);
  if (late) {
    await page.waitForFunction((d) => window.__TEST__!.state().wave!.frontZ - window.__TEST__!.state().hero!.z < d, LATE, { timeout: 60_000 });
    await page.evaluate((p) => window.__TEST__!.botPath(p), [at] as Array<[number, number]>);
  }
  let phewAfter: boolean | null = null;
  let shotDone = !shot;
  for (let i = 0; i < 600; i++) {
    // Turned by hand on the run (the camera is the player's then, not the cave frame).
    if (hand && i % 4 === 0) {
      await page.mouse.move(400, 300);
      await page.mouse.down();
      await page.mouse.move(460, 300, { steps: 2 });
      await page.mouse.up();
    }
    await waitTicks(page, 3);
    const s = await testState(page);
    if (phewAfter === null) {
      const ph = await page.evaluate(() => (window as unknown as { __phew?: { past: boolean; front: number; hero: number } | null }).__phew ?? null);
      if (ph) {
        phewAfter = ph.past;
        if (!ph.past) console.log(`«Phew» early: front ${ph.front.toFixed(1)} hero ${ph.hero.toFixed(1)}`);
      }
    }
    if (!shotDone && s.wave!.frontZ < s.hero!.z - 20) {
      await shot1080(page, shot!);
      shotDone = true;
    }
    if (s.wave!.phase !== 'run' && phewAfter !== null) break;
    if (s.wave!.phase === 'idle') break;
  }
  const st = await page.evaluate(() => window.__TEST__!.cameraStats());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  return { run: st.shelterRun, white: st.shelterWhite, phewAfter };
}

test('shelters of mountain 1: white frames on the run of a wave ≤ WHITE with shotUntilClear, more without; «Phew» after the snow; screenshots', async ({ page, openGame }) => {
  test.setTimeout(600_000);
  await openGame('pace=open');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  const list = (await page.evaluate(() => window.__TEST__!.shelters())) as Shelter[];
  const picks = ['grotto', 'ridgeGrotto', 'chestGrotto', 'island'].map((k) => list.find((s) => s.kind === k && (k !== 'island' || s.belt))!);
  const rows: string[] = [];
  let on = { run: 0, white: 0 };
  let off = { run: 0, white: 0 };
  for (const n of picks)
    for (const [late, hand] of [
      [false, false],
      [true, false],
      [true, true],
    ] as const) {
      await setFlag(page, false);
      const a = await waveIn(page, n, late, hand);
      await setFlag(page, true);
      const b = await waveIn(page, n, late, hand, !late && (n.kind === 'ridgeGrotto' || n.kind === 'island') ? `${EVIDENCE}/shelter_wave_${n.kind}_1920x1080_ru.png` : undefined);
      off = { run: off.run + a.run, white: off.white + a.white };
      on = { run: on.run + b.run, white: on.white + b.white };
      rows.push(`${n.kind} z ${n.z}${late ? ' (ran in late)' : ''}${hand ? ' (turned by hand)' : ''}: without the flag ${a.white} white of ${a.run}; with it ${b.white} of ${b.run}, «Phew» after the snow ${b.phewAfter}`);
      expect(b.phewAfter, rows.join('\n')).toBe(true);
    }
  console.log(`white frames in shelters on the run of a wave:\n${rows.join('\n')}\ntotal: without ${off.white}/${off.run}, with ${on.white}/${on.run}`);
  expect(on.run).toBeGreaterThan(50);
  expect(on.white / on.run, rows.join('\n')).toBeLessThanOrEqual(WHITE);
  expect(off.white / Math.max(1, off.run)).toBeGreaterThan(on.white / on.run);
});

test('the scripted first wave: the free egg shows only once its snow has passed the hero in the grotto', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  await openGame('pace=open');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  expect((await testState(page)).wave?.scriptedPending).toBe(true);
  const list = (await page.evaluate(() => window.__TEST__!.shelters())) as Shelter[];
  // The first rocks of the fork: the scripted wave lights the one nearer the hero.
  const rock = list.filter((s) => s.kind === 'island').sort((a, b) => a.z - b.z)[0]!;
  await page.evaluate(([z, x]) => window.__TEST__!.teleport(z, x), [rock.inside[1], rock.inside[0]] as const);
  await waitTicks(page, 30);
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'run', undefined, { timeout: 60_000 });
  let shownWhileSnow = 0;
  let shown = false;
  for (let i = 0; i < 600 && !shown; i++) {
    await waitTicks(page, 3);
    const s = await testState(page);
    const past = s.wave!.phase !== 'run' || s.wave!.frontZ + BODY < s.hero!.z;
    shown = s.egg?.shown === true;
    if (shown && !past) shownWhileSnow++;
  }
  expect(shown).toBe(true);
  expect(shownWhileSnow).toBe(0);
});
