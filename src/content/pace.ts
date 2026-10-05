/**
 * Pace of the game (docs/01-gdd.md 16.1): `classic` plays the shared files of the pack; any other pace is the folder
 * content/<pack>/pace/<pace>/ with its own worlds.json and a balance.json patch over the shared one. Pure, no DOM:
 * the loader, gen:worlds and validate:content use the same functions.
 */
export const CLASSIC_PACE = 'classic';

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/**
 * Deep merge of a patch over a base (docs/01-gdd.md 16.1): objects merge key by key, arrays and plain values of the
 * patch replace the base ones whole. Neither input is changed; the result shares no objects with the patch.
 */
export function mergePatch<T>(base: T, patch: unknown): T {
  if (!isObj(base) || !isObj(patch)) return (patch === undefined ? base : clone(patch)) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = isObj(v) && isObj(out[k]) ? mergePatch(out[k], v) : clone(v);
  return out as T;
}

function clone(v: unknown): unknown {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as unknown);
}

/**
 * The pace of this run: `requested` (the ?pace= of a build with debug tools) when the pack has it, else the default
 * of game.json, else classic. `available` — the pace folders of the pack (classic is always there).
 */
export function choosePace(defaultPace: string | undefined, available: readonly string[], requested: string | null | undefined): string {
  const known = (p: string | null | undefined): p is string => !!p && (p === CLASSIC_PACE || available.includes(p));
  if (known(requested)) return requested;
  return known(defaultPace) ? defaultPace : CLASSIC_PACE;
}

/** Pace name from a file path of content/<pack>/pace/<pace>/<file> (keys of import.meta.glob, paths in scripts). */
export function paceOfPath(path: string): string | null {
  return /(?:^|\/)pace\/([^/]+)\/[^/]+$/.exec(path)?.[1] ?? null;
}
