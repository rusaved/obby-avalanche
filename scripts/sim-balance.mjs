// `npm run sim:balance` — the economic model of docs/01-gdd.md 8.5 (port of docs/references/balance-model.pl,
// scripts/balance-model.ts): runs the profiles on the content pack, prints the checks of 8.5 and writes the table
// «wall → second, stat, shoes, pets, coins» to docs/evidence/balance.txt. Exit 0 — every check that runs is green.
// Checks 1, 2, 4 and 7 run since M2 (feature M2-11); the rest say SKIP with the reason until M3-10 brings them.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCycle } from './balance-model.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const packName = args.find((a) => a.startsWith('--pack='))?.slice(7) ?? 'avalanche';
const out = resolve(root, 'docs/evidence/balance.txt');

if (args.includes('--fit')) {
  console.error('sim:balance --fit: the fitting mode (docs/01-gdd.md 8.5) arrives with feature M3-10');
  process.exit(2);
}

const t0 = performance.now();
const read = (f) => JSON.parse(readFileSync(resolve(root, 'content', packName, f), 'utf8'));
const pack = {
  game: read('game.json'),
  balance: read('balance.json'),
  tuning: read('tuning.json'),
  pets: read('pets.json'),
  eggs: read('eggs.json'),
  trails: read('trails.json'),
  auras: read('auras.json'),
  worlds: read('worlds.json').worlds,
};

const SUF = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
function fmt(x) {
  if (!Number.isFinite(x)) return String(x);
  let i = 0;
  while (x >= 1000 && i < SUF.length - 1) {
    x /= 1000;
    i++;
  }
  let s = x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2);
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  return s + SUF[i];
}
const min = (sec) => (sec / 60).toFixed(1);

// Column «Бот модели» of docs/01a-content.md 3: second of the mountain the reference bot passes wall p (±10%, M3-10).
function referenceColumn() {
  const md = readFileSync(resolve(root, 'docs/01a-content.md'), 'utf8');
  const start = md.indexOf('## 3.');
  const end = md.indexOf('\n## 4.', start);
  const ref = new Map();
  for (const line of md.slice(start, end).split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 10 || !/^\d+$/.test(cells[1])) continue;
    const sec = Number(cells[cells.length - 2]);
    if (Number.isFinite(sec)) ref.set(Number(cells[1]), sec);
  }
  return packName === 'avalanche' ? ref : new Map();
}

const greedy = runCycle(pack, { profile: 'greedy' });
const lazy = runCycle(pack, { profile: 'lazy' });
const gold = pack.game.threat.bonus ? runCycle(pack, { profile: 'goldSeeker' }) : null;
const ref = referenceColumn();

const checks = [];
const check = (id, title, status, detail) => checks.push({ id, title, status, detail });
const skip = (id, title, reason, now) => check(id, title, 'SKIP', `${reason}${now ? `; сейчас (справочно): ${now}` : ''}`);

// 1. Greedy, tier 0: walls 1 / 3 / 6 of mountain 1 ≤ 10 / 30 / 150 s.
{
  const lim = [
    [1, 10],
    [3, 30],
    [6, 150],
  ];
  const got = lim.map(([w, l]) => [w, l, greedy.walls.find((r) => r.mountain === 1 && r.wall === w)?.sec ?? Infinity]);
  const ok = got.every(([, l, s]) => s <= l);
  check(1, 'жадный, ступень 0: стены 1 / 3 / 6 горы 1 ≤ 10 / 30 / 150 с', ok ? 'PASS' : 'FAIL', got.map(([w, l, s]) => `стена ${w} — ${s.toFixed(0)} с (≤ ${l})`).join(', '));
}
// 2. Greedy, tier 0: mountain 1 in 4.5–5.5 min.
{
  const m = (greedy.mountains[0] ?? Infinity) / 60;
  check(2, 'жадный, ступень 0: гора 1 — 4,5–5,5 мин', m >= 4.5 && m <= 5.5 ? 'PASS' : 'FAIL', `${m.toFixed(2)} мин`);
}
// 3. Greedy tier 0 mountains 1–5 28–34 min; every profile: mountain k ≥ 0.8 × mountain k−1.
{
  const ratios = greedy.mountains.slice(1).map((m, i) => m / greedy.mountains[i]);
  skip(3, 'ступень 0: горы 1–5 — 28–34 мин; каждый профиль: гора k ≥ 0,8 × гора k−1', 'будет на M3-10: профили «Активный день» и «Спамер яиц» (20 зёрен) не портированы', `жадный ${min(greedy.sec)} мин (горы ${greedy.mountains.map(min).join(' / ')}), мин. отношение соседних гор ${Math.min(...ratios).toFixed(2)}`);
}
// 4. Greedy, tier 0: the longest wall ≤ 75 s.
{
  const longest = greedy.walls.reduce((a, r) => (r.took > a.took ? r : a), greedy.walls[0]);
  const ok = Number.isFinite(greedy.sec) && longest.took <= 75;
  check(4, 'жадный, ступень 0: самая долгая стена ≤ 75 с', ok ? 'PASS' : 'FAIL', `стена ${longest.mountain}-${longest.wall} — ${longest.took.toFixed(0)} с (все 60 стен ступени 0)`);
}
// 5. Greedy, tier 0: between shoe purchases on mountains 1–3 ≤ 200 s.
{
  const end3 = greedy.walls.filter((r) => r.mountain <= 3).at(-1)?.total ?? 0;
  const buys = [0, ...greedy.shoeBuys.filter((t) => t <= end3)];
  const gap = Math.max(...buys.slice(1).map((t, i) => t - buys[i]));
  skip(5, 'жадный, ступень 0: между покупками кроссовок на горах 1–3 ≤ 200 с', 'будет на M3-10 (полная таблица кроссовок — фича M3-02)', `${gap.toFixed(0)} с`);
}
skip(6, 'жадный, ступени 1–9: цикл 17–23 мин, сумма 0–9 — 180–230 мин, гора ≤ 30% цикла', 'будет на M3-10: трейлов и аур нет в данных (M3-04), без них циклы ступеней не считаются');
// 7. Lazy, tier 0: mountain 1 ≤ 8 min; caught ≤ 40% of waves; never twice in one wave.
{
  const lazy1 = runCycle(pack, { profile: 'lazy', mountains: 1 });
  const m = (lazy1.mountains[0] ?? Infinity) / 60;
  const share = lazy1.normalWaves ? lazy1.caught / lazy1.normalWaves : 0;
  const ok = m <= 8 && share <= 0.4 && lazy1.doubleCaught === 0;
  check(7, 'ленивый, ступень 0: гора 1 ≤ 8 мин; поймала ≤ 40% лавин; дважды за лавину — ни разу', ok ? 'PASS' : 'FAIL', `${m.toFixed(2)} мин; поймала ${lazy1.caught} из ${lazy1.normalWaves} обычных лавин (${(share * 100).toFixed(0)}%), проигнорировал ${lazy1.ignoredWaves}; дважды за лавину — ${lazy1.doubleCaught}`);
}
skip(8, 'все профили: без рекламы, без «тупиков» (стена > 10 мин)', 'будет на M3-10: не все профили портированы', `жадный, ленивый${gold ? ', золотоискатель' : ''} — реклама в модели не используется, самая долгая стена ${Math.max(...[greedy, lazy, gold].filter(Boolean).flatMap((r) => r.walls.map((w) => w.took))).toFixed(0)} с`);
skip(9, 'таблицы: стены растут, wallScale растёт, цены кроссовок растут, шансы яиц = 1', 'будет на M3-10 (сейчас это проверяет validate:content частично: шансы яиц)');
skip(10, 'числа: Скорость на ступени 9 < 1e30, кубки < 2^53', 'будет на M3-10: ступени 1–9 не считаются без трейлов и аур');

// Reference column of 01a (±10%): deviation per wall of the greedy bot.
const dev = [];
for (const r of greedy.walls) {
  const s = ref.get(r.p);
  if (s) dev.push({ p: r.p, port: r.sec, ref: s, d: (r.sec - s) / s });
}
const within = dev.filter((x) => Math.abs(x.d) <= 0.1).length;
const firstOut = dev.find((x) => Math.abs(x.d) > 0.1);

const lines = [];
const L = (s = '') => lines.push(s);
L(`sim:balance — модель экономики docs/01-gdd.md 8.5 (порт docs/references/balance-model.pl), пакет ${packName}`);
L(`Профили: жадный, ленивый${gold ? ', золотоискатель' : ''}; ступень 0, без рекламы и покупок, зерно 12345 (генератор эталона)`);
L();
L('Проверки 8.5:');
for (const c of checks) L(` ${String(c.id).padStart(2)}. [${c.status}] ${c.title} — ${c.detail}`);
L();
L('Итог по горам, ступень 0 (мин):');
const sumLine = (name, r) => ` ${name.padEnd(16)} ${min(r.sec).padStart(5)} мин — горы ${r.mountains.map(min).join(' / ')}; обычных лавин ${r.normalWaves}, поймала ${r.caught}, яиц ${r.eggsBought}, питомцы ×${(1 + r.meta.pets.slice(0, pack.balance.pets.slots).reduce((a, b) => a + b, 0)).toFixed(2)}`;
L(sumLine('жадный', greedy));
L(sumLine('ленивый', lazy));
if (gold) L(sumLine('золотоискатель', gold) + `; золотых подарков ${gold.goldTaken} (порог M2-12: гора 1 ≥ 4,0 мин — ${min(gold.mountains[0])} мин)`);
if (dev.length) {
  L();
  L(`Сверка со столбцом «Бот модели» docs/01a-content.md, раздел 3 (±10%, требование M3-10): в допуске ${within} из ${dev.length} стен${firstOut ? `; первая вне допуска — стена ${firstOut.p} (${firstOut.port.toFixed(0)} с против ${firstOut.ref} с)` : ''}`);
}
const table = (name, r) => {
  L();
  L(`Таблица «стена → секунда, Скорость, кроссовки, питомцы, монеты» — ${name}, ступень 0:`);
  L(' стена   с горы  с цикла  за стену  Скорость  кроссовки        питомцы  монеты   01a, с  откл.');
  for (const w of r.walls) {
    const s = ref.get(w.p);
    const shoe = pack.balance.upgrade.tiers[w.shoe];
    const d = s ? `${Math.round(((w.sec - s) / s) * 100) || 0}%` : '';
    L(
      ` ${`${w.mountain}-${String(w.wall).padStart(2, '0')}`.padEnd(6)} ${w.sec.toFixed(0).padStart(6)}  ${w.total.toFixed(0).padStart(7)}  ${w.took.toFixed(0).padStart(8)}  ${fmt(w.stat).padStart(8)}  ${`L${w.shoe} ×${fmt(shoe?.mult ?? 1)}`.padEnd(15)}  ×${w.petMult.toFixed(2).padEnd(6)}  ${fmt(w.coins).padStart(6)}  ${String(s ?? '').padStart(6)}  ${d.padStart(5)}`,
    );
  }
};
table('жадный', greedy);
table('ленивый', lazy);
const failed = checks.filter((c) => c.status === 'FAIL');
L();
L(`Итог: ${checks.filter((c) => c.status === 'PASS').length} PASS, ${failed.length} FAIL, ${checks.filter((c) => c.status === 'SKIP').length} SKIP; ${((performance.now() - t0) / 1000).toFixed(2)} с`);

const text = lines.join('\n') + '\n';
if (packName === 'avalanche') {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
}
process.stdout.write(text);
if (failed.length) {
  console.error(`sim:balance: FAIL — ${failed.map((c) => `проверка ${c.id}`).join(', ')}`);
  process.exit(1);
}
