import './styles.css';
import { content, i18nUrls } from './content/index.ts';
import { configureAnalytics, track } from './analytics/index.ts';
import { createPlatform } from './platform/index.ts';
import { PauseManager } from './core/pause.ts';
import { createLoop } from './core/loop.ts';
import { log } from './core/log.ts';
import { loadDictionary, setDictionary, t } from './ui/i18n.ts';
import { createGameRenderer, createWebGL2Context, type GameRenderer } from './render/renderer.ts';
import { drawNoGraphics } from './ui/fallback.ts';
import { mountLabel } from './ui/label.ts';
import type { TestApi, TestBootState } from './test-api/index.ts';
import type { DebugPanel } from './debug/index.ts';

/**
 * Boot order (docs/02-tech.md 11.2): SDK init without a timeout → language → texts → scene → first frame →
 * LoadingAPI.ready() exactly once → GameplayAPI.start() when nothing pauses the game.
 */
async function boot(): Promise<void> {
  const { game, theme, tuning } = content;
  const params = new URLSearchParams(location.search);
  configureAnalytics({ counterId: game.metrikaCounterId, echoToConsole: __DEBUG_TOOLS__ });

  const pause = new PauseManager();
  const events: string[] = [];
  const bootState: TestBootState = { firstFrameAt: null, readyAt: null, controllable: false, glRenderer: '' };

  const platform = await createPlatform({ packId: game.id, leaderboardName: game.leaderboard?.name ?? '', track });
  platform.onPause(() => pause.add('sdk'));
  platform.onResume(() => pause.remove('sdk'));
  track('sdk_ready', { platform: platform.kind, lang: platform.lang, device: platform.device });

  const dict = await loadDictionary(i18nUrls[platform.lang]);
  setDictionary(platform.lang, dict);
  document.documentElement.lang = platform.lang;
  document.title = t('game.title');

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;
  const preloader = document.getElementById('preloader') as HTMLElement;

  let gr: GameRenderer | null = null;
  let debug: DebugPanel | null = null;
  const loop = createLoop({
    update: () => {
      /* simulation steps arrive with the hero at M1 */
    },
    render: (_alpha, frameDt) => {
      gr?.render();
      debug?.update(frameDt * 1000);
    },
    scheduler: {
      request: (cb) => requestAnimationFrame(cb),
      cancel: (id) => cancelAnimationFrame(id),
    },
  });

  let testApi: TestApi | null = null;
  if (__TEST_API__) {
    const mod = await import('./test-api/index.ts');
    testApi = mod.installTestApi({
      loop,
      pause,
      platform,
      renderer: () => gr,
      boot: bootState,
      events,
      packId: game.id,
      lang: platform.lang,
    });
    const sync = mod.mockClockSync;
    const base = loop.tick.bind(loop);
    let lastTicks = 0;
    let lastMs: number | null = null;
    loop.tick = (nowMs: number) => {
      base(nowMs);
      const realDt = lastMs === null ? 0 : (nowMs - lastMs) / 1000;
      lastMs = nowMs;
      sync((loop.ticks - lastTicks) * loop.step, realDt);
      lastTicks = loop.ticks;
    };
  }

  const gl = createWebGL2Context(canvas);
  if (!gl) {
    canvas.classList.add('fallback');
    drawNoGraphics(canvas, t('game.title'), t('fallback.noGraphics'), theme);
    preloader.classList.add('hidden');
    track('webgl_unavailable');
    platform.ready();
    events.push('ready');
    bootState.readyAt = 0;
    if (testApi) testApi.ready = true;
    return;
  }

  gr = createGameRenderer(canvas, gl, theme);
  bootState.glRenderer = gr.glRenderer;
  const fit = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    gr?.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
  };
  window.addEventListener('resize', fit);
  fit();
  await gr.compile();

  pause.onChange((paused) => {
    loop.paused = paused;
    events.push(paused ? 'pause' : 'resume');
    if (paused) {
      platform.gameplayStop();
    } else {
      loop.resetAccumulator();
      platform.gameplayStart();
    }
  });
  document.addEventListener('visibilitychange', () => pause.set_('hidden', document.hidden));
  window.addEventListener('blur', () => pause.add('blur'));
  window.addEventListener('focus', () => pause.remove('blur'));
  if (document.hidden) pause.add('hidden');

  // First frame drawn and controls live, then ready() (11.2, steps 6–7).
  gr.render();
  bootState.firstFrameAt = gr.info().frame;
  events.push('firstFrame');
  loop.paused = pause.paused;
  loop.start();
  preloader.classList.add('hidden');
  bootState.controllable = true;
  platform.ready();
  bootState.readyAt = gr.info().frame;
  events.push('ready');
  track('game_ready');
  if (!pause.paused) platform.gameplayStart();

  if (__BUILD_LABEL__) mountLabel(__BUILD_LABEL__, ui);
  if (__DEBUG_TOOLS__ && params.get('debug') === '1') {
    const mod = await import('./debug/index.ts');
    debug = mod.mountDebug({
      loop,
      renderer: () => gr,
      tuning,
      host: ui,
      storageKey: `${game.id}:debug`,
      isMobile: platform.device !== 'desktop',
    });
  }
  if (testApi) testApi.ready = true;
}

boot().catch((err: unknown) => {
  log.error('boot failed', err);
});
