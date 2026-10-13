import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, shot1080, testState } from './fixtures.ts';
import { forkLaneX, passX } from './base-route.ts';
import type { TestState } from '../src/test-api/index.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };
import balanceJson from '../content/avalanche/balance.json' with { type: 'json' };

// PS-10, rewritten for FM-05 (docs/01-gdd.md 19.6, decision FM): the first minutes on the slope on a fresh save, on a PC
// (the file name keeps it off the phone project of playwright.config.ts). The physical bot (controller and collisions in
// the browser) climbs mountain 1 as a player would: up the middle, into the lit grotto at the siren, the egg after «Phew,
// made it!», a lane of the fork, a ridge grotto belt while the stat is short of a ridge, a grotto at every siren, the belt
// before the giant up to his advice, past him and into the portal. Times are play seconds. The rhythm of 19.6: on the belt
// of ridge 2 at most 10 s of game time, and a reward (a ridge or the giant passed, «Phew, made it!» in a shelter, an egg,
// shoes) at least every 25 s up to 180 s (fm-rhythm of docs/05 lives here: one run of the bot for both).
type Seg = { type: string; z: number; kind?: string; requires?: number; length?: number; passes?: number[]; between?: number; track?: number };
type OpenWorld = { segments: Seg[]; bosses: Array<{ zone: [number, number]; requires: number }> };
type Shelter = { kind: string; z: number; mouth: [number, number]; inside: [number, number]; belt: [number, number] | null };
type Played = Array<{ name: string; playSec: number; params?: Record<string, unknown> }>;
const world = (openWorlds as unknown as { worlds: OpenWorld[] }).worlds[0]!;
const ridges = world.segments.filter((s) => s.type === 'gate' && s.kind === 'ridge');
const fork = world.segments.find((s) => s.type === 'fork')!;
const forkEnd = fork.z + fork.length!;
const boss = world.bosses[0]!;
const portal = world.segments.find((s) => s.type === 'portal')!.z;
const EVIDENCE = 'docs/evidence/open';
/** Tolerance of the 19.6 times for the bot (the criterion of PS-10). */
const SLACK = 5;
/** The rhythm of 19.6 for the physical bot: belt of ridge 2, the longest gap between rewards up to 180 s (FM-05). */
const RIDGE2_BELT_SEC = 10;
const REWARD_GAP_SEC = 25;
/** SP-03 (docs/01-gdd.md 20.3): the run of «Размах» keeps the seconds of the first minute of «База» (FM) — ridge «50», «Phew,
 * made it!» of the scripted wave, the giant — within this many seconds of docs/evidence/fm/rhythm-m1.txt. */
const FM_RHYTHM = 'docs/evidence/fm/rhythm-m1.txt';
const SAME_SEC = 2;
/** Plaques allowed in the first 60 s: the shoes and the controls. */
const EARLY_HINTS = new Set(['hint.move', 'hint.shoes', 'hint.jumpPc', 'hint.jumpTouch']);

/** A leg up to a ridge (through its pass nearest the middle, SP-04; on the axis since Q-064) or the giant. */
type Leg = { z: number; x: number; req: number; grotto: Shelter | null; past: number };

test('first minutes on the open slope: ridge 1, the grotto at the siren, the egg, the ridges, the giant, the portal — 19.6 times and rhythm', async ({ page, openGame }) => {
  test.setTimeout(420_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high');
  const shelters = (await page.evaluate(() => window.__TEST__!.shelters())) as Shelter[];
  // The grotto with the belt right below `before` (SP-04: on mountain 1 a rock by the run, nearRun — its kind is island).
  const beltGrotto = (before: number): Shelter | null => shelters.find((n) => n.belt !== null && n.z < before && n.z > before - 30) ?? null;
  // Ridges 2–3 by their grotto belts if the stat is short, then the giant by the belt before his zone.
  const legs: Leg[] = [
    ...ridges.slice(1).map((r) => ({ z: r.z, x: passX(r), req: r.requires!, grotto: beltGrotto(r.z), past: r.z + 10 })),
    { z: boss.zone[0], x: 0, req: boss.requires, grotto: beltGrotto(boss.zone[0]), past: portal + 2 },
  ];

  /** The path to the points from the hero: round the fork's cliff by the lane on the hero's side. */
  const route = (s: TestState, to: Array<[number, number]>): Array<[number, number]> => {
    const h = s.hero!;
    const z = to[0]![1];
    const lane = (h.x < 0 ? -1 : 1) * forkLaneX(fork);
    // Out of the shelter he stands in by its mouth first (SP-04: a rock by the lane has walls on three sides; a canopy
    // with the belt is open to the sides).
    const here = s.shelter >= 0 ? shelters[s.shelter] : undefined;
    const out: Array<[number, number]> = here && here.kind === 'island' && here.belt === null ? [here.mouth] : [];
    // Its mouth once (a leg out of its belt starts with it too).
    const rest = out.length && to[0] && to[0][0] === out[0]![0] && to[0][1] === out[0]![1] ? to.slice(1) : to;
    // Out of a rock: sideways below it to the next point's line first, then up (never through its side walls).
    if (h.z > forkEnd || z < fork.z) return [...out, ...(out.length && rest[0] ? [[rest[0][0], out[0]![1]] as [number, number]] : []), ...rest];
    // Past the fork back to the middle, where the gifts of the path lead up (SP-04: the field is wide, «up the middle»).
    const middle: Array<[number, number]> = z > forkEnd + 14 ? [[0, forkEnd + 10]] : [];
    return [...out, [lane, Math.max(out[0]?.[1] ?? h.z, fork.z) + 2], [lane, Math.min(z, forkEnd + 4)], ...middle, ...rest];
  };
  const go = (path: Array<[number, number]>): Promise<void> => page.evaluate((p) => window.__TEST__!.botPath(p), path);
  const played = (): Promise<Played> => page.evaluate(() => window.__TEST__!.analyticsPlay());
  const shot = (name: string): Promise<void> => shot1080(page, `${EVIDENCE}/ftue_${name}_1920x1080_ru.png`);

  let s: TestState = await testState(page);
  expect(s.hint).toBe('hint.move');
  // Rewards by play second: shoes from the shoe level, the rest from the simulation journal (sheltered waves only).
  const rewards: Array<[number, string]> = [];
  let shoeLevel = s.shoeLevel;
  // The journal keeps the last 2000 events (steps among them): rewards are told apart by name, mountain and tick.
  const seen = new Set<string>();
  let beltFrom: number | null = null;
  let beltSec = 0;
  const note = async (st: TestState): Promise<void> => {
    if (st.shoeLevel > shoeLevel) rewards.push([st.playSec, `shoes ${st.shoeLevel}`]);
    shoeLevel = st.shoeLevel;
    const evs = await page.evaluate(() =>
      window.__TEST__!.simEvents.filter((e) => e.name === 'gatePass' || e.name === 'eggHatch' || e.name === 'waveSurvived').map((e) => `${e.name}@${String(e['world'])}:${e.tick}`),
    );
    for (const key of evs) {
      if (seen.has(key)) continue;
      seen.add(key);
      rewards.push([st.playSec, key.split('@')[0]!]);
    }
  };
  // Up to the siren of the scripted wave (17.8): triggerDist below the first grotto of section 2, from the data.
  // SP-04: on mountain 1 that row is rocks by the lanes (kind island).
  const firstOf2 = shelters.filter((n) => (n.kind === 'grotto' || n.kind === 'island') && n.z > ridges[0]!.z).sort((a, b) => a.z - b.z)[0]!;
  const sirenZ = firstOf2.z - balanceJson.ftue.triggerDist + 2;
  const x1 = passX(ridges[0]!);
  await go([[x1, ridges[0]!.z - 4], [x1, ridges[0]!.z + 12], [-forkLaneX(fork), Math.max(ridges[0]!.z + 24, sirenZ)]]);
  // ×2, not ×3 (SP-04): the bot decides by polling, and beside another worker a late look at ×3 cost seconds of play on a
  // belt — the times compared with FM are play seconds.
  await page.evaluate(() => window.__TEST__!.setTimeScale(2));

  // Set in resume() too: typed wide, so the loop's checks are not narrowed away.
  let stage = 'up' as 'up' | 'hide' | 'egg' | 'hatch' | 'leg' | 'belt';
  let leg = 0;
  let hiding = false;
  const early = new Set<string>();
  const shots = new Set<string>();
  /** The way of the current leg from where the bot stands up to past its ridge (or the giant and the portal). */
  const legPath = (st: TestState, l: Leg): Array<[number, number]> => {
    const inIt = l.grotto !== null && st.shelter === shelters.indexOf(l.grotto);
    // A canopy with the belt (SP-04) is open to the sides: straight on to the passage.
    const out: Array<[number, number]> = inIt && l.grotto!.kind !== 'island' ? [l.grotto!.mouth] : [];
    const finish: Array<[number, number]> = leg === legs.length - 1 ? [[0, boss.zone[1] + 4], [0, portal + 2]] : [[l.x, l.z + 10]];
    return route(st, [...out, [l.x, l.z - 4], ...finish]);
  };
  /** Off the belt in the frame the stat reaches `req` (SP-10: a decision by polling from here came late beside another
   * worker — verify SP, the giant at 75.1 s of play against 72.8 ± 2). */
  const leaveAt = (req: number, path: Array<[number, number]>): Promise<void> =>
    page.evaluate(
      ([r, p]) => {
        const f = (): void => {
          if (window.__TEST__!.state().stat >= r) window.__TEST__!.botPath(p);
          else requestAnimationFrame(f);
        };
        f();
      },
      [req, path] as const,
    );
  let armed = -1;
  const resume = async (st: TestState): Promise<void> => {
    const l = legs[leg];
    if (!l) return;
    const inIt = l.grotto !== null && st.shelter === shelters.indexOf(l.grotto);
    if (st.stat >= l.req || !l.grotto) {
      stage = 'leg';
      await go(legPath(st, l));
    } else {
      stage = 'belt';
      const belt = l.grotto.belt ?? l.grotto.inside;
      await go(inIt ? [belt] : route(st, [l.grotto.mouth, belt]));
    }
  };

  for (let i = 0; i < 6000; i++) {
    s = await testState(page);
    await note(s);
    // The belt of ridge 2 (leg 0): from the first moment on it until the bot leaves for the ridge.
    if (leg === 0 && stage === 'belt' && s.onBelt && beltFrom === null) beltFrom = s.playSec;
    if (leg === 0 && stage !== 'belt' && beltFrom !== null) {
      beltSec += s.playSec - beltFrom;
      beltFrom = null;
    }
    if (stage === 'belt' && s.onBelt && armed !== leg) {
      armed = leg;
      await leaveAt(legs[leg]!.req, legPath(s, legs[leg]!));
    }
    if (s.playSec < 60 && s.hint) early.add(s.hint);
    if (s.shoesButton.can && !s.window) await page.locator('[data-hud="shoes"]').click();
    const names = (await played()).map((e) => e.name);
    for (const [name, due] of [['10s', s.playSec >= 10], ['ridge1', names.includes('ridge_1')], ['40s', s.playSec >= 40]] as const) {
      if (shots.has(name) || !due) continue;
      shots.add(name);
      await shot(name);
      // The rest of the run at the low level: the times are play seconds, the screenshots are taken.
      if (shots.size === 3) await page.evaluate(() => window.__TEST__!.setQuality('low'));
    }
    if (names.includes('gameTutorialComplete') || s.playSec > 240) break;
    if (s.caught) continue;
    // A siren: into the grotto the game lights (the scripted one at the entry of section 2 included); past the giant's
    // line none is lit (the summit is safe) — on to the portal.
    if (s.wave?.phase === 'warn' && !hiding && shelters[s.wave.shelter]) {
      hiding = true;
      if (!s.inShelter) {
        const n = shelters[s.wave.shelter]!;
        await go(route(s, [n.mouth, n.inside]));
      } else await go([]);
      if (stage === 'up') stage = 'hide';
      continue;
    }
    if (hiding && s.wave && (s.wave.phase === 'idle' || s.wave.phase === 'gone')) {
      hiding = false;
      if (stage === 'hide') {
        stage = 'egg';
        // The egg comes with «Phew, made it!» in the grotto the bot hid in.
        await expect.poll(async () => (await testState(page)).egg?.shown).toBe(true);
        const egg = (await testState(page)).egg!;
        await go([[egg.x, egg.z]]);
        stage = 'hatch';
      } else await resume(s);
      continue;
    }
    if (hiding) continue;
    if (stage === 'hatch' && names.includes('egg_1')) await resume(s);
    else if (stage === 'belt' && s.stat >= legs[leg]!.req) await resume(s);
    else if (stage === 'leg' && s.hero!.z > legs[leg]!.past - 4 && leg < legs.length - 1) {
      leg++;
      await resume(s);
    } else if (stage === 'leg' && (await page.evaluate(() => window.__TEST__!.botLeft())) === 0) await resume(s);
  }
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  await note(await testState(page));
  const ev = await played();
  const first = (name: string): number => ev.find((e) => e.name === name)?.playSec ?? Infinity;
  const count = (name: string): number => ev.filter((e) => e.name === name).length;
  const all = await page.evaluate(() => window.__TEST__!.analytics().map((e) => e.name));
  writeFileSync(`${EVIDENCE}/ftue-events.txt`, `${ev.map((e) => `${e.playSec.toFixed(1).padStart(6)} s  ${e.name}${e.params ? ` ${JSON.stringify(e.params)}` : ''}`).join('\n')}\n`);
  // The rhythm of 19.6 (FM-05): the belt of ridge 2 and the gaps between rewards up to 180 s (or the end of the run).
  const end = Math.min(180, s.playSec);
  const marks = [0, ...rewards.map(([t]) => t).filter((t) => t <= end), end];
  const gaps = marks.slice(1).map((t, k) => t - marks[k]!);
  // The seconds of «База» (FM) to keep: read before this run's file is written (SP writes its own).
  const fmTimes = (name: string): number[] =>
    (existsSync(FM_RHYTHM) ? readFileSync(FM_RHYTHM, 'utf8') : '')
      .split('\n')
      .map((l) => /^\s*([\d.]+) s\s+(\S+)/.exec(l))
      .flatMap((m) => (m && m[2] === name ? [Number(m[1])] : []));
  const ours = (name: string): number[] => rewards.filter(([, n]) => n === name).map(([t]) => t);
  mkdirSync('docs/evidence/sp', { recursive: true });
  writeFileSync(
    'docs/evidence/sp/rhythm-m1.txt',
    `Физический бот горы 1 (FM-05, 01 19.6), секунды игры\nСтоянка на дорожке у рубежа 2: ${beltSec.toFixed(1)} с (≤ ${RIDGE2_BELT_SEC})\nСамый долгий промежуток между наградами до ${end.toFixed(0)} с: ${Math.max(...gaps).toFixed(1)} с (≤ ${REWARD_GAP_SEC})\n${rewards.map(([t, n]) => `${t.toFixed(1).padStart(6)} s  ${n}`).join('\n')}\n`,
  );
  for (const [what, name, k] of [['ridge «50»', 'gatePass', 0], ['«Phew, made it!» of the scripted wave', 'waveSurvived', 0], ['the giant', 'gatePass', 3]] as const) {
    const fm = fmTimes(name)[k];
    if (fm === undefined) continue;
    expect(Math.abs((ours(name)[k] ?? Infinity) - fm), `${what}: ${ours(name)[k]} s, FM ${fm} s`).toBeLessThanOrEqual(SAME_SEC);
  }
  expect(beltSec, 'belt of ridge 2, s').toBeLessThanOrEqual(RIDGE2_BELT_SEC);
  expect(Math.max(...gaps), `gaps ${gaps.map((g) => g.toFixed(0)).join(' ')}`).toBeLessThanOrEqual(REWARD_GAP_SEC);
  // 19.6 with ±5 s for the bot.
  expect(all).toContain('game_ready');
  expect(first('ridge_1')).toBeLessThanOrEqual(20 + SLACK);
  expect(first('first_wave_survived')).toBeLessThanOrEqual(50 + SLACK);
  expect(ev.filter((e) => e.name === 'first_wave_survived').map((e) => e.params)).toEqual([{ inShelter: true }]);
  expect(first('egg_1')).toBeGreaterThan(first('first_wave_survived'));
  expect(first('session_60s')).toBeLessThan(Infinity);
  expect(first('boss_enter')).toBeLessThanOrEqual(120);
  expect(first('gameTutorialComplete')).toBeLessThan(Infinity);
  // Order and once a player (docs/06 2, 8.2); the open slope counts ridges, not walls.
  const order = ['ridge_1', 'first_wave_survived', 'egg_1', 'ridge_2', 'ridge_3', 'boss_enter', 'boss_passed', 'gameTutorialComplete'];
  for (let k = 1; k < order.length; k++) expect(first(order[k]!), `${order[k - 1]} before ${order[k]}`).toBeGreaterThan(first(order[k - 1]!));
  for (const name of [...order, 'session_60s', 'shoes_1']) expect(count(name), name).toBe(1);
  expect(all.filter((n) => n.startsWith('gate_'))).toEqual([]);
  // Plaques of the first minute: the shoes and the controls only — never «To the cave!» (17.8: the blink instead).
  expect([...early].filter((h) => !EARLY_HINTS.has(h))).toEqual([]);
  expect(shots.size).toBe(3);
});

test('the egg of the scripted wave stands in the grotto the hero hid in, either lane of the fork', async ({ page, openGame }) => {
  test.setTimeout(150_000);
  await openGame('pace=open');
  await hideInGrotto(page, 'right');
  const s = await testState(page);
  const shelters = await page.evaluate(() => window.__TEST__!.shelters());
  const n = shelters[s.shelter]!;
  expect(n.side).toBe('right');
  expect(s.egg!.shown).toBe(true);
  expect(Math.abs(s.egg!.z - n.z)).toBeLessThan(5);
  expect(Math.sign(s.egg!.x)).toBe(1);
});

/** Up to the fork of section 2 at the scripted siren, then into the grotto of the `side` lane; waits for the egg. */
async function hideInGrotto(page: Page, side: 'left' | 'right'): Promise<void> {
  const shelters = await page.evaluate(() => window.__TEST__!.shelters());
  const n = shelters.find((x) => x.side === side && x.z > fork.z && x.z < forkEnd)!;
  await page.evaluate(([z, x]) => {
    window.__TEST__!.setStat(1000);
    window.__TEST__!.teleport(z, x);
  }, [ridges[0]!.z + 6, Math.sign(n.mouth[0]) * forkLaneX(fork)] as const);
  await page.evaluate((p) => window.__TEST__!.botPath(p), [[Math.sign(n.mouth[0]) * forkLaneX(fork), n.z - 6], n.mouth, n.inside] as Array<[number, number]>);
  await page.evaluate(() => window.__TEST__!.setTimeScale(3));
  await page.waitForFunction(() => window.__TEST__!.state().egg?.shown === true, undefined, { timeout: 90_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
}

test('ridge 2 of mountain 1 with its number of 19.6: screenshot', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  mkdirSync('docs/evidence/fm', { recursive: true });
  await openGame('pace=open&quality=high');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  // Past ridge 1, short of ridge 2: its sign shows «N/420».
  await page.evaluate(([z, st]) => {
    window.__TEST__!.holdWave(120);
    window.__TEST__!.setStat(st!);
    window.__TEST__!.teleport(z!, 0);
  }, [ridges[1]!.z - 22, Math.round(ridges[1]!.requires! * 0.6)] as const);
  await page.waitForFunction(() => window.__TEST__!.state().ticks > 0);
  await shot1080(page, 'docs/evidence/fm/ridge2_m1_1920x1080_ru.png', 40);
});

