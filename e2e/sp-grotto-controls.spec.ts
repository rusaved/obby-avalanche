import type { Page } from '@playwright/test';
import { test, expect, testState, waitTicks } from './fixtures.ts';

// Producer 14.10: «after running into a side grotto the controls are as if inverted». In the grotto frame the camera looks
// into the grotto from its mouth, but a new move kept the movement frame from before the cut: «back» ran along the grotto
// wall, not out of the mouth towards the camera, and the hero stayed in. Side grottos of mountains 1–2, by the keys as a
// player: up the slope to the grotto, sideways into it, a stand; «back» (S) takes him out of the mouth within OUT_TICKS;
// let go, a stand; «forward» (W) leads up the slope (within UP_DEG of +z).
const OUT_TICKS = 120;
const UP_DEG = 30;
type Shelter = { kind: string; side: string; z: number; mouth: [number, number]; inside: [number, number] };

async function holdUntil(page: Page, key: string, maxTicks: number, done: () => Promise<boolean>): Promise<boolean> {
  await page.keyboard.down(key);
  let ok = false;
  for (let t = 0; t < maxTicks && !ok; t += 5) {
    await waitTicks(page, 5);
    ok = await done();
  }
  await page.keyboard.up(key);
  return ok;
}

test('side grottos of mountains 1–2: in sideways, out by «back», then «forward» leads up the slope', async ({ page, openGame }) => {
  test.setTimeout(300_000);
  await openGame('pace=open');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  const rows: string[] = [];
  for (const m of [1, 2]) {
    if (m > 1) {
      await page.evaluate((k) => window.__TEST__!.gotoWorld(k), m);
      await waitTicks(page, 20);
    }
    await page.evaluate(() => window.__TEST__!.holdWave(900));
    const list = ((await page.evaluate(() => window.__TEST__!.shelters())) as Shelter[]).filter((s) => s.kind === 'grotto');
    for (const n of [list.find((s) => s.side === 'left')!, list.find((s) => s.side === 'right')!]) {
      const sign = n.side === 'left' ? -1 : 1;
      const at = `mountain ${m} ${n.side} z ${n.z.toFixed(0)}`;
      // In front of the mouth, looking up the slope; sideways into the grotto (screen right is −X).
      await page.evaluate(([z, x]) => window.__TEST__!.teleport(z, x), [n.z, n.mouth[0] - sign * 4] as const);
      await page.evaluate(() => window.__TEST__!.setCamera({ yaw: 0 }));
      await waitTicks(page, 5);
      await page.evaluate(() => window.__TEST__!.setCamera('auto'));
      await waitTicks(page, 20);
      const inside = await holdUntil(page, sign < 0 ? 'KeyD' : 'KeyA', 120, async () => {
        const st = await testState(page);
        // At its middle or deeper (to the back wall).
        return st.inShelter && sign * (st.hero!.x - n.inside[0]) > -1;
      });
      expect(inside, `${at}: sideways into the grotto`).toBe(true);
      await waitTicks(page, 40);
      const out = await holdUntil(page, 'KeyS', OUT_TICKS, async () => !(await testState(page)).inShelter);
      const s1 = await testState(page);
      expect(out, `${at}: «back» out of the mouth — the hero at ${s1.hero!.x.toFixed(1)},${s1.hero!.z.toFixed(1)}`).toBe(true);
      await waitTicks(page, 90);
      await page.keyboard.down('KeyW');
      await waitTicks(page, 25);
      const s2 = await testState(page);
      await page.keyboard.up('KeyW');
      const h = s2.hero!;
      const deg = Math.abs(Math.atan2(h.vx, h.vz)) * (180 / Math.PI);
      rows.push(`${at}: out by «back» at ${s1.hero!.x.toFixed(1)}; «forward» ${deg.toFixed(0)}° off up the slope (v ${h.vx.toFixed(1)}, ${h.vz.toFixed(1)}; view ${((s2.viewYaw * 180) / Math.PI).toFixed(0)}°)`);
      expect(Math.hypot(h.vx, h.vz), rows.join('\n')).toBeGreaterThan(5);
      expect(deg, rows.join('\n')).toBeLessThanOrEqual(UP_DEG);
      await waitTicks(page, 20);
    }
  }
  console.log(`side grotto controls:\n${rows.join('\n')}`);
});
