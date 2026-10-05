import type { Page } from '@playwright/test';
import { test, expect, testState, waitTicks } from './fixtures.ts';
import tuning from '../content/avalanche/tuning.json' with { type: 'json' };
import { PACES, SHOT_PACE, paceBalance, paceWorlds } from './pace-data.ts';

// PR-05 (docs/01-gdd.md 16.5): the reward of every gate, both paces. Through an open gate: coins += coins.gatePass ×
// gift of the zone × wallScale exactly once, within 0.3 s coins fly out of the arch and confetti is up, a chime of
// three notes; gates within gateReward.streakSec of each other ring a semitone higher each (up to streakSteps), a
// longer pause starts again from the first note.
type Gate = { type: string; z: number; y: number; requires: number; reward: { coins: number } };
/** Off the axis: the trampoline and the gifts of the path stand on it (16.4), the walk takes nothing but the gate. */
const LANE_X = -7;

/** Walks through gate `g` from 1.5 units below it; returns the coins and the fun state right after the pass. */
async function passGate(page: Page, g: Gate, index: number): Promise<{ before: number; after: Awaited<ReturnType<typeof testState>>; ticks: number }> {
  await page.evaluate(([z, x]) => window.__TEST__!.teleport(z, x), [g.z - 1.5, LANE_X] as const);
  await waitTicks(page, 3);
  const before = (await testState(page)).coins;
  await page.keyboard.down('KeyW');
  const t0 = (await testState(page)).ticks;
  await page.waitForFunction((i) => window.__TEST__!.state().gatesPassed[i] === true, index, { timeout: 30_000 });
  await page.keyboard.up('KeyW');
  const after = await testState(page);
  return { before, after, ticks: after.ticks - t0 };
}

for (const pace of PACES) {
  test(`gate reward (${pace}): coins once, fountain and confetti within 0.3 s, «+N», a chime rising a semitone in a row and back after a pause`, async ({ page, openGame }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openGame('pace=' + pace);
    const balance = paceBalance(pace);
    const gates = paceWorlds<{ segments: Gate[] }>(pace)[0]!.segments.filter((s) => s.type === 'gate').sort((a, b) => a.z - b.z);
    const steps = tuning.gateReward.streakSteps;
    const count = steps + 2;
    // Sound starts on the first gesture; the gates of the run open by the stat.
    await page.keyboard.press('KeyD');
    await page.evaluate((n) => window.__TEST__!.setStat(n), gates[count - 1]!.requires);
    await waitTicks(page, 3);

    // Gate 1: exactly its coins, the fountain and the confetti at once, the first note.
    const first = await passGate(page, gates[0]!, 0);
    const want = gates[0]!.reward.coins * balance.rebirth.wallScale[0]!;
    expect(gates[0]!.reward.coins).toBe(balance.coins.gatePass * (await page.evaluate(() => window.__TEST__!.state().gifts[0]!.coins)));
    expect(first.after.coins - first.before).toBe(want);
    await page.waitForFunction(() => window.__TEST__!.state().funFx.fountains === 1, undefined, { timeout: 5_000 });
    const fx = (await testState(page)).funFx;
    const passTick = (await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'gatePass').map((e) => e.tick)))[0]!;
    const seenAt = (await testState(page)).ticks;
    expect(seenAt - passTick, 'ticks from the pass to the particles').toBeLessThanOrEqual(18);
    expect(fx.coinsFlying).toBeGreaterThanOrEqual(tuning.gateReward.fountain[0]!);
    expect(fx.coinsFlying).toBeLessThanOrEqual(tuning.gateReward.fountain[1]!);
    expect(fx.confetti).toBeGreaterThan(0);
    expect(fx.gateNote).toBe(0);
    expect(fx.chimes).toBe(1);
    if (pace === SHOT_PACE) {
      await waitTicks(page, 6);
      await page.screenshot({ path: 'docs/evidence/proto/gate_reward_1920x1080_ru.png' });
    }
    // The coins reach the plaque: «+N» by it.
    await page.waitForFunction((t) => window.__TEST__!.state().coinGain.text === t, `+${want}`, { timeout: 10_000 });
    const s1 = await testState(page);
    expect(s1.sfx.filter((n) => n === 'gate')).toHaveLength(3);

    // Back down and through again: nothing more.
    await page.evaluate(([z, x]) => window.__TEST__!.teleport(z, x), [gates[0]!.z - 3, LANE_X] as const);
    await page.keyboard.down('KeyW');
    await waitTicks(page, 30);
    await page.keyboard.up('KeyW');
    const again = await testState(page);
    expect(again.coins).toBe(first.after.coins);
    expect(again.funFx.fountains).toBe(1);
    expect(await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'gatePass').length)).toBe(1);

    // Gates 2 … in a row (each within a few seconds): a semitone higher each, held at the top step.
    const notes = [0];
    for (let i = 1; i < count - 1; i++) {
      const r = await passGate(page, gates[i]!, i);
      expect(r.after.coins - r.before, `gate ${i + 1} coins`).toBe(gates[i]!.reward.coins * balance.rebirth.wallScale[0]!);
      await page.waitForFunction((n) => window.__TEST__!.state().funFx.chimes === n, i + 1, { timeout: 5_000 });
      notes.push((await testState(page)).funFx.gateNote);
    }
    expect(notes).toEqual(Array.from({ length: count - 1 }, (_, i) => Math.min(i, steps - 1)));
    // A pause longer than streakSec: the next gate starts from the first note again.
    const t0 = (await testState(page)).timeSec;
    await page.evaluate(() => window.__TEST__!.setTimeScale(4));
    await page.waitForFunction((t) => window.__TEST__!.state().timeSec >= t, t0 + tuning.gateReward.streakSec + 0.5, { timeout: 30_000 });
    await page.evaluate(() => window.__TEST__!.setTimeScale(1));
    await passGate(page, gates[count - 1]!, count - 1);
    await page.waitForFunction((n) => window.__TEST__!.state().funFx.chimes === n, count, { timeout: 5_000 });
    expect((await testState(page)).funFx.gateNote).toBe(0);
    expect((await testState(page)).funFx.fountains).toBe(count);
  });
}
