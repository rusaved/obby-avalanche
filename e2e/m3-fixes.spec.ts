import { test, expect, testState, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { PACES, SHOT_PACE, paceBalance, paceWorlds, type Pace } from './pace-data.ts';
import ru from '../content/avalanche/i18n/ru.json' with { type: 'json' };

// PR-08 (docs/evidence/M3/playtest.md; docs/01-gdd.md 16.6, 16.7): the avalanche banner on a contrast plaque above the
// gate signs, the free egg only after «Phew, made it!», hint.stuck after 3 s with an arrow to the belt below the gate.
const DEG = Math.PI / 180;
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

type Seg = { type: string; z: number; y: number; side?: string; depth?: number };
/** Mountain 1 of the pace: gates and caves bottom up, and the belt of a cave (flush with its back wall, 3 units wide,
 * src/level/builder.ts). */
function mountain1(pace: Pace): { gates: Seg[]; niches: Seg[]; beltX: (n: Seg) => number } {
  const world = paceWorlds<{ width: number; segments: Seg[] }>(pace)[0]!;
  return {
    gates: world.segments.filter((s) => s.type === 'gate').sort((a, b) => a.z - b.z),
    niches: world.segments.filter((s) => s.type === 'niche').sort((a, b) => a.z - b.z),
    beltX: (n) => (n.side === 'right' ? 1 : -1) * (world.width / 2 + 3 + (n.depth ?? 4) - 1.5),
  };
}

/** WCAG contrast of a CSS colour over a CSS background composited on `under` (worst case: white snow). */
function contrast(fg: string, bg: string, under: [number, number, number]): number {
  const parse = (c: string): number[] => (c.match(/[\d.]+/g) ?? []).map(Number);
  const [br, bgG, bb, ba = 1] = parse(bg);
  const mix = [br! * ba + under[0] * (1 - ba), bgG! * ba + under[1] * (1 - ba), bb! * ba + under[2] * (1 - ba)];
  const lum = (rgb: number[]): number => {
    const [r, g, b] = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const a = lum(parse(fg).slice(0, 3));
  const b = lum(mix);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Every gate sign on screen now: its box in field px and whether it is hidden. */
async function signRects(page: Page, count: number): Promise<Array<{ i: number; hidden: boolean; r: { x0: number; y0: number; x1: number; y1: number } | null }>> {
  return page.evaluate((n) => {
    const api = window.__TEST__!;
    const out = [];
    for (let i = 0; i < n; i++) {
      const b = api.signBox(i);
      let r: { x0: number; y0: number; x1: number; y1: number } | null = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (let k = 0; k < 8 && r; k++) {
        const p = api.project(
          b.center[0] + ((k & 1 ? 1 : -1) * b.size[0]) / 2,
          b.center[1] + ((k & 2 ? 1 : -1) * b.size[1]) / 2,
          b.center[2] + ((k & 4 ? 1 : -1) * b.size[2]) / 2,
        );
        if (!p.ahead) r = null;
        else r = { x0: Math.min(r.x0, p.x), y0: Math.min(r.y0, p.y), x1: Math.max(r.x1, p.x), y1: Math.max(r.y1, p.y) };
      }
      out.push({ i, hidden: b.hidden, r });
    }
    return out;
  }, count);
}

async function bannerBox(page: Page): Promise<{ x0: number; y0: number; x1: number; y1: number; color: string; bg: string }> {
  return page.locator('[data-role="wave-banner"]').evaluate((e) => {
    const b = e.getBoundingClientRect();
    const f = document.querySelector('[data-role="hud"]')!.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return { x0: b.left - f.left, y0: b.top - f.top, x1: b.right - f.left, y1: b.bottom - f.top, color: cs.color, bg: cs.backgroundColor };
  });
}

for (const pace of PACES) {
  const balance = paceBalance(pace);
  const { gates, niches, beltX } = mountain1(pace);
  test(`avalanche banner (${pace}): contrast plaque, no visible gate sign under it on warn`, async ({ page, openGame }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openGame('pace=' + pace);
    // Right under closed wall 3 (playtest M3: «Avalanche in 9» printed on the huge red sign).
    await page.evaluate((z) => window.__TEST__!.teleport(z, 0), gates[2]!.z - 3);
    await waitTicks(page, 20);
    const before = (await signRects(page, gates.length))[2]!;
    expect(before.hidden).toBe(false);
    await page.evaluate(() => window.__TEST__!.triggerWave());
    let hiddenSeen = 0;
    let checks = 0;
    for (let i = 0; i < 60; i++) {
      await waitTicks(page, 3);
      const s = await testState(page);
      if (s.wave!.phase !== 'warn') break;
      const b = await bannerBox(page);
      for (const sign of await signRects(page, gates.length)) {
        if (sign.hidden) {
          hiddenSeen++;
          continue;
        }
        if (!sign.r) continue;
        const meet = sign.r.x0 < b.x1 && b.x0 < sign.r.x1 && sign.r.y0 < b.y1 && b.y0 < sign.r.y1;
        expect(meet, `sign ${sign.i} ${JSON.stringify(sign.r)} under the banner ${JSON.stringify(b)}`).toBe(false);
      }
      expect(contrast(b.color, b.bg, [255, 255, 255]), `${b.color} on ${b.bg}`).toBeGreaterThanOrEqual(4.5);
      if (checks++ === 5 && pace === SHOT_PACE) await page.screenshot({ path: 'docs/evidence/proto/banner_1920x1080_ru.png' });
    }
    expect(checks).toBeGreaterThan(10);
    // The scenario is real: the sign of wall 3 would be under the banner and was hidden for it.
    expect(hiddenSeen).toBeGreaterThan(0);
    // After the warning and the run the sign is back.
    await page.evaluate(() => window.__TEST__!.setTimeScale(4));
    await page.waitForFunction(() => window.__TEST__!.state().wave!.phase === 'idle', undefined, { timeout: 60_000 });
    await page.evaluate(() => window.__TEST__!.setTimeScale(1));
    await waitTicks(page, 3);
    expect((await signRects(page, gates.length)).every((x) => !x.hidden)).toBe(true);
  });

  test(`free egg (${pace}): not there and not taken before «Phew, made it!» of the scripted wave, then shown and taken`, async ({ page, openGame }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openGame('pace=' + pace);
    let s = await testState(page);
    expect(s.egg).toMatchObject({ phase: 'idle', shown: false, visible: false });
    const egg = s.egg!;
    const cave = niches[balance.ftue.scriptedWaveWall - 1]!;
    // Standing on its spot before the wave: nothing.
    await page.evaluate(([x, y, z]) => window.__TEST__!.teleport(z, x, y), [egg.x, egg.y + 0.05, egg.z] as const);
    await waitTicks(page, 30);
    s = await testState(page);
    expect(s.egg).toMatchObject({ phase: 'idle', shown: false, visible: false });
    expect(s.hand).toBe(false);
    // On the belt; the scripted wave comes to this cave.
    await page.evaluate(([x, y, z]) => window.__TEST__!.teleport(z, x, y), [beltX(cave), cave.y + 0.05, cave.z + 2] as const);
    await waitTicks(page, 5);
    await page.evaluate(() => window.__TEST__!.triggerWave());
    let touchedOnWarn = false;
    let phew = false;
    for (let i = 0; i < 2000 && !phew; i++) {
      await waitTicks(page, 2);
      s = await testState(page);
      phew = s.waveHud.toast.startsWith(ru['wave.survived'].split(' +')[0]!);
      if (phew) break;
      expect(s.egg, `before the toast: ${s.wave!.phase}`).toMatchObject({ phase: 'idle', shown: false, visible: false });
      if (!touchedOnWarn && s.wave!.phase === 'warn') {
        // Onto its spot during the warning: still nothing, back to the belt.
        await page.evaluate(([x, y, z]) => window.__TEST__!.teleport(z, x, y), [egg.x, egg.y + 0.05, egg.z] as const);
        await waitTicks(page, 10);
        expect((await testState(page)).egg).toMatchObject({ phase: 'idle', shown: false });
        await page.evaluate(([x, y, z]) => window.__TEST__!.teleport(z, x, y), [beltX(cave), cave.y + 0.05, cave.z + 2] as const);
        touchedOnWarn = true;
      }
    }
    expect(touchedOnWarn && phew).toBe(true);
    // The toast lasts 2 s of real time: the shot soon after, with the sparks of the egg flying out.
    await waitTicks(page, 10);
    if (pace === SHOT_PACE) await page.screenshot({ path: 'docs/evidence/proto/egg_after_phew_1920x1080_ru.png' });
    expect(s.egg).toMatchObject({ phase: 'idle', shown: true, visible: true });
    // Now a touch takes it: it hatches, the pet joins.
    await page.evaluate(([x, y, z]) => window.__TEST__!.teleport(z, x, y), [egg.x, egg.y + 0.05, egg.z] as const);
    await page.waitForFunction(() => window.__TEST__!.state().egg?.phase === 'done', undefined, { timeout: 30_000 });
    s = await testState(page);
    expect(s.pets).toContain(balance.ftue.freeEggPet);
  });

  test(`hint.stuck (${pace}): after ${balance.hints.stuckSec} s at a closed gate, with an arrow to the belt of the cave below it`, async ({ page, openGame }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openGame('pace=' + pace);
    const gate = gates[2]!;
    await page.evaluate((z) => window.__TEST__!.teleport(z, 0), gate.z - 3);
    await waitTicks(page, Math.round((balance.hints.stuckSec - 0.5) * 60));
    expect((await testState(page)).hint).not.toBe('hint.stuck');
    await waitTicks(page, 60);
    const s = await testState(page);
    expect(s.hint).toBe('hint.stuck');
    expect(s.hintText).toBe(ru['hint.stuck']);
    expect(s.arrows).toBe(true);
    await expect(page.locator('[data-role="hint"].shown [data-role="hint-arrow"].shown')).toBeVisible();
    // The belt of the nearest cave below this gate: on screen towards it, or behind the camera — the way on the ground.
    const cave = niches.filter((n) => n.z < gate.z).at(-1)!;
    const want = await page.evaluate(
      ([bx, by, bz]) => {
        const api = window.__TEST__!;
        const st = api.state();
        const h = st.hero!;
        const a = api.project(h.x, h.y + 2.5, h.z);
        const b = api.project(bx, by, bz);
        if (b.ahead) return Math.atan2(b.y - a.y, b.x - a.x);
        // Camera at viewYaw looks along (sin, cos); the screen's right is (−cos, sin) (src/input/control-frame.ts).
        const fx = Math.sin(st.viewYaw);
        const fz = Math.cos(st.viewYaw);
        const dx = bx - h.x;
        const dz = bz - h.z;
        return Math.atan2(-(dx * fx + dz * fz), dx * -fz + dz * fx);
      },
      [beltX(cave), cave.y + 1, cave.z] as const,
    );
    expect(Math.abs(wrap(s.hintArrow! - want)), `arrow ${s.hintArrow} vs belt ${want.toFixed(2)}`).toBeLessThanOrEqual(30 * DEG);
    if (pace === SHOT_PACE) await page.screenshot({ path: 'docs/evidence/proto/stuck_hint_1920x1080_ru.png' });
  });
}
