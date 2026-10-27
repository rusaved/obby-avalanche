// `npm run check:vk` (K-04, K-10, K-12, K-13 «Лавина 21»): the VK and OK build (dist-vk) passes the platform's rules as far as
// files can show them — no external address, no word or link of other platforms, no Yandex SDK or Metrika, no debug or test
// API, VK Bridge and VKWebAppInit present, the check kit only behind ?mock=vk; prints the weight. --submit: the ids filled.
// Contract: checkVkBuild(files: Array<[relativePath, text]>) => { problems: string[] }; exit 1 on a problem.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const TEXT_EXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt']);
const stop = JSON.parse(readFileSync(resolve(root, 'scripts/stopwords.json'), 'utf8'));

/** Words and code a player of VK or OK must never meet in this build. */
export const BANNED = [
  [/яндекс/i, 'Яндекс'],
  [/yandex/i, 'Yandex'],
  [/YaGames|ysdk/, 'Yandex SDK'],
  [/sdk\.js/, 'sdk.js Яндекса'],
  [/Telegram|Телеграм|t\.me\//, 'Telegram'],
  [/вконтакт/i, 'название VK (сборка общая для VK и ОК)'],
  [/одноклассник/i, 'название ОК (сборка общая для VK и ОК)'],
  [/mc\.yandex|tag\.js|window\.ym\b|googletagmanager|google-analytics|gtag\(/i, 'сторонний счётчик'],
  [/__TEST__|lil-gui|__STUDIO__|yasdk-mock|__YA_MOCK__/, 'тестовый API или отладка'],
  [/github\.io|github\.com/, 'ссылка на github (K-10)'],
  [/legal\/(terms|privacy)|terms\.html|privacy\.html/, 'своя страница документов (K-10)'],
];

const ALLOWED_NAMESPACES = ['http://www.w3.org/'];

export function checkVkBuild(files) {
  const problems = [];
  for (const [name, text] of files) {
    if (!TEXT_EXT.has(extname(name))) continue;
    for (const [re, what] of BANNED) if (re.test(text)) problems.push(`${name}: ${what} — «${text.match(re)[0]}»`);
    // K-10: no address outside the game's own (VK 4.2.3, OK 5.1).
    for (const m of text.matchAll(/["'`(=](https?:\/\/[^"'`)\s]+)/g)) {
      if (ALLOWED_NAMESPACES.some((ns) => m[1].startsWith(ns))) continue;
      problems.push(`${name}: внешний адрес ${m[1].slice(0, 80)}`);
    }
    if (/window\.open\(|\.open\(\s*[a-zA-Z_$][\w$]*\s*,\s*["']_blank/.test(text)) problems.push(`${name}: window.open`);
    if (/<a\s[^>]*href=/i.test(text)) problems.push(`${name}: ссылка <a href>`);
  }
  // Stop-list words in the shipped texts (the dictionary).
  const words = [...stop.devTraces, ...stop.brands, ...stop.onlineWords, ...stop.age.ru, ...stop.age.en];
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [name, text] of files.filter(([n]) => extname(n) === '.json')) {
    for (const w of words) {
      const re = new RegExp(`(^|[^\\p{L}\\p{N}_])${esc(w)}(?=$|[^\\p{L}\\p{N}_])`, 'iu');
      if (re.test(text)) problems.push(`${name}: слово стоп-списка «${w}»`);
    }
  }
  const all = files.map(([, t]) => t).join('\n');
  if (!all.includes('VKWebAppInit')) problems.push('VKWebAppInit: нет в сборке');
  if (!all.includes('VKWebAppCheckNativeAds')) problems.push('VKWebAppCheckNativeAds: нет в сборке');
  if (!all.includes('use_waterfall')) problems.push('use_waterfall: нет в вызовах рекламы');
  const html = files.find(([n]) => n === 'index.html')?.[1] ?? '';
  if (/<script[^>]+src="(https?:)?\/\//.test(html)) problems.push('index.html: внешний скрипт');
  if (!html.includes('data-boot-progress')) problems.push('index.html: нет строки загрузки (K-07)');
  return { problems };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const dir = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? resolve(root, 'dist-vk'));
  const files = [];
  let bytes = 0;
  let gz = 0;
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const buf = readFileSync(p);
        bytes += buf.length;
        if (['.js', '.css', '.html'].includes(extname(p))) gz += gzipSync(buf).length;
        files.push([relative(dir, p).split('\\').join('/'), TEXT_EXT.has(extname(p)) ? buf.toString('utf8') : '']);
      }
    }
  };
  walk(dir);
  const { problems } = checkVkBuild(files);
  const ids = JSON.parse(readFileSync(resolve(root, 'content/vk.json'), 'utf8'));
  const empty = ['appId', 'vkGroupId', 'okGroupId'].filter((k) => !ids[k]);
  if (empty.length && process.argv.includes('--submit')) problems.push(`content/vk.json: пусто — ${empty.join(', ')}`);
  else if (empty.length) console.log(`  ⚠ к подаче: пусто в content/vk.json — ${empty.join(', ')} (нет кнопки «Вступить»)`);
  const mb = (n) => (n / 1024 / 1024).toFixed(2);
  console.log(`check:vk: ${files.length} файлов, ${mb(bytes)} МБ, код gzip ${mb(gz)} МБ`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  if (problems.length) process.exit(1);
  console.log('check:vk: ok');
}
