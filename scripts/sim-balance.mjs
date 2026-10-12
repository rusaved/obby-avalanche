// `npm run sim:balance` — the economic model of docs/01-gdd.md 8.5 (port of docs/references/balance-model.pl,
// scripts/balance-model.ts): runs the profiles on the content pack, prints the 10 checks of 8.5 and writes the table
// «wall → second, stat, shoes, pets, coins» with the totals by mountains and tiers to docs/evidence/balance.txt.
// Exit 0 — every check is green, the port repeats the reference (column «Бот модели» of docs/01a-content.md 3, ±10%)
// and the gold seeker keeps its thresholds.
// `--fit` (docs/01-gdd.md 8.5): walls 4…60 and wallScale[1…9] by the procedure of the reference on the pack, written to
// worlds-spec.json and balance.json (then gen:worlds); not more than FIT_LIMIT runs per milestone, every run with its
// diff in docs/evidence/balance-fit.json and in balance.txt. `--fit --dry` only prints what a fit would change.
// Paces (docs/01-gdd.md 16.8): without `--pace=` every pace of the pack runs (classic and the folders content/<pack>/pace/*),
// exit 0 — all of them green. Classic — the 10 checks of 8.5, the reference and the gold seeker, docs/evidence/balance.txt;
// another pace — the checks F1–F10 of 16.8 on its worlds.json and the balance.json patch, docs/evidence/balance-<pace>.txt.
// `--fit --pace=fast` — the targets of the pace patch (`sim`: mountainMin, gateCurve, keep, roundDigits).
// `--pace-dir=<folder>` — a draft pace outside content/<pack>/pace/ (as content/<pack>/pace-draft/<pace>/ was before PS-12):
// the same checks on its worlds.json and balance.json patch, thresholds from `sim.checks` of the patch, F11 from
// `sim.eggsByMountain`; `--fit` writes its worlds-spec.json and balance.json but neither counts in balance-fit.json nor
// runs gen:worlds (a draft regenerates its worlds.json itself).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cosmeticMults, fitBalance, paceTargets, referenceTargets, runCycle, wallScale, withWalls } from './balance-model.ts';
import { CLASSIC_PACE, mergePatch } from '../src/content/pace.ts';
import { moveSpeed } from '../src/sim/effects/moveSpeed.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const packName = args.find((a) => a.startsWith('--pack='))?.slice(7) ?? 'avalanche';
const paceArg = args.find((a) => a.startsWith('--pace='))?.slice(7);
const paceDirArg = args.find((a) => a.startsWith('--pace-dir='))?.slice(11);
const paceRoot = resolve(root, 'content', packName, 'pace');
const paces = [CLASSIC_PACE, ...(existsSync(paceRoot) ? readdirSync(paceRoot).filter((d) => existsSync(resolve(paceRoot, d, 'worlds.json'))).sort() : [])];
if (!paceArg && !paceDirArg && !args.includes('--fit')) {
  // Every pace in its own process, one after the other; exit 0 — every pace green.
  let code = 0;
  for (const p of paces) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args, `--pace=${p}`], { stdio: 'inherit' });
    if (r.status !== 0) code = r.status ?? 1;
  }
  process.exit(code);
}
const pace = paceDirArg ? basename(resolve(root, paceDirArg)) : paceArg ?? CLASSIC_PACE;
if (!paceDirArg && !paces.includes(pace)) {
  console.error(`sim:balance: the pack ${packName} has no pace «${pace}» (${paces.join(', ')})`);
  process.exit(2);
}
const classic = pace === CLASSIC_PACE;
const out = resolve(root, classic ? 'docs/evidence/balance.txt' : `docs/evidence/balance-${pace}.txt`);
const fitLog = resolve(root, 'docs/evidence/balance-fit.json');
const FIT_LIMIT = 2;
const SPAM_SEEDS = 20;
const TIERS = 9;

const t0 = performance.now();
const packDir = resolve(root, 'content', packName);
// The data of the pace: worlds-spec.json, worlds.json and the balance.json patch of content/<pack>/pace/<pace>/.
const paceDir = classic ? packDir : paceDirArg ? resolve(root, paceDirArg) : resolve(paceRoot, pace);
const baseOf = (b) => (b.enabled ? { transitSec: b.transitSec } : undefined);
const readPack = () => {
  const read = (f) => JSON.parse(readFileSync(resolve(packDir, f), 'utf8'));
  const balance = classic ? read('balance.json') : mergePatch(read('balance.json'), JSON.parse(readFileSync(resolve(paceDir, 'balance.json'), 'utf8')));
  return {
    game: read('game.json'),
    balance,
    // With the tuning patch of the pace (SP-03: its controller.maxSpeed 120 is the ceiling of the run), as the game plays it.
    tuning: classic || !existsSync(resolve(paceDir, 'tuning.json')) ? read('tuning.json') : mergePatch(read('tuning.json'), JSON.parse(readFileSync(resolve(paceDir, 'tuning.json'), 'utf8'))),
    pets: read('pets.json'),
    eggs: read('eggs.json'),
    trails: read('trails.json'),
    auras: read('auras.json'),
    worlds: JSON.parse(readFileSync(resolve(paceDir, 'worlds.json'), 'utf8')).worlds,
    // The base of the pace (FM-14): the transit through it after every summit.
    base: !classic && existsSync(resolve(paceDir, 'base.json')) ? baseOf(JSON.parse(readFileSync(resolve(paceDir, 'base.json'), 'utf8'))) : undefined,
  };
};
let pack = readPack();
const wallsOf = (p) =>
  [...p.worlds].sort((a, b) => a.index - b.index).flatMap((w) => w.segments.filter((s) => s.type === 'gate').sort((a, b) => a.z - b.z).map((g) => g.requires));
const wallsPerMountain = [...pack.worlds].sort((a, b) => a.index - b.index).map((w) => w.segments.filter((s) => s.type === 'gate').length);
// Walls of classic, gates of a pace (docs/01-gdd.md 16): one, «of one», many, «of many».
const W = classic ? { one: 'стена', gen: 'стены', many: 'стены', manyGen: 'стен' } : { one: 'ворота', gen: 'ворот', many: 'ворота', manyGen: 'ворот', ...(pack.balance.sim?.words ?? {}) };
const where = (p) => {
  let m = 0;
  while (m < wallsPerMountain.length - 1 && p > wallsPerMountain[m]) p -= wallsPerMountain[m++];
  return `гора ${m + 1}, ${W.one} ${p}`;
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
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// docs/01a-content.md: the reference columns of section 3 (wall p → requirement, second of the reference bot) and of
// section 9 (wallScale, cycle), found by the column title — the tables also carry the game data after --fit (Q-027).
function referenceTables() {
  if (packName !== 'avalanche' || !classic) return null;
  const md = readFileSync(resolve(root, 'docs/01a-content.md'), 'utf8');
  const section = (h) => md.slice(md.indexOf(`\n## ${h}.`), md.indexOf('\n## ', md.indexOf(`\n## ${h}.`) + 4));
  const MULT = { '': 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12, Qa: 1e15 };
  const parse = (s) => {
    const m = /^×?([\d.]+)(K|M|B|T|Qa)?$/.exec(s.replace(/\s/g, ''));
    return m ? Number(m[1]) * MULT[m[2] ?? ''] : NaN;
  };
  // The first table of a section: [key, …cells of the columns whose titles start with `titles`] for every row.
  const columns = (h, titles) => {
    const rows = section(h)
      .split('\n')
      .filter((l) => l.startsWith('|'))
      .map((l) => l.split('|').slice(1, -1).map((x) => x.trim()));
    const at = titles.map((t) => rows[0].findIndex((x) => x.startsWith(t)));
    if (at.some((i) => i < 0)) throw new Error(`docs/01a-content.md ${h}: no column «${titles[at.indexOf(-1)]}»`);
    return rows.filter((c) => /^\d+$/.test(c[0])).map((c) => [Number(c[0]), ...at.map((i) => c[i])]);
  };
  const walls = [];
  const sec = [];
  for (const [p, req, s] of columns(3, ['Эталон', 'Бот модели'])) {
    walls[p - 1] = parse(req);
    sec[p - 1] = Number(s);
  }
  const scale = [];
  const cycle = [];
  for (const [n, ws, c] of columns(9, ['`wallScale` эталона', 'Бот эталона: цикл'])) {
    if (n > TIERS) continue;
    scale[n] = parse(ws);
    cycle[n] = Number(c.replace(',', '.'));
  }
  return { walls, sec, scale, cycle };
}

// Greedy bot through tiers 0…TIERS: pets, trophies, trails and auras and the generator go on from tier to tier.
function runTiers(p, opts = {}) {
  const runs = [runCycle(p, { profile: 'greedy', ...opts })];
  for (let n = 1; n <= TIERS; n++) {
    const prev = runs[n - 1];
    const meta = { ...prev.meta, pets: [...prev.meta.pets] };
    runs.push(runCycle(p, { profile: 'greedy', tier: n, meta, seed: prev.seedOut, ...opts, ...(opts.scale ? { wallScale: opts.scale[n] } : {}) }));
  }
  return runs;
}

// ---------- --fit ----------
function currentMilestone() {
  const list = JSON.parse(readFileSync(resolve(root, 'feature_list.json'), 'utf8'));
  return (Array.isArray(list) ? list : list.features ?? []).find((f) => !f.passes && !f.deferred)?.milestone ?? 'M?';
}
/**
 * A fitted advice moves the giant with it (docs/01a-content.md 16.4, допущение 58): V_b = v(advice) × the helpers' slow
 * (a zone with helpers, 18.5) / (1 + margin), down to 0.1, strictly under the threshold of validateOpenBoss. Only the
 * `speed` of every mountain's boss block of an open-slope spec changes; the text keeps its formatting.
 */
function fitGiants(text) {
  const spec = JSON.parse(text);
  if (spec.layout !== 'openSlope') return text;
  const curve = { ...pack.balance.speedCurve, base: pack.tuning.controller.baseSpeed, max: pack.tuning.controller.maxSpeed };
  let at = text.indexOf('"mountains"');
  for (const m of spec.mountains) {
    const b = m.boss;
    at = text.indexOf('"boss": {', at);
    if (!b || at < 0) break;
    const end = text.indexOf('}', text.indexOf('"speed"', at));
    const slow = b.helpers?.length ? (spec.boss.helper?.slow ?? 1) : 1;
    const v = moveSpeed(b.requires, curve) * slow;
    let vb = Math.floor((v / (1 + b.margin)) * 10) / 10;
    while (!(v > vb * (1 + b.margin))) vb = Math.round((vb - 0.1) * 10) / 10;
    text = text.slice(0, at) + text.slice(at, end).replace(/"speed": [\d.]+/, `"speed": ${vb}`) + text.slice(end);
    at = end;
  }
  return text;
}

function runFit(dry) {
  const targets = classic ? referenceTargets(wallsPerMountain) : pack.balance.sim ? paceTargets(pack.balance.sim, wallsPerMountain) : null;
  if (!targets) {
    console.error(
      classic
        ? `sim:balance --fit: the pack ${packName} has no targets of the reference model (5 mountains × 12 walls)`
        : `sim:balance --fit: the pace ${pace} has no targets (balance.json → sim.mountainMin, one per mountain, and gateCurve)`,
    );
    process.exit(2);
  }
  const log = existsSync(fitLog) ? JSON.parse(readFileSync(fitLog, 'utf8')) : [];
  const milestone = currentMilestone();
  const draft = !!paceDirArg;
  // Every run counts, an aborted one too (a draft pace does not count: it is not game data yet).
  if (!dry && !draft && log.filter((r) => r.milestone === milestone).length >= FIT_LIMIT) {
    console.error(`sim:balance --fit: already ${FIT_LIMIT} runs on ${milestone} (docs/01-gdd.md 8.5) — see docs/evidence/balance-fit.json`);
    process.exit(2);
  }
  const before = wallsOf(pack);
  const scaleBefore = pack.balance.rebirth.wallScale;
  const f = fitBalance(pack, targets);
  const walls = f.walls.map((to, i) => ({ p: i + 1, from: before[i], to })).filter((d) => d.from !== d.to);
  const scale = f.wallScale.map((to, n) => ({ n, from: scaleBefore[n], to })).filter((d) => d.from !== d.to);
  const run = { date: new Date().toISOString().slice(0, 10), milestone, pack: packName, ...(classic ? {} : { pace }), walls, wallScale: scale, cycleMin: f.cycleMin.map((m) => Number(m.toFixed(1))) };
  console.log(`sim:balance --fit${dry ? ' --dry' : ''}${classic ? '' : ` --pace=${pace}`}: ${classic ? 'стен' : 'ворот'} изменено ${walls.length}, wallScale — ${scale.length}`);
  for (const d of walls) console.log(`  ${W.one} ${d.p} (${where(d.p)}): ${fmt(d.from)} → ${fmt(d.to)}`);
  for (const d of scale) console.log(`  wallScale[${d.n}]: ${fmt(d.from)} → ${fmt(d.to)}`);
  console.log(`  циклы ступеней 0–${TIERS}, мин: ${run.cycleMin.join(' / ')}`);
  const growing = (xs) => xs.every((x, i) => i === 0 || x > xs[i - 1]);
  if (!growing(f.walls) || !growing(f.wallScale)) {
    console.error('sim:balance --fit: the fitted walls or wallScale do not grow strictly — nothing written');
    process.exit(2);
  }
  if (dry) process.exit(0);
  // worlds-spec.json: the «requires» of the walls in order of mountains (the file keeps its formatting).
  const specFile = resolve(paceDir, 'worlds-spec.json');
  let k = 0;
  let spec = readFileSync(specFile, 'utf8').replace(/"requires": [\d.e+]+/g, () => `"requires": ${f.walls[k++]}`);
  if (k !== f.walls.length) throw new Error(`worlds-spec.json: ${k} walls, the fit has ${f.walls.length}`);
  spec = fitGiants(spec);
  const balFile = resolve(paceDir, 'balance.json');
  const worldsFile = resolve(paceDir, 'worlds.json');
  const old = [specFile, balFile, worldsFile].map((f) => [f, readFileSync(f, 'utf8')]);
  writeFileSync(specFile, spec);
  const bal = readFileSync(balFile, 'utf8');
  const scaleJson = `"wallScale": [${f.wallScale.join(', ')}]`;
  // The patch of a pace may have no wallScale yet: it goes into its «rebirth».
  const balOut = /"wallScale": \[[^\]]*\]/.test(bal) ? bal.replace(/"wallScale": \[[^\]]*\]/, scaleJson) : bal.replace(/"rebirth": \{/, `"rebirth": { ${scaleJson},`);
  // Unchanged wallScale gives the same text: only a patch with neither wallScale nor «rebirth» has no place for it.
  if (!/"wallScale": \[[^\]]*\]/.test(bal) && !/"rebirth": \{/.test(bal)) throw new Error(`${balFile}: no place for wallScale (rebirth)`);
  writeFileSync(balFile, balOut);
  if (draft) {
    console.log(`sim:balance --fit: черновик ${paceDir} — записаны worlds-spec.json и balance.json; worlds.json перегенерируй генератором черновика и запусти проверки снова`);
    process.exit(0);
  }
  const gen = spawnSync(process.execPath, [resolve(root, 'scripts/gen-worlds.mjs'), packName], { stdio: 'inherit' });
  if (gen.status !== 0) {
    for (const [file, text] of old) writeFileSync(file, text);
    run.aborted = 'gen:worlds / validate:content с ошибкой, файлы восстановлены';
  }
  log.push(run);
  writeFileSync(fitLog, JSON.stringify(log, null, 2) + '\n');
  if (gen.status !== 0) process.exit(gen.status ?? 1);
  pack = readPack();
}
if (args.includes('--fit')) runFit(args.includes('--dry'));

// ---------- runs ----------
const tiers = runTiers(pack);
const greedy = tiers[0];
const lazy = runCycle(pack, { profile: 'lazy' });
const lazy1 = runCycle(pack, { profile: 'lazy', mountains: 1 });
const active = runCycle(pack, { profile: 'activeDay' });
const gold = pack.game.threat.bonus ? runCycle(pack, { profile: 'goldSeeker' }) : null;
const spam = Array.from({ length: SPAM_SEEDS }, (_, k) => runCycle(pack, { profile: 'eggSpammer', seed: 12345 + 7919 * k }));
const spamMed = { sec: median(spam.map((r) => r.sec)), mountains: wallsPerMountain.map((_, i) => median(spam.map((r) => r.mountains[i]))) };
const ref = referenceTables();

const checks = [];
const check = (id, title, ok, detail) => checks.push({ id: classic ? id : `F${id}`, title, status: ok ? 'PASS' : 'FAIL', detail });
const ratioOk = (ms) => ms.every((m, i) => i === 0 || m >= (LIM.ratio ?? 0.8) * ms[i - 1]);
const worstRatio = (ms) => Math.min(...ms.slice(1).map((m, i) => m / ms[i]));

// Thresholds: classic — docs/01-gdd.md 8.5, checks 1–10; another pace — 16.8, checks F1–F10 (the same checks, its numbers).
// A pace patch may carry its own thresholds (`sim.checks`, docs/01-gdd.md 17.8); the keys below are the defaults of fast.
const LIM = classic
  ? { early: [[1, 10], [3, 30], [6, 150]], m1: [4.5, 5.5], longest: 75, mean: null, shoeMountains: 3, shoeGap: 200, share: 0.3, lazyM1: 8, deadEnd: 600 }
  : { early: [[1, 5], [3, 12], [5, 25]], m1: [1.0, 1.5], longest: 30, mean: [3, 10], shoeMountains: 5, shoeGap: 150, share: 0.2, lazyM1: 3, deadEnd: 120, ...(pack.balance.sim?.checks ?? {}) };
const ru = (x) => x.toFixed(1).replace('.', ',');
const lastWall = wallsPerMountain.reduce((a, b) => a + b, 0);
// 1. Greedy, tier 0: walls 1 / 3 / 6 of mountain 1 ≤ 10 / 30 / 150 s (fast: gates 1 / 3 / 5 ≤ 5 / 12 / 25 s).
{
  const lim = LIM.early;
  const got = lim.map(([w, l]) => [w, l, greedy.walls.find((r) => r.mountain === 1 && r.wall === w)?.sec ?? Infinity]);
  check(1, `жадный, ступень 0: ${W.many} ${lim.map(([w]) => w).join(' / ')} горы 1 ≤ ${lim.map(([, l]) => l).join(' / ')} с`, got.every(([, l, s]) => s <= l), got.map(([w, l, s]) => `${W.one} ${w} — ${s.toFixed(0)} с (≤ ${l})`).join(', '));
}
// 2. Greedy, tier 0: mountain 1 in 4.5–5.5 min (fast: 1.0–1.5).
{
  const m = (greedy.mountains[0] ?? Infinity) / 60;
  check(2, `жадный, ступень 0: гора 1 — ${ru(LIM.m1[0])}–${ru(LIM.m1[1])} мин`, m >= LIM.m1[0] && m <= LIM.m1[1], `${m.toFixed(2)} мин`);
}
// 3. Greedy, tier 0: every mountain in 28–34 min (a pace: sim.checks.m1to10, «Размах» 28–38); every profile: mountain k ≥ 0.8 ×
// mountain k−1 (egg spammer: medians of 20 seeds).
const profiles = [
  ['жадный', greedy.mountains],
  ['ленивый', lazy.mountains],
  ['активный день', active.mountains],
  [`спамер яиц (медиана ${SPAM_SEEDS} зёрен)`, spamMed.mountains],
  ...(gold ? [['золотоискатель', gold.mountains]] : []),
];
{
  const m = greedy.sec / 60;
  const [lo, hi] = LIM.m1to10 ?? [28, 34];
  const ok = m >= lo && m <= hi && profiles.every(([, ms]) => ratioOk(ms));
  check(3, `ступень 0: жадный, горы 1–${wallsPerMountain.length} — ${lo}–${hi} мин; каждый профиль: гора k ≥ ${ru(LIM.ratio ?? 0.8).replace(',0', '')} × гора k−1`, ok, `жадный ${m.toFixed(1)} мин; худшее отношение соседних гор: ${profiles.map(([n, ms]) => `${n} ${worstRatio(ms).toFixed(2)}`).join(', ')}`);
}
// 4. Greedy, tier 0: the longest wall ≤ 75 s (fast: the longest gate ≤ 30 s, the mean of mountains 1–3 ≤ 10 s).
{
  const longest = greedy.walls.reduce((a, r) => (r.took > a.took ? r : a), greedy.walls[0]);
  const early = LIM.mean ? greedy.walls.filter((r) => r.mountain <= LIM.mean[0]) : [];
  const mean = early.length ? early.reduce((a, r) => a + r.took, 0) / early.length : 0;
  const ok = Number.isFinite(greedy.sec) && longest.took <= LIM.longest && (!LIM.mean || mean <= LIM.mean[1]);
  check(
    4,
    LIM.mean ? `жадный, ступень 0: самые долгие ворота ≤ ${LIM.longest} с; среднее на горах 1–${LIM.mean[0]} ≤ ${LIM.mean[1]} с` : `жадный, ступень 0: самая долгая стена ≤ ${LIM.longest} с`,
    ok,
    `${W.one} ${longest.mountain}-${longest.wall} — ${longest.took.toFixed(0)} с (все ${greedy.walls.length} ${W.manyGen} ступени 0)${LIM.mean ? `; среднее на горах 1–${LIM.mean[0]} — ${mean.toFixed(1)} с` : ''}`,
  );
}
// 5. Greedy, tier 0: between shoe purchases on mountains 1–3 ≤ 200 s (fast: mountains 1–5 ≤ 150 s).
{
  const endAt = greedy.walls.filter((r) => r.mountain <= LIM.shoeMountains).at(-1)?.total ?? 0;
  const buys = [0, ...greedy.shoeBuys.filter((t) => t <= endAt)];
  const gaps = buys.slice(1).map((t, i) => t - buys[i]);
  const gap = Math.max(...gaps);
  check(5, `жадный, ступень 0: между покупками кроссовок на горах 1–${LIM.shoeMountains} ≤ ${LIM.shoeGap} с`, gap <= LIM.shoeGap, `самый долгий промежуток ${gap.toFixed(0)} с (покупок ${gaps.length})`);
}
// 6. Greedy, tiers 1–9: every cycle 17–23 min; tiers 0–9 in 180–230 min; no mountain longer than 30% of its cycle (fast: 20%).
const total = tiers.reduce((a, r) => a + r.sec, 0) / 60;
{
  const cyc = tiers.slice(1).map((r) => r.sec / 60);
  const share = Math.max(...tiers.slice(1).flatMap((r) => r.mountains.map((m) => m / r.sec)));
  const ok = cyc.every((c) => c >= 17 && c <= 23) && total >= 180 && total <= 230 && share <= LIM.share;
  check(6, `жадный, ступени 1–9: цикл 17–23 мин, сумма 0–9 — 180–230 мин, гора ≤ ${Math.round(LIM.share * 100)}% цикла`, ok, `циклы ${cyc.map((c) => c.toFixed(1)).join(' / ')}; сумма ${total.toFixed(0)} мин; самая долгая гора — ${(share * 100).toFixed(0)}% цикла`);
}
// 7. Lazy, tier 0: mountain 1 ≤ 8 min (fast: 3); caught ≤ 40% of waves; never twice in one wave.
{
  const m = (lazy1.mountains[0] ?? Infinity) / 60;
  const share = lazy1.normalWaves ? lazy1.caught / lazy1.normalWaves : 0;
  const ok = m <= LIM.lazyM1 && share <= 0.4 && lazy1.doubleCaught === 0;
  check(7, `ленивый, ступень 0: гора 1 ≤ ${LIM.lazyM1} мин; поймала ≤ 40% лавин; дважды за лавину — ни разу`, ok, `${m.toFixed(2)} мин; поймала ${lazy1.caught} из ${lazy1.normalWaves} обычных лавин (${(share * 100).toFixed(0)}%), проигнорировал ${lazy1.ignoredWaves}; дважды за лавину — ${lazy1.doubleCaught}`);
}
// 8. Every profile: no action that needs an ad (the model has none: rewards without «▶ Реклама», no purchases); no dead end
// (a wall longer than 10 min; fast: a gate longer than 2 min).
{
  const all = [...tiers, lazy, active, ...spam, ...(gold ? [gold] : [])];
  const worst = Math.max(...all.flatMap((r) => r.walls.map((w) => w.took)));
  const ok = all.every((r) => Number.isFinite(r.sec) && r.walls.length === lastWall) && worst <= LIM.deadEnd;
  check(
    8,
    classic ? 'все профили: без рекламы, без «тупиков» (стена > 10 мин)' : `все профили: без рекламы, ни одних ворот дольше ${LIM.deadEnd / 60} мин`,
    ok,
    `${all.length} прогонов (жадный на ступенях 0–${TIERS}, ленивый, активный день, спамер × ${SPAM_SEEDS}${gold ? ', золотоискатель' : ''}) без действий за рекламу; ${classic ? 'самая долгая стена' : 'самые долгие ворота'} ${worst.toFixed(0)} с`,
  );
}
// 9. Tables: walls strictly grow inside every tier (with lateEase), wallScale strictly grows, shoe prices grow, egg chances sum to 1.
{
  const bad = [];
  const base = wallsOf(pack);
  const last = base.length;
  for (let n = 0; n <= TIERS; n++) {
    const req = base.map((w, i) => w * wallScale(pack.balance, n) * (n >= 1 && i + 1 >= pack.balance.rebirth.lateEase.fromWall ? 1 - ((1 - pack.balance.rebirth.lateEase.toFactor) * (i + 2 - pack.balance.rebirth.lateEase.fromWall)) / (last - pack.balance.rebirth.lateEase.fromWall + 1) : 1));
    for (let i = 1; i < req.length; i++) if (!(req[i] > req[i - 1])) bad.push(`ступень ${n}: ${W.one} ${i + 1} не больше ${W.gen} ${i}`);
  }
  const ws = pack.balance.rebirth.wallScale;
  for (let i = 1; i < ws.length; i++) if (!(ws[i] > ws[i - 1])) bad.push(`wallScale[${i}] не больше wallScale[${i - 1}]`);
  const shoes = pack.balance.upgrade.tiers;
  for (let i = 1; i < shoes.length; i++) if (!(shoes[i].price > shoes[i - 1].price)) bad.push(`кроссовки ${i}: цена не растёт`);
  for (const e of pack.eggs.eggs) {
    const sum = e.pool.reduce((a, s) => a + s.chance, 0);
    if (Math.abs(sum - 1) > 1e-9) bad.push(`яйцо ${e.id}: шансы в сумме ${sum}`);
  }
  check(9, `таблицы: ${W.many} растут, wallScale растёт, цены кроссовок растут, шансы яиц = 1`, bad.length === 0, bad.length ? bad.slice(0, 5).join('; ') : `${W.many} ступеней 0–${TIERS} (с lateEase), wallScale ${ws.length}, кроссовки ${shoes.length}, яйца ${pack.eggs.eggs.length} — ок`);
}
// 10. Numbers: the stat on tier 9 is finite and < 1e30; trophies of all time < 2^53.
{
  const stat = Math.max(...tiers[TIERS].walls.map((w) => w.stat));
  const trophies = tiers.reduce((a, r) => a + r.trophiesGot, 0);
  check(10, 'числа: Скорость на ступени 9 < 1e30, кубки за всё время < 2^53', Number.isFinite(stat) && stat < 1e30 && trophies < 2 ** 53, `Скорость у ${W.gen} ${lastWall} ступени ${TIERS} — ${fmt(stat)} (${stat.toExponential(2)}); кубков за ступени 0–${TIERS} — ${trophies}`);
}

// 11. Greedy, tier 0: eggs bought by the summit of mountain N ≥ K (docs/01-gdd.md 17.8, decision of 07.10: coins must pull
// into eggs) — only for a pace whose patch names the targets (`sim.eggsByMountain`).
if (!classic && Array.isArray(pack.balance.sim?.eggsByMountain)) {
  const rules = pack.balance.sim.eggsByMountain;
  const got = rules.map((r) => [r.mountain, r.min, greedy.eggsAt[r.mountain - 1] ?? 0]);
  check(11, `жадный, ступень 0: к вершине горы ${rules.map((r) => r.mountain).join(' / ')} куплено яиц ≥ ${rules.map((r) => r.min).join(' / ')}`, got.every(([, k, n]) => n >= k), got.map(([m, k, n]) => `гора ${m} — ${n} (≥ ${k})`).join(', '));
}

// 12. The giant's helpers (docs/01-gdd.md 18.5, 18.11): a run at the Speed of the advice passes a zone with helpers even
// slowed by a snowball at the meeting — v(advice) × slow > V_b × (1 + margin) on every mountain that has them.
const helperZones = classic ? [] : [...pack.worlds].sort((a, b) => a.index - b.index).flatMap((w) => (w.bosses ?? []).filter((b) => b.helpers?.length).map((b) => ({ w: w.index, b })));
if (helperZones.length) {
  const curve = { ...pack.balance.speedCurve, base: pack.tuning.controller.baseSpeed, max: pack.tuning.controller.maxSpeed };
  const margin = pack.game.threat.boss?.margin ?? 0;
  const rows = helperZones.map(({ w, b }) => {
    const slow = Math.min(...b.helpers.map((h) => h.slow));
    return [w, moveSpeed(b.requires, curve) * slow, Math.max(...b.giants.map((g) => g.speed)) * (1 + margin)];
  });
  check(12, `помощники великана: Скорость совета со снежком в миг встречи проходит зону (горы ${rows[0][0]}–${rows.at(-1)[0]})`, rows.every(([, v, vb]) => v > vb), rows.map(([w, v, vb]) => `гора ${w} — ${v.toFixed(1)} > ${vb.toFixed(1)}`).join(', '));
}

// 13. Varied mountains (docs/01-gdd.md 18.11): with the elements and the events every mountain of the greedy bot on
// tier 0 is at most `growth` longer than before them (the pace patch: sim.checks.before, minutes a mountain).
if (LIM.before) {
  const growth = LIM.growth ?? 0.1;
  const rows = LIM.before.map((b, i) => [i + 1, (greedy.mountains[i] ?? Infinity) / 60, b]);
  const worst = rows.reduce((a, r) => (r[1] / r[2] > a[1] / a[2] ? r : a), rows[0]);
  check(13, `жадный, ступень 0: гора k не длиннее прежней больше чем на ${Math.round(growth * 100)}%`, rows.every(([, m, b]) => m <= b * (1 + growth) + 1e-9), `${rows.map(([w, m, b]) => `${w}: ${m.toFixed(1)}/${b.toFixed(1)}`).join(', ')}; худшая — гора ${worst[0]}, ×${(worst[1] / worst[2]).toFixed(2)}`);
}

// 14. Rhythm of the first minutes (docs/01-gdd.md 19.6; 01a 18.3): in the first `sec` seconds of the cycle the greedy bot
// gets a reward (a wall, shoes, an egg, «Phew, made it!») at least every `maxGap` s, and stands on a belt waiting for
// the number of a wall of mountain 1 (its ridges and the giant) at most `standMax` s; the novice (runs × noviceSpeed,
// buys noviceDelaySec after it can pay) at most `noviceStandMax` s. Only a pace whose patch names `sim.checks.rhythm`.
let rhythm = null;
if (LIM.rhythm) {
  const r = LIM.rhythm;
  const nov = runCycle(pack, { profile: 'novice', mountains: 1, novice: { speed: r.noviceSpeed ?? 0.8, delaySec: r.noviceDelaySec ?? 15 } });
  const within = greedy.rewards.filter((t) => t <= r.sec);
  const marks = [0, ...within, r.sec];
  let gap = 0;
  let gapAt = 0;
  for (let i = 1; i < marks.length; i++)
    if (marks[i] - marks[i - 1] > gap) {
      gap = marks[i] - marks[i - 1];
      gapAt = marks[i - 1];
    }
  const m1 = (run) => run.walls.filter((w) => w.mountain === 1);
  const stand = Math.max(0, ...m1(greedy).map((w) => w.standSec));
  const nStand = Math.max(0, ...m1(nov).map((w) => w.standSec));
  rhythm = { within, novice: nov };
  check(
    14,
    `ритм первых ${r.sec} с: награда у жадного не реже раза в ${r.maxGap} с; стоянка на дорожке у рубежей горы 1 — жадный ≤ ${r.standMax} с, новичок ≤ ${r.noviceStandMax} с`,
    gap <= r.maxGap && stand <= r.standMax && nStand <= r.noviceStandMax,
    `награды на ${within.map((t) => t.toFixed(0)).join(', ')} с; самый долгий промежуток ${gap.toFixed(0)} с (с ${gapAt.toFixed(0)}-й); стоянка у ${W.gen} горы 1 — жадный ${m1(greedy).map((w) => w.standSec.toFixed(0)).join(' / ')} с, новичок ${m1(nov).map((w) => w.standSec.toFixed(0)).join(' / ')} с (гора 1 новичка — ${min(nov.mountains[0] ?? Infinity)} мин)`,
  );
}

// 15. The buyer (docs/01-gdd.md 19.7, P1): VIP and the starter pack from `fromSec` speed the game up but never skip it —
// every mountain of tier 0 and the cycle take at least `minShare` of the greedy bot's; the first fromSec seconds are the
// greedy bot's second by second. Only a pace whose patch names `sim.checks.buyer`.
let buyerRun = null;
if (LIM.buyer) {
  const b = LIM.buyer;
  buyerRun = runCycle(pack, { profile: 'buyer', buyer: { fromSec: b.fromSec, vip: b.vip !== false, starter: b.starter !== false } });
  const share = (b.minShare ?? 0.5);
  const worst = greedy.mountains.map((m, i) => [i + 1, buyerRun.mountains[i] / m]).reduce((a, r) => (r[1] < a[1] ? r : a), [0, Infinity]);
  const early = (r) => r.rewards.filter((t) => t < b.fromSec).map((t) => t.toFixed(6)).join(',');
  const same = early(buyerRun) === early(greedy);
  check(
    15,
    `покупатель (VIP и стартовый набор с ${b.fromSec} с): каждая гора и цикл ступени 0 ≥ ${share} × жадного; первые ${b.fromSec} с — как у жадного`,
    worst[1] >= share && buyerRun.sec >= share * greedy.sec && same,
    `цикл ${min(buyerRun.sec)} мин (×${(buyerRun.sec / greedy.sec).toFixed(2)} жадного); худшая гора — ${worst[0]}, ×${worst[1].toFixed(2)}; первые ${b.fromSec} с ${same ? 'совпадают' : 'расходятся'}`,
  );
}

// ---------- M3-10: the port repeats the reference; the gold seeker thresholds ----------
const gates = [];
let fidelity = null;
if (ref) {
  // Reference mode: the reference procedure (inverse run → table, direct run) on the assumptions of balance-model.pl.
  const targets = referenceTargets(wallsPerMountain);
  const inv = runCycle(pack, { profile: 'greedy', reference: true, fit: { keep: targets.keep, targetSec: targets.targetSec } });
  const refPack = withWalls(pack, inv.fitted);
  const refTiers = runTiers(refPack, { reference: true, scale: ref.scale });
  const wallsSame = inv.fitted.filter((w, i) => w === ref.walls[i]).length;
  const dev = refTiers[0].walls.map((r) => (r.sec - ref.sec[r.p - 1]) / ref.sec[r.p - 1]);
  const within = dev.filter((d) => Math.abs(d) <= 0.1).length;
  const cyc = refTiers.map((r, n) => [r.sec / 60, ref.cycle[n]]);
  const cycOk = cyc.every(([a, b]) => Math.abs(a - b) / b <= 0.1);
  const ok = within === ref.sec.length && wallsSame === ref.walls.length && cycOk;
  const firstOut = dev.findIndex((d) => Math.abs(d) > 0.1);
  fidelity = { within, wallsSame, cyc, worst: Math.max(...dev.map(Math.abs)) };
  gates.push({
    title: 'порт = эталон: столбец «Бот модели» docs/01a-content.md 3 ±10% (допущения эталона)',
    ok,
    detail: `в допуске ${within} из ${ref.sec.length} стен (наибольшее отклонение ${(fidelity.worst * 100).toFixed(1)}%${firstOut >= 0 ? `, первая вне — стена ${firstOut + 1}` : ''}); обратный расчёт дал столбец «Эталон» — ${wallsSame} из ${ref.walls.length}; циклы ступеней 0–${TIERS} по разделу 9 ±10% — ${cycOk ? 'да' : 'нет'} (${cyc.map(([a]) => a.toFixed(1)).join(' / ')})`,
  });
}
if (gold && classic) {
  const m1 = gold.mountains[0] / 60;
  const m = gold.sec / 60;
  gates.push({ title: 'золотоискатель: гора 1 ступени 0 ≥ 4,0 мин (M2-12), ступень 0 ≥ 24 мин (M3-10)', ok: m1 >= 4 && m >= 24, detail: `гора 1 — ${m1.toFixed(1)} мин, ступень 0 — ${m.toFixed(1)} мин; золотых подарков ${gold.goldTaken}` });
}

// ---------- report ----------
const lines = [];
const L = (s = '') => lines.push(s);
L(`sim:balance — модель экономики docs/01-gdd.md 8.5 (порт docs/references/balance-model.pl), пакет ${packName}${classic ? '' : `, темп ${pace} (01-gdd 16.8: worlds.json и заплатка balance.json из pace/${pace}/)`}`);
L(`Профили: жадный (ступени 0–${TIERS}), ленивый, активный день, спамер яиц (${SPAM_SEEDS} зёрен)${gold ? ', золотоискатель' : ''}; без рекламы и покупок, зерно 12345 (генератор эталона)`);
if (pack.base) L(`База между горами (01-gdd 19.2): после каждой вершины ${pack.base.transitSec} с от появления на базе до портала (base.json transitSec)`);
L();
L(classic ? 'Проверки 8.5:' : `Проверки 16.8 (темп ${pace}):`);
for (const c of checks) L(` ${String(c.id).padStart(classic ? 2 : 3)}. [${c.status}] ${c.title} — ${c.detail}`);
L();
if (classic) {
  L('Требования M3-10 (не входят в 10 проверок):');
  for (const g of gates) L(`  - [${g.ok ? 'PASS' : 'FAIL'}] ${g.title} — ${g.detail}`);
  L();
}
L('Итог по горам, ступень 0 (мин):');
const petsOf = (r) => (1 + r.meta.pets.slice(0, pack.balance.pets.slots).reduce((a, b) => a + b, 0)).toFixed(2);
const first5 = (r) => r.caughtAt.filter((t) => t <= 300).length;
const sumLine = (name, r) => ` ${name.padEnd(16)} ${min(r.sec).padStart(5)} мин — горы ${r.mountains.map(min).join(' / ')}; обычных лавин ${r.normalWaves}, поймала ${r.caught} (в первые 5 мин — ${first5(r)}), яиц ${r.eggsBought}, питомцы ×${petsOf(r)}`;
L(sumLine('жадный', greedy));
L(sumLine('ленивый', lazy));
L(sumLine('активный день', active));
L(` ${'спамер яиц'.padEnd(16)} ${min(spamMed.sec).padStart(5)} мин — горы ${spamMed.mountains.map(min).join(' / ')} (медиана ${SPAM_SEEDS} зёрен 12345 + 7919·k; зерно 12345 — ${min(spam[0].sec)} мин)`);
if (gold) L(sumLine('золотоискатель', gold) + `; золотых подарков ${gold.goldTaken}`);
if (buyerRun) L(sumLine('покупатель', buyerRun) + ` (VIP и стартовый набор с ${LIM.buyer.fromSec} с)`);
if (rhythm) L(` новичок (F14)       ${min(rhythm.novice.sec).padStart(5)} мин — гора 1; кроссовки на секундах ${rhythm.novice.shoeBuys.slice(0, 3).map((t) => t.toFixed(0)).join(', ')}`);
if (lazy.caughtAt.length) L(` ленивый: «Накрыло» на секундах цикла ${lazy.caughtAt.slice(0, 12).map((t) => t.toFixed(0)).join(', ')}${lazy.caughtAt.length > 12 ? ', …' : ''}`);
if (greedy.eggsAt.some((n) => n > 0)) L(` жадный: яиц к вершине горы 1…${greedy.eggsAt.length} — ${greedy.eggsAt.join(' / ')}`);
L(` жадный: кроссовки куплены на секундах цикла ${greedy.shoeBuys.map((t) => t.toFixed(0)).join(', ')}`);
{
  // The giant (docs/01-gdd.md 17.6): his zone is the last check of an open mountain; the bot sees him on the horizon from the camp.
  const races = greedy.walls.filter((w) => w.boss);
  if (races.length) L(` великан: ${races.slice(0, 3).map((w) => `гора ${w.mountain} — вход в зону на ${(w.sec - w.runSec).toFixed(0)} с горы (${min(w.total - w.runSec)} мин цикла), пробег зоны ${w.runSec.toFixed(1)} с, Скорость ${fmt(w.stat)}`).join('; ')}`);
}
L();
L('Итог по ступеням, жадный (мин):');
L(` ступень  wallScale  шаг      цикл   всего  горы                          питомцы  трейл  аура  Скорость у ${W.gen} ${lastWall}   (питомцы, трейл и аура — к концу цикла)`);
let acc = 0;
tiers.forEach((r, n) => {
  acc += r.sec;
  const c = cosmeticMults(pack, r.meta);
  L(
    ` ${String(n).padStart(7)}  ${fmt(wallScale(pack.balance, n)).padStart(9)}  ×${fmt(pack.balance.rebirth.stepMult ** n).padEnd(6)} ${min(r.sec).padStart(5)}  ${min(acc).padStart(5)}  ${r.mountains.map(min).join(' / ').padEnd(28)}  ×${petsOf(r).padEnd(6)}  ${`×${c.trail}`.padStart(5)}  ${`×${c.aura}`.padStart(4)}  ${fmt(r.walls.at(-1)?.stat ?? NaN)}`,
  );
});
if (ref) {
  const dev = greedy.walls.map((r) => (r.sec - ref.sec[r.p - 1]) / ref.sec[r.p - 1]);
  L();
  L(`Игра против столбца «Бот модели» (справочно): в ±10% — ${dev.filter((d) => Math.abs(d) <= 0.1).length} из ${dev.length} стен. Отличия игры от эталона: первая лавина гор 2–5 через firstIntervalSec (Q-022), дорожки округлены по ряду (01a 3)${existsSync(fitLog) ? ', стены и wallScale после --fit (ниже)' : ''}.`);
}
const table = (name, r) => {
  L();
  L(`Таблица «${W.one} → секунда, Скорость, кроссовки, питомцы, монеты» — ${name}, ступень 0:`);
  L(classic ? ' стена   с горы  с цикла  за стену  Скорость  кроссовки        питомцы  монеты   01a, с  откл.' : ' ворота  с горы  с цикла  за ворота Скорость  кроссовки        питомцы  монеты');
  for (const w of r.walls) {
    const s = ref?.sec[w.p - 1];
    const shoe = pack.balance.upgrade.tiers[w.shoe];
    const d = s ? `${Math.round(((w.sec - s) / s) * 100) || 0}%` : '';
    const row = ` ${`${w.mountain}-${String(w.wall).padStart(2, '0')}`.padEnd(6)} ${w.sec.toFixed(0).padStart(6)}  ${w.total.toFixed(0).padStart(7)}  ${w.took.toFixed(0).padStart(8)}  ${fmt(w.stat).padStart(8)}  ${`L${w.shoe} ×${fmt(shoe?.mult ?? 1)}`.padEnd(15)}  ×${w.petMult.toFixed(2).padEnd(6)}  ${fmt(w.coins).padStart(6)}  ${String(s ?? '').padStart(6)}  ${d.padStart(5)}`;
    L(classic ? row : row.trimEnd());
  }
};
table('жадный', greedy);
table('ленивый', lazy);
if (existsSync(fitLog)) {
  const log = JSON.parse(readFileSync(fitLog, 'utf8')).filter((r) => r.pack === packName && (r.pace ?? CLASSIC_PACE) === pace);
  L();
  L(
    classic
      ? `Подгонка sim:balance --fit (docs/01-gdd.md 8.5; не больше ${FIT_LIMIT} запусков на веху; 01a 3 и 9 переписываются под данные, эталон — в своих столбцах, Q-027):`
      : `Подгонка sim:balance --fit --pace=${pace} (docs/01-gdd.md 16.8; не больше ${FIT_LIMIT} запусков на веху; итоговые числа ворот — таблица выше, 01a 15):`,
  );
  for (const r of log) {
    if (r.aborted) {
      L(` ${r.date}, ${r.milestone}: запуск прерван (${r.aborted}); данные не изменились`);
      continue;
    }
    L(` ${r.date}, ${r.milestone}: ${classic ? 'стен' : 'ворот'} изменено ${r.walls.length}, wallScale — ${r.wallScale.length}; циклы ступеней 0–${TIERS} после подгонки: ${r.cycleMin.join(' / ')} мин`);
    for (const d of r.walls) L(`   ${W.one} ${d.p} (${where(d.p)}): ${fmt(d.from)} → ${fmt(d.to)}`);
    for (const d of r.wallScale) L(`   wallScale[${d.n}]: ${fmt(d.from)} → ${fmt(d.to)}`);
  }
}
const failed = [...checks.filter((c) => c.status === 'FAIL').map((c) => `проверка ${c.id}`), ...gates.filter((g) => !g.ok).map((g) => g.title.split(':')[0])];
L();
L(`Итог: ${checks.filter((c) => c.status === 'PASS').length} PASS, ${checks.filter((c) => c.status === 'FAIL').length} FAIL из ${checks.length}${classic ? `; требования M3-10 — ${gates.filter((g) => g.ok).length} из ${gates.length}` : ''}; ${((performance.now() - t0) / 1000).toFixed(2)} с`);

const text = lines.join('\n') + '\n';
if (packName === 'avalanche') {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
}
process.stdout.write(text);
if (failed.length) {
  console.error(`sim:balance${classic ? '' : ` (${pace})`}: FAIL — ${failed.join(', ')}`);
  process.exit(1);
}
