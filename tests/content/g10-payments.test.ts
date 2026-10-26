import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// G-10 (producer 26.10, Q-M6-1 «B, purchases on»): the release has purchases — 4 items for yans; the second release
// archive without them is built by build:pages with VITE_NO_PAYMENTS=1 (the flag of vite.config.ts).
const root = resolve(__dirname, '../..');
const game = JSON.parse(readFileSync(resolve(root, 'content/avalanche/game.json'), 'utf8')) as { payments?: { enabled?: boolean } };

describe('G-10 · purchases in the release', () => {
  it('game.json payments.enabled is true', () => expect(game.payments?.enabled).toBe(true));
  it('vite.config.ts and build:pages carry the build without purchases', () => {
    expect(readFileSync(resolve(root, 'vite.config.ts'), 'utf8')).toContain("__NO_PAYMENTS__: JSON.stringify(process.env.VITE_NO_PAYMENTS === '1')");
    const pages = readFileSync(resolve(root, 'scripts/build-pages.mjs'), 'utf8');
    expect(pages).toContain("VITE_NO_PAYMENTS: '1'");
    expect(pages).toContain('-no-iap.zip');
  });
});
