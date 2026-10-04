// `npm run e2e:sample`: build:e2e with VITE_CONTENT=_sample into dist-e2e-sample and run the sample smoke on it.
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const run = (cmd, args, env = {}) => {
  const res = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
  if (res.status !== 0) process.exit(res.status ?? 1);
};
run('npx', ['vite', 'build', '--mode', 'e2e', '--outDir', 'dist-e2e-sample'], { VITE_CONTENT: '_sample' });
run('npx', ['playwright', 'test', 'e2e/sample.spec.ts', '--project', 'desktop', '--config', 'playwright.config.ts'], {
  E2E_DIST: 'dist-e2e-sample',
  E2E_PORT: '4175',
});
