import { mkdirSync } from 'node:fs';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };

// PS-06: the avalanche on the open slope (docs/01-gdd.md 17.5, 17.8). The physical bot runs up from the camp; at the
// entry of section 2 the scripted siren, the bot runs into the lit grotto — «Phew, made it!» within 46 s of the start.
// A normal wave with the hero in the giant's zone (above spawnMaxZ) never catches him.
type Seg = { type: string; z: number; side?: string; kind?: string; length?: number; edge?: number };
type OpenWorld = { segments: Seg[]; bosses: Array<{ zone: [number, number] }>; threat: { spawnMaxZ: number } };
const world = (openWorlds as unknown as { worlds: OpenWorld[] }).worlds[0]!;
const niches = world.segments.filter((s) => s.type === 'niche');
const ridge1 = world.segments.find((s) => s.type === 'gate' && s.kind === 'ridge')!.z;
const EVIDENCE = 'docs/evidence/open';

test('scripted wave at the entry of section 2: the bot in its grotto, «Phew, made it!» within 46 s', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high');
  await waitTicks(page, 10);
  const t0 = (await testState(page)).timeSec;
  await page.evaluate((k) => window.__TEST__!.setTimeScale(k), 3);
  // Up the middle, then the left lane of the fork of section 2 (the cliff stands on the axis).
  await page.evaluate((z) => window.__TEST__!.botPath([[0, z + 14], [-16, z + 60]]), ridge1);
  await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'warn', undefined, { timeout: 90_000 });
  let s = await testState(page);
  expect(s.wave!.scripted).toBe(true);
  const cave = niches[s.wave!.shelter]!;
  expect(cave.z).toBeGreaterThan(ridge1);
  const sign = cave.side === 'right' ? 1 : -1;
  // SP-04: the grotto stands at the edge of its section.
  const e = cave.edge ?? 28;
  await page.evaluate(
    ([x1, x2, z]) => window.__TEST__!.botPath([[x1, z], [x2, z]]),
    [sign * (e - 4), sign * (e + 2), cave.z] as const,
  );
  await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'run', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  let shot = false;
  for (let i = 0; i < 400; i++) {
    s = await testState(page);
    if (!shot && s.wave?.phase === 'run' && s.inShelter) {
      await shot1080(page, `${EVIDENCE}/wave_grotto_1920x1080_ru.png`, 20);
      shot = true;
      // The rest of the wave faster: the limit below is game time.
      await page.evaluate(() => window.__TEST__!.setTimeScale(3));
    }
    if (s.waveHud.toast.startsWith('Уф, успел!')) break;
    await waitTicks(page, 3);
  }
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  expect(s.waveHud.toast).toMatch(/^Уф, успел!/);
  expect(s.inShelter).toBe(true);
  expect(s.timeSec - t0, 'grotto of section 2 by').toBeLessThanOrEqual(46);
  const funnel = await page.evaluate(() => window.__TEST__!.analytics().find((e) => e.name === 'first_wave_survived'));
  expect(funnel?.params).toMatchObject({ inShelter: true });
});

test('a normal wave with the hero in the giant’s zone (above spawnMaxZ) never catches him', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await openGame('pace=open');
  // The scripted wave first (it never catches), then a normal one with the hero up in the zone.
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  // Past the giant first (PS-07): a hero standing in his zone is his, and a catch rolls him below the line.
  const zone = world.bosses[0]!.zone;
  await page.evaluate(([z, st]) => {
    window.__TEST__!.setStat(st);
    window.__TEST__!.teleport(z);
  }, [zone[0] - 4, 1e6] as const);
  await page.evaluate((z) => window.__TEST__!.botPath([[0, z]]), zone[1] + 6);
  await page.waitForFunction(() => window.__TEST__!.simEvents.some((e) => e.name === 'bossPassed'), undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await page.evaluate((z) => window.__TEST__!.teleport(z), zone[0] + 40);
  await waitTicks(page, 10);
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'warn', undefined, { timeout: 30_000 });
  const s0 = await testState(page);
  expect(s0.wave!.spawnZ).toBeLessThanOrEqual(world.threat.spawnMaxZ);
  await page.waitForFunction(() => window.__TEST__!.state().wave?.phase === 'gone', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  const s = await testState(page);
  expect(s.wave!.outcome).toBe('safe');
  expect(s.caught).toBeNull();
  const caught = await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'waveCaught').length);
  expect(caught).toBe(0);
});
