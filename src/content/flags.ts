// What: Remote flags (docs/02-tech.md 11.11): their defaults from the paths of game.json.flags, and the values of getFlags applied to the pack, each kept inside its own range.
// Called by: main.ts (once at boot, around the one getFlags call); tests/content/flags.test.ts.
// Keep: Pure, no SDK; a value is applied only when it differs from the default sent; out of range — clamped with a warning, never an error; unknown or broken values are dropped.

/** A flag of game.json: the path of its value in the pack, its range or its list of values. */
export interface FlagDef {
  path: string;
  min?: number;
  max?: number;
  values?: string[];
}

/** The objects a flag path starts from: `game.…`, `balance.…`, `worlds.<index>.…`. */
export type FlagRoot = Record<string, unknown>;

function walk(root: FlagRoot, path: string): { obj: Record<string, unknown>; key: string } | null {
  const parts = path.split('.');
  let obj: unknown = root;
  for (const p of parts.slice(0, -1)) {
    if (obj === null || typeof obj !== 'object') return null;
    obj = (obj as Record<string, unknown>)[p];
  }
  if (obj === null || typeof obj !== 'object') return null;
  return { obj: obj as Record<string, unknown>, key: parts[parts.length - 1]! };
}

/** The defaults of every flag as text (getFlags takes and gives strings); a path that resolves to nothing is left out. */
export function flagDefaults(defs: Record<string, FlagDef>, root: FlagRoot): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, def] of Object.entries(defs)) {
    const at = walk(root, def.path);
    const v = at ? at.obj[at.key] : undefined;
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') out[name] = String(v);
  }
  return out;
}

/**
 * Applies the values of getFlags that differ from the defaults sent: a number kept in [min, max] (outside — clamped, with
 * a warning), a boolean «true»/«false», a text among `values`. Returns what was applied (name → value), for game_ready.
 * `skip` — flags applied elsewhere (the pace picks the pack before this).
 */
export function applyFlags(
  defs: Record<string, FlagDef>,
  values: Record<string, string>,
  defaults: Record<string, string>,
  root: FlagRoot,
  warn: (message: string) => void,
  skip: readonly string[] = [],
): Record<string, number | boolean | string> {
  const applied: Record<string, number | boolean | string> = {};
  for (const [name, def] of Object.entries(defs)) {
    const raw = values[name];
    if (skip.includes(name) || raw === undefined || raw === defaults[name]) continue;
    const at = walk(root, def.path);
    if (!at) continue;
    const cur = at.obj[at.key];
    if (typeof cur === 'number') {
      let n = Number(raw);
      if (!Number.isFinite(n)) {
        warn(`flag ${name}: «${raw}» is not a number, kept ${cur}`);
        continue;
      }
      if (def.min !== undefined && n < def.min) {
        warn(`flag ${name}: ${n} below ${def.min}, clamped`);
        n = def.min;
      }
      if (def.max !== undefined && n > def.max) {
        warn(`flag ${name}: ${n} above ${def.max}, clamped`);
        n = def.max;
      }
      at.obj[at.key] = n;
      applied[name] = n;
    } else if (typeof cur === 'boolean') {
      if (raw !== 'true' && raw !== 'false') {
        warn(`flag ${name}: «${raw}» is not true/false, kept ${cur}`);
        continue;
      }
      at.obj[at.key] = raw === 'true';
      applied[name] = raw === 'true';
    } else if (typeof cur === 'string') {
      if (def.values && !def.values.includes(raw)) {
        warn(`flag ${name}: «${raw}» not among its values, kept ${cur}`);
        continue;
      }
      at.obj[at.key] = raw;
      applied[name] = raw;
    }
  }
  return applied;
}
