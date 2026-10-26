import { test, expect, waitTicks } from './fixtures.ts';
import { STAGES, flagOf, threshold } from './lv-stage-data.ts';

// MU round 3, item 3 (staff 19.10 at 915 × 412: three series from a clean save, holding forward got past the giant 3
// of 19 times; round 1 had 14 of 14). The giant ran after a bot 20 units aside and the head-on guess left it behind the
// hero. The hero coming up its corridor comes first: three series of 10 meetings each from a clean save, bots about —
// caught 30 of 30, never past. The bots in the zone as the hero steps in are counted (they must have been there).
// MU round 4, item 5 (producer 20.10: sometimes the giant paced to and fro instead of running at the hero): while the hero
// is in its corridor, the giant moves towards him at least 90 % of the time. On the truthful profile.

const ZONE = STAGES[0]!.stages.find((s) => s.type === 'giant')!;

for (const series of [1, 2, 3]) {
  test(`series ${series} from a clean save: holding forward is caught at 10 meetings in a row, bots about`, async ({ page, openGame }) => {
    test.setTimeout(480_000);
    await openGame('pace=stages&mock_fullscreen=deny');
    // G-01: the first catch of a clean save lets the hero go — these meetings count the ones after it.
    await page.evaluate(() => window.__TEST__!.setFlag('giantFree', true));
    await waitTicks(page, 10);
    // ST-02: the giant is the stage 3 now (its ridge asks for a level a clean save has not): the Speed of its level, at its flag.
    const gf = flagOf(1, ZONE);
    await page.evaluate(([st, z, y]) => {
      window.__TEST__!.setStat(st);
      window.__TEST__!.teleport(z, 0, y + 0.5);
    }, [threshold(ZONE.level), gf.z, gf.y] as const);
    await waitTicks(page, 10);
    await page.evaluate(() => window.__TEST__!.setTimeScale(3));
    // A meeting: the hero in the zone, then caught (out with the snowball) or past it; where the bots stood as he stepped in.
    await page.evaluate(([a, c]) => {
      const T = window.__TEST__!;
      const m = { caught: 0, passed: 0, botsIn: 0, log: [] as string[], toward: 0, samples: 0, modes: {} as Record<string, number> };
      (window as unknown as { __meets: typeof m }).__meets = m;
      let prev = 'out';
      // The world moves by ticks, the samples come more often: a sample counts only when something moved.
      let last: { x: number; z: number; hz: number; mode: string } | null = null;
      const at = (s: ReturnType<typeof T.state>): string => {
        const z = s.boss!.zones[0]!;
        return `hero ${s.hero!.x.toFixed(1)},${s.hero!.z.toFixed(1)} v ${s.hero!.speed.toFixed(1)} · giant ${z.giants.map((g) => `${g.x.toFixed(1)},${g.z.toFixed(1)} ${g.mode}`).join('; ')}`;
      };
      setInterval(() => {
        const s = T.state();
        const z = s.boss?.zones[0];
        if (!z || !s.hero) return;
        if (z.hero === 'in' && prev !== 'in') {
          const near = s.bots.filter((b) => b.z >= a - 20 && b.z <= c).length;
          if (near > 0) m.botsIn++;
          m.log.push(`in (bots near ${near}): ${at(s)}`);
        }
        if (prev === 'in' && z.hero === 'out' && s.caught) {
          m.caught++;
          m.log.push(`caught ${m.caught}: ${at(s)}`);
        }
        if (prev !== 'passed' && z.hero === 'passed') {
          m.passed++;
          m.log.push(`PASSED: ${at(s)}`);
        }
        // MU round 4 (producer 20.10: the giant sometimes paced to and fro instead of running at the hero): while the hero is
        // in its corridor, the giant moves towards him (its step this sample against the line to the hero).
        const g = z.giants[0]!;
        const moved = !last || last.x !== g.x || last.z !== g.z || last.hz !== s.hero.z || last.mode !== g.mode;
        if (z.hero === 'in' && prev === 'in' && last && moved) {
          const dx = g.x - last.x;
          const dz = g.z - last.z;
          m.samples++;
          m.modes[g.mode] = (m.modes[g.mode] ?? 0) + 1;
          if (m.samples < 40) m.log.push(`s ${g.mode} g ${g.x.toFixed(2)},${g.z.toFixed(2)} d ${dx.toFixed(2)},${dz.toFixed(2)} h ${s.hero.x.toFixed(1)},${s.hero.z.toFixed(1)}`);
          // Turning to him (0.5 s as he steps in) is the giant's answer to him too; a step towards him, or at him.
          if (g.mode === 'turn' || dx * (s.hero.x - g.x) + dz * (s.hero.z - g.z) > 0 || Math.hypot(s.hero.x - g.x, s.hero.z - g.z) < 3) m.toward++;
        }
        if (moved) last = { x: g.x, z: g.z, hz: s.hero.z, mode: g.mode };
        if (m.log.length > 80) m.log.splice(0, m.log.length - 80);
        prev = z.hero;
      }, 25);
    }, [ZONE.start, ZONE.end] as const);
    await page.evaluate(() => window.__TEST__!.stick(0, 1));
    type Meets = { caught: number; passed: number; botsIn: number; log: string[]; toward: number; samples: number; modes: Record<string, number> };
    const meets = (): Promise<Meets> => page.evaluate(() => (window as unknown as { __meets: Meets }).__meets);
    await page
      .waitForFunction(() => {
        const m = (window as unknown as { __meets: { caught: number; passed: number } }).__meets;
        return m.caught + m.passed >= 10 || m.passed > 0;
      }, undefined, { timeout: 450_000 })
      .catch(() => undefined);
    await page.evaluate(() => window.__TEST__!.stick(0, 0));
    const m = await meets();
    console.log(`series ${series}: caught ${m.caught}, passed ${m.passed}, bots by the zone at ${m.botsIn} meetings; towards the hero ${m.toward} of ${m.samples} samples ${JSON.stringify(m.modes)}`);
    expect(m.passed, `forward never gets past him\n${m.log.join('\n')}`).toBe(0);
    expect(m.caught, m.log.join('\n')).toBeGreaterThanOrEqual(10);
    expect(m.botsIn, `bots by the zone at some meetings\n${m.log.join('\n')}`).toBeGreaterThan(0);
    if (process.env.GIANT_DEBUG) console.log(m.log.filter((l) => l.startsWith('s ')).join('\n'));
    expect(m.samples).toBeGreaterThan(20);
    expect(m.toward / m.samples, `towards the hero while he is in the corridor ${JSON.stringify(m.modes)}`).toBeGreaterThanOrEqual(0.9);
  });
}
