import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Architecture rules (docs/02-tech.md 4.1, 5.1, 16.3 p.7; CLAUDE.md hard rules 1–2):
 * sim/level/meta/core without DOM, render, ui, platform, audio; from three only the named whitelist;
 * no Math.random in sim and meta; no Cyrillic in src outside comments; no stop-list words in sources.
 */
const root = resolve(__dirname, '..');

export function walk(dir: string, filter: (p: string) => boolean, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, filter, acc);
    else if (filter(p)) acc.push(p);
  }
  return acc;
}

const tsFiles = (dir: string): string[] => walk(resolve(root, dir), (p) => p.endsWith('.ts') && !p.endsWith('.d.ts'));

/** Strips line and block comments but keeps string literals (good enough for our own code). */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i] as string;
    const next = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i++;
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const THREE_WHITELIST = new Set([
  'Vector3', 'Vector2', 'Quaternion', 'Euler', 'Matrix4', 'Box3', 'Sphere', 'Ray', 'Plane', 'Triangle', 'Line3', 'MathUtils',
]);
const THREE_ADDONS = new Set(['three/examples/jsm/math/Capsule.js', 'three/examples/jsm/math/Octree.js']);
const PURE_LAYERS = ['src/sim', 'src/level', 'src/meta', 'src/core'];
const FORBIDDEN_LAYER_IMPORTS = ['/render/', '/ui/', '/platform/', '/audio/', '/debug/', '/studio/', '/test-api/', '/analytics/'];

function imports(src: string): Array<{ spec: string; names: string[]; star: boolean; def: boolean }> {
  const out: Array<{ spec: string; names: string[]; star: boolean; def: boolean }> = [];
  const re = /import\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(re)) {
    const clause = (m[2] ?? '').trim();
    const spec = m[3] as string;
    const star = /\*\s+as\s+/.test(clause);
    const named = clause.match(/\{([^}]*)\}/);
    const names = named ? (named[1] ?? '').split(',').map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0] as string).filter(Boolean) : [];
    const def = !!clause && !star && !clause.startsWith('{');
    out.push({ spec, names, star, def });
  }
  for (const m of src.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push({ spec: m[1] as string, names: [], star: false, def: false });
  return out;
}

export function checkLayerFile(file: string, src: string): string[] {
  const problems: string[] = [];
  const rel = relative(root, file);
  for (const imp of imports(src)) {
    if (imp.spec === 'three') {
      if (imp.star || imp.def) problems.push(`${rel}: import * / default from three is forbidden`);
      for (const n of imp.names) if (!THREE_WHITELIST.has(n)) problems.push(`${rel}: "${n}" from three is not in the whitelist`);
    } else if (imp.spec.startsWith('three/')) {
      if (!THREE_ADDONS.has(imp.spec)) problems.push(`${rel}: "${imp.spec}" is not an allowed three addon`);
    } else if (imp.spec.startsWith('.')) {
      const target = resolve(file, '..', imp.spec);
      for (const bad of FORBIDDEN_LAYER_IMPORTS) if (target.includes(bad)) problems.push(`${rel}: imports ${imp.spec} (${bad.replaceAll('/', '')} layer)`);
    } else if (imp.spec === 'valibot') {
      /* schemas live in level/validate.ts and are used only by scripts and tests */
    } else if (!imp.spec.startsWith('node:')) {
      problems.push(`${rel}: external import "${imp.spec}"`);
    }
  }
  if (/\b(document|window|navigator|localStorage|HTMLElement|requestAnimationFrame)\b/.test(stripComments(src))) problems.push(`${rel}: references the DOM`);
  return problems;
}

export function checkRandom(file: string, src: string): string[] {
  return /Math\.random\s*\(/.test(src) ? [`${relative(root, file)}: Math.random is forbidden here (seeded rng only)`] : [];
}

export function checkCyrillic(file: string, src: string): string[] {
  const code = stripComments(src);
  const m = code.match(/[Ѐ-ӿ]/);
  return m ? [`${relative(root, file)}: Cyrillic outside comments ("${code.slice(Math.max(0, m.index! - 20), m.index! + 20).replace(/\n/g, ' ')}")`] : [];
}

const stop = JSON.parse(readFileSync(resolve(root, 'scripts/stopwords.json'), 'utf8')) as { brands: string[]; onlineWords: string[] };
const esc = (w: string): string => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function checkStopwords(file: string, src: string, words: string[]): string[] {
  const problems: string[] = [];
  for (const w of words) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}_])${esc(w)}(?=$|[^\\p{L}\\p{N}_])`, 'iu');
    if (re.test(src)) problems.push(`${relative(root, file)}: contains stop-list word #${words.indexOf(w)} (${w.length} letters)`);
  }
  return problems;
}

describe('architecture', () => {
  it('sim, level, meta, core: no DOM, render, ui, platform, audio; three only by the whitelist', () => {
    const problems: string[] = [];
    for (const layer of PURE_LAYERS) {
      let files: string[] = [];
      try {
        files = tsFiles(layer);
      } catch {
        continue;
      }
      for (const f of files) problems.push(...checkLayerFile(f, readFileSync(f, 'utf8')));
    }
    expect(problems).toEqual([]);
  });

  it('no Math.random in sim and meta', () => {
    const problems: string[] = [];
    for (const layer of ['src/sim', 'src/meta']) {
      let files: string[] = [];
      try {
        files = tsFiles(layer);
      } catch {
        continue;
      }
      for (const f of files) problems.push(...checkRandom(f, readFileSync(f, 'utf8')));
    }
    expect(problems).toEqual([]);
  });

  it('no Cyrillic in src/**/*.ts outside comments (texts live in content/<pack>/i18n)', () => {
    const problems: string[] = [];
    for (const f of tsFiles('src')) problems.push(...checkCyrillic(f, readFileSync(f, 'utf8')));
    expect(problems).toEqual([]);
  });

  it('no stop-list words (brands, online) in src/**, content/**, index.html, scripts/** except the list itself', () => {
    const words = [...stop.brands, ...stop.onlineWords];
    const files = [
      ...walk(resolve(root, 'src'), () => true),
      ...walk(resolve(root, 'content'), () => true),
      resolve(root, 'index.html'),
      ...walk(resolve(root, 'scripts'), (p) => !p.endsWith('stopwords.json')),
    ];
    const problems: string[] = [];
    for (const f of files) problems.push(...checkStopwords(f, readFileSync(f, 'utf8'), words));
    expect(problems).toEqual([]);
  });

  // M2-13: thresholds of the stat flash live only in balance.json (ui.statMilestones), never as literals in code.
  it('no round-number thresholds in code that handles stat milestones', () => {
    const problems: string[] = [];
    for (const f of tsFiles('src')) {
      const rel = relative(root, f);
      const code = stripComments(readFileSync(f, 'utf8'));
      // No list of powers of ten anywhere in the code (1e3 … 1e30, or 1000, 10000 in a row).
      if (/(?<![\w.])1e(?:[3-9]|[12]\d|30)(?![\w.])/i.test(code) || /1_?000\s*,\s*10_?000/.test(code)) problems.push(`${rel}: list of round numbers`);
      // The milestone logic itself (sim, app, ui) has no number of that size at all.
      if (!/^src\/(sim|app|ui)\//.test(rel.replace(/\\/g, '/')) || !/milestone/i.test(code)) continue;
      for (const m of code.matchAll(/(?<![\w.])(\d[\d_]*(?:\.\d+)?(?:e\d+)?)(?![\w.])/gi)) {
        const n = Number((m[1] ?? '').replace(/_/g, ''));
        if (n >= 1000) problems.push(`${rel}: number ${m[1]} in milestone code`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('the checks themselves catch violations', () => {
    expect(checkLayerFile(resolve(root, 'src/sim/x.ts'), "import * as THREE from 'three';")).toHaveLength(1);
    expect(checkLayerFile(resolve(root, 'src/sim/x.ts'), "import { Mesh } from 'three';")).toHaveLength(1);
    expect(checkLayerFile(resolve(root, 'src/sim/x.ts'), "import { Vector3 } from 'three';")).toHaveLength(0);
    expect(checkLayerFile(resolve(root, 'src/sim/x.ts'), "import { a } from '../render/a.ts';")).toHaveLength(1);
    expect(checkLayerFile(resolve(root, 'src/sim/x.ts'), 'const w = window.innerWidth;')).toHaveLength(1);
    expect(checkRandom('x.ts', 'const r = Math.random();')).toHaveLength(1);
    expect(checkCyrillic('x.ts', 'const s = "Привет";')).toHaveLength(1);
    expect(checkCyrillic('x.ts', '// Привет\nconst s = "hi";')).toHaveLength(0);
    expect(checkStopwords('x.ts', 'const s = "' + ['Ro', 'blox'].join('') + '";', stop.brands)).toHaveLength(1);
    expect(checkStopwords('x.ts', 'const s = "snow";', stop.brands)).toHaveLength(0);
  });
});
