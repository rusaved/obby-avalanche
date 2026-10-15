import { test, waitTicks } from './fixtures.ts';
test.use({ viewport: { width: 1280, height: 720 } });
test('look', async ({ page, openGame }) => {
  test.setTimeout(200_000);
  await openGame('pace=stages');
  await page.evaluate(() => { window.__TEST__!.setPlaySec(400); window.__TEST__!.holdWave(900); window.__TEST__!.setStat(5000); });
  for (const z of [880, 960, 1040, 1100, 1180, 1260, 1340]) {
    await page.evaluate((zz) => window.__TEST__!.teleport(zz, 0), z);
    await waitTicks(page, 40);
    await page.screenshot({ path: `/tmp/claude-0/-home-user-obby-avalanche/dc37b658-cda6-5773-b37f-c8e6994494b2/scratchpad/look-${z}.png` });
  }
});
