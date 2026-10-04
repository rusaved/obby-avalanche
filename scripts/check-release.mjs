// `npm run check-release` (docs/02-tech.md 16.3): seven checks of the release archive; report in
// docs/evidence/release-check.txt. Green on the archive of `build`, red on the archive of `build:playtest`.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, extname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { unzipSync } from 'fflate';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const zipArg = args.find((a) => a.endsWith('.zip'));
const releaseDir = resolve(root, 'release');
const zipPath = zipArg
  ? resolve(zipArg)
  : (existsSync(releaseDir)
      ? readdirSync(releaseDir)
          .filter((f) => f.endsWith('.zip') && !f.includes('-playtest'))
          .map((f) => join(releaseDir, f))
          .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
      : undefined);
if (!zipPath || !existsSync(zipPath)) {
  console.error('check-release: no archive found — run npm run pack first');
  process.exit(1);
}
const reportPath = resolve(root, opt('report', 'docs/evidence/release-check.txt'));
const stop = JSON.parse(readFileSync(resolve(root, 'scripts/stopwords.json'), 'utf8'));

const zipBytes = readFileSync(zipPath);
const entries = unzipSync(new Uint8Array(zipBytes));
const files = Object.entries(entries).filter(([name]) => !name.endsWith('/'));
const text = (data) => Buffer.from(data).toString('utf8');
const lines = [];
const results = [];
let failed = 0;
const check = (n, title, ok, details = []) => {
  results.push({ n, title, ok });
  if (!ok) failed++;
  lines.push(`${ok ? 'PASS' : 'FAIL'}  ${n}. ${title}`);
  for (const d of details) lines.push(`        ${d}`);
};
const warnings = [];

const ALLOWED_NAMESPACES = [
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/XML/1998/namespace',
  'http://www.w3.org/2000/xmlns/',
];
const FORBIDDEN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com'];
const ALLOWED_URL = (u) => u === '/sdk.js' || /^(https?:)?\/\/mc\.yandex\.ru(\/|$)/.test(u);

// 1. index.html at the root, path charset.
{
  const names = files.map(([n]) => n);
  const badPaths = names.filter((n) => !/^[A-Za-z0-9._/-]+$/.test(n));
  check(1, 'index.html at the root, paths only [A-Za-z0-9._/-]', names.includes('index.html') && badPaths.length === 0, [
    ...(names.includes('index.html') ? [] : ['index.html is not at the archive root']),
    ...badPaths.map((p) => `bad path: ${p}`),
  ]);
}
// 2. Sizes.
{
  let unpacked = 0;
  let jsGzip = 0;
  for (const [name, data] of files) {
    unpacked += data.length;
    if (extname(name) === '.js') jsGzip += gzipSync(Buffer.from(data), { level: 9 }).length;
  }
  const details = [
    `zip ${(zipBytes.length / 1024).toFixed(1)} KB, unpacked ${(unpacked / 1024).toFixed(1)} KB, js gzip ${(jsGzip / 1024).toFixed(1)} KB`,
  ];
  if (zipBytes.length > 4 * 1024 * 1024) warnings.push('zip above the 4 MB target');
  if (jsGzip > 500 * 1024) warnings.push('js gzip above the 500 KB target');
  check(2, 'unpacked ≤ 10 MB and JS gzip ≤ 800 KB', unpacked <= 10 * 1024 * 1024 && jsGzip <= 800 * 1024, details);
}
// 3. External addresses where the browser loads from or sends to.
{
  const problems = [];
  const otherUrls = new Set();
  const isExternal = (u) => /^(https?:)?\/\//i.test(u);
  for (const [name, data] of files) {
    const ext = extname(name);
    if (!['.html', '.css', '.js', '.json'].includes(ext)) continue;
    const src = text(data);
    if (ext === '.html') {
      for (const m of src.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
        const u = m[1];
        if (isExternal(u) && !ALLOWED_URL(u)) problems.push(`${name}: ${u}`);
      }
      if (/<script[^>]+type\s*=\s*["']importmap["']/i.test(src)) problems.push(`${name}: importmap`);
    }
    if (ext === '.css') {
      for (const m of src.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) if (isExternal(m[1])) problems.push(`${name}: url(${m[1]})`);
      for (const m of src.matchAll(/@import\s+(?:url\()?["']?([^"')\s;]+)/gi)) if (isExternal(m[1])) problems.push(`${name}: @import ${m[1]}`);
    }
    if (ext === '.js') {
      const callRe = /(?:\bfetch\(|\.open\(\s*["'][A-Z]+["']\s*,|\bimport\(|new\s+Worker\(|new\s+WebSocket\(|sendBeacon\()\s*["']([^"']+)["']/g;
      for (const m of src.matchAll(callRe)) if (isExternal(m[1]) && !ALLOWED_URL(m[1])) problems.push(`${name}: ${m[0].slice(0, 80)}`);
      for (const m of src.matchAll(/["'`](https?:\/\/[^"'`\s]+)["'`]/g)) {
        const u = m[1];
        if (ALLOWED_NAMESPACES.some((ns) => u === ns || u.startsWith(ns))) continue;
        if (ALLOWED_URL(u)) continue;
        otherUrls.add(u);
      }
    }
    for (const host of FORBIDDEN_HOSTS) if (src.includes(host)) problems.push(`${name}: forbidden host ${host}`);
  }
  if (otherUrls.size) warnings.push(`other absolute addresses in strings (not loaded): ${Array.from(otherUrls).slice(0, 20).join(', ')}`);
  check(3, 'no external addresses except /sdk.js and mc.yandex.ru (namespaces allowed)', problems.length === 0, problems);
}
// 4. <script src="/sdk.js"> exactly once.
{
  const html = entries['index.html'] ? text(entries['index.html']) : '';
  const count = (html.match(/<script[^>]+src\s*=\s*["']\/sdk\.js["'][^>]*>/g) || []).length;
  check(4, '<script src="/sdk.js"> exactly once', count === 1, [`found ${count}`]);
}
// 5. No <audio>, <video>, new Audio(.
{
  const problems = [];
  for (const [name, data] of files) {
    if (!['.html', '.js'].includes(extname(name))) continue;
    const src = text(data);
    if (/<audio\b/i.test(src)) problems.push(`${name}: <audio`);
    if (/<video\b/i.test(src)) problems.push(`${name}: <video`);
    if (/new\s+Audio\s*\(/.test(src)) problems.push(`${name}: new Audio(`);
  }
  check(5, 'no <audio>, <video>, new Audio(', problems.length === 0, problems);
}
// 6. No development leftovers.
{
  const needles = ['lil-gui', '__TEST__', '__STUDIO__', '__YA_MOCK__', 'yasdk-mock', 'localhost', 'sourceMappingURL'];
  const problems = [];
  for (const [name, data] of files) {
    if (!['.html', '.js', '.css', '.json'].includes(extname(name))) continue;
    const src = text(data);
    for (const n of needles) if (src.includes(n)) problems.push(`${name}: ${n}`);
    if (/(^|[^.\w$])debugger\s*;?/m.test(src.replace(/["'`][^"'`]*["'`]/g, ''))) problems.push(`${name}: debugger`);
  }
  check(6, 'no lil-gui, __TEST__, __STUDIO__, __YA_MOCK__, yasdk-mock, localhost, debugger, sourceMappingURL', problems.length === 0, problems);
}
// 7. Dev-trace words and stop-list words in shipped texts (i18n json files).
{
  const words = [...stop.devTraces, ...stop.brands, ...stop.onlineWords, ...stop.age.ru, ...stop.age.en];
  const problems = [];
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const jsonFiles = files.filter(([n]) => extname(n) === '.json');
  for (const [name, data] of jsonFiles) {
    let parsed;
    try {
      parsed = JSON.parse(text(data));
    } catch {
      continue;
    }
    const values = [];
    const collect = (v) => {
      if (typeof v === 'string') values.push(v);
      else if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === 'object') Object.values(v).forEach(collect);
    };
    collect(parsed);
    for (const value of values) {
      for (const w of words) {
        const re = new RegExp(`(^|[^\\p{L}\\p{N}_])${esc(w)}(?=$|[^\\p{L}\\p{N}_])`, 'iu');
        if (re.test(value)) problems.push(`${name}: "${value.slice(0, 60)}" contains "${w}"`);
      }
    }
  }
  check(7, 'no development or stop-list words in shipped texts', problems.length === 0, problems.slice(0, 50));
}

const header = [
  `check-release: ${relative(root, zipPath)}`,
  `date: ${new Date().toISOString()}`,
  `files: ${files.length}`,
  ...files.map(([n, d]) => `  ${n}  ${(d.length / 1024).toFixed(1)} KB`).sort(),
  '',
];
const footer = ['', ...warnings.map((w) => `WARN  ${w}`), failed ? `RESULT: FAIL (${failed} check(s))` : 'RESULT: PASS'];
const report = [...header, ...lines, ...footer].join('\n') + '\n';
mkdirSync(resolve(reportPath, '..'), { recursive: true });
writeFileSync(reportPath, report);
console.log(report);
process.exit(failed ? 1 : 0);
