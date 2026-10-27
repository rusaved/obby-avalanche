import { defineConfig, type Plugin, type Connect } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

// Content pack (docs/02-tech.md 5.1): `VITE_CONTENT=_sample npm run build:e2e`.
const pack = process.env.VITE_CONTENT || 'avalanche';
const root = import.meta.dirname;
const packDir = resolve(root, 'content', pack);

function readJson<T = Record<string, unknown>>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/** Milestone label for the producer link: last milestone whose features all pass (docs/05, section 2). */
function buildLabel(): string {
  const features = readJson<Array<{ milestone: string; passes: boolean; deferred: boolean }>>(
    resolve(root, 'feature_list.json'),
  );
  // PR — the pace prototype between M3 and M4 (docs/01-gdd.md 16.9).
  const order = ['M0', 'M1', 'M2', 'M3', 'PR', 'M4', 'M5', 'M6'];
  let done = 'M0';
  for (const m of order) {
    const list = features.filter((f) => f.milestone === m);
    if (list.length > 0 && list.every((f) => f.passes || f.deferred)) done = m;
    else break;
  }
  let sha = (process.env.BUILD_SHA || '').slice(0, 7);
  if (!sha) {
    try {
      sha = execSync('git rev-parse --short=7 HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    } catch {
      sha = 'local';
    }
  }
  const date = new Date().toISOString().slice(0, 10);
  return `${done} · ${date} · ${sha}`;
}

/** Serves the Yandex SDK mock as /sdk.js in dev and preview (docs/02-tech.md 11.9). Not part of any build. */
function sdkMockPlugin(): Plugin {
  const mockFile = resolve(root, 'dev/yasdk-mock/sdk.js');
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = (req.url || '').split('?')[0] ?? '';
    if (url === '/sdk.js' || url.endsWith('/sdk.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(readFileSync(mockFile));
      return;
    }
    next();
  };
  return {
    name: 'yasdk-mock',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

/** The short commit of this build (K-12: «build <sha>» in the pause of the Pages and VK builds). */
function buildSha(): string {
  const env = (process.env.BUILD_SHA || '').slice(0, 7);
  if (env) return env;
  try {
    return execSync('git rev-parse --short=7 HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'local';
  }
}

/**
 * K-02, K-04, K-10 (VK build): the data of the pack without what VK and OK must never see — the channels (Telegram, the
 * Yandex group), the Metrika counter, the leaderboard, the desktop shortcut, the codes, the review gift (content/vk.json
 * `game`); purchases off; the interstitial points of vk.json; the Russian dictionary with vk.json `i18n` applied (null — the
 * key is dropped) serves both languages (Russian only).
 */
function vkContentPlugin(): Plugin {
  const vk = readJson<{ game: { drop: string[]; dropGifts: string[] }; ads: { interstitial: string[] }; i18n: Record<string, string | null> }>(
    resolve(root, 'content/vk.json'),
  );
  const gameFile = resolve(packDir, 'game.json');
  const i18nRe = /[\\/]i18n[\\/](ru|en)\.json\?url$/;
  return {
    name: 'obby-vk-content',
    enforce: 'pre',
    load(id) {
      if (!i18nRe.test(id)) return null;
      const dict = readJson<Record<string, string>>(resolve(packDir, 'i18n/ru.json'));
      for (const [k, v] of Object.entries(vk.i18n)) {
        if (v === null) delete dict[k];
        else dict[k] = v;
      }
      const ref = this.emitFile({ type: 'asset', name: 'ru.json', source: JSON.stringify(dict) });
      return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
    },
    transform(code, id) {
      if (id.split('?')[0] !== gameFile) return null;
      const game = JSON.parse(code) as Record<string, unknown>;
      for (const k of vk.game.drop) delete game[k];
      const gifts = { ...((game['communityGifts'] as Record<string, unknown> | undefined) ?? {}) };
      for (const k of vk.game.dropGifts) delete gifts[k];
      game['communityGifts'] = gifts;
      game['payments'] = { enabled: false };
      game['ads'] = { ...((game['ads'] as Record<string, unknown> | undefined) ?? {}), interstitial: vk.ads.interstitial };
      return { code: JSON.stringify(game), map: null };
    },
  };
}

/** index.html placeholders: title and body color from the pack, Metrika counter, relative sdk.js on Pages; the VK build — no sdk.js, no counter, a loading line. */
function htmlPlugin(mode: string): Plugin {
  return {
    name: 'obby-html',
    transformIndexHtml(html) {
      const game = readJson<{ metrikaCounterId?: number }>(resolve(packDir, 'game.json'));
      const theme = readJson<{ sky: { bottom: string } }>(resolve(packDir, 'theme.json'));
      const ru = readJson<Record<string, string>>(resolve(packDir, 'i18n/ru.json'));
      const counter = Number(game.metrikaCounterId || 0);
      const metrikaAllowed = mode === 'production' || mode === 'playtest';
      const metrika =
        counter > 0 && metrikaAllowed
          ? `<script>(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");ym(${counter},"init",{clickmap:false,trackLinks:false,accurateTrackBounce:true});</script>`
          : '';
      let out = html
        .replace('<!--METRIKA-->', metrika)
        .replace('%GAME_TITLE%', ru['game.title'] ?? '')
        .replace(/%BODY_BG%/g, theme.sky.bottom);
      if (mode === 'pages') out = out.replace('<script src="/sdk.js"></script>', '<script src="sdk.js"></script>');
      if (mode === 'vk') {
        // K-07: «Loading N%» under the spinner from the first byte (main.ts fills the number as the boot goes).
        const vk = readJson<{ texts: { common: Record<string, string> } }>(resolve(root, 'content/vk.json'));
        const line = (vk.texts.common['boot.loading'] ?? '').replace('{n}', '0');
        out = out
          .replace('<script src="/sdk.js"></script>', '')
          .replace('<div class="spinner"></div></div>', `<div class="spinner"></div><p class="boot-progress" data-boot-progress="0">${line}</p></div>`)
          .replace('</style>', '#preloader{flex-direction:column;gap:14px}.boot-progress{margin:0;color:#fff;font:600 16px/1.2 sans-serif;text-shadow:0 1px 3px rgba(0,0,0,.35)}</style>');
      }
      return out;
    },
  };
}

export default defineConfig(({ mode }) => {
  // Build flags (docs/02-tech.md 16.1). Release (`vite build`, mode production): everything off.
  const flags = {
    development: { debug: true, studio: true, test: true, label: '' },
    production: { debug: false, studio: false, test: false, label: '' },
    playtest: { debug: true, studio: false, test: false, label: '' },
    e2e: { debug: true, studio: true, test: true, label: '' },
    pages: { debug: true, studio: true, test: false, label: 'auto' },
    // K-02: the VK and OK build (dist-vk) — no debug, studio or test API; the check kit only on ?mock=vk (K-12).
    vk: { debug: false, studio: false, test: false, label: '' },
  }[mode] ?? { debug: false, studio: false, test: false, label: '' };
  const vkBuild = mode === 'vk';
  const kit = mode === 'pages' || vkBuild;
  const label = flags.label === 'auto' ? buildLabel() : flags.label;
  if (!existsSync(packDir)) throw new Error(`content pack not found: ${packDir}`);

  return {
    base: './',
    plugins: [...(vkBuild ? [vkContentPlugin()] : [sdkMockPlugin()]), htmlPlugin(mode)],
    resolve: {
      alias: {
        '@content': packDir,
        '@vk': resolve(root, 'content/vk.json'),
        '@': resolve(root, 'src'),
      },
    },
    define: {
      __DEBUG_TOOLS__: JSON.stringify(flags.debug),
      __STUDIO__: JSON.stringify(flags.studio),
      __TEST_API__: JSON.stringify(flags.test),
      __BUILD_LABEL__: JSON.stringify(label),
      __SDK_PATH__: JSON.stringify(mode === 'pages' ? 'sdk.js' : '/sdk.js'),
      __CONTENT_PACK__: JSON.stringify(pack),
      __NO_PAYMENTS__: JSON.stringify(process.env.VITE_NO_PAYMENTS === '1'),
      __PLATFORM__: JSON.stringify(vkBuild ? 'vk' : 'yandex'),
      __KIT__: JSON.stringify(kit),
      __BUILD_SHA__: JSON.stringify(kit ? buildSha() : ''),
    },
    build: {
      target: 'es2022',
      sourcemap: false,
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 900,
      modulePreload: { polyfill: false },
    },
    server: { port: 5173, strictPort: false },
    preview: { port: 4173, strictPort: false },
  };
});
