/**
 * A save per pace (docs/01-gdd.md 16.1): one player, the progress of each pace apart. The classic save stays where it
 * always was — the root of the cloud data and the mirror key `save` — so the saves made before the paces stay classic.
 * Any other pace (`slot`) lives under `paces.<slot>` of the cloud data and in the mirror key `save.<slot>`. A write
 * of one pace carries the other paces' data as it was loaded, untouched.
 */
const PACES = 'paces';

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** Mirror key (localStorage under the `<pack.id>:` prefix) of the save of `slot`; no slot — classic. */
export function mirrorKey(slot?: string | undefined): string {
  return slot ? `save.${slot}` : 'save';
}

/** Cloud data → the save of `slot` (raw, for parseSave) and the rest to keep on every write. */
export function splitCloud(raw: unknown, slot?: string | undefined): { mine: unknown; rest: Record<string, unknown> } {
  const data = isObj(raw) ? raw : {};
  const paces = isObj(data[PACES]) ? data[PACES] : {};
  if (!slot) {
    const { [PACES]: _paces, ...mine } = data;
    return { mine, rest: Object.keys(paces).length ? { [PACES]: paces } : {} };
  }
  const { [slot]: mine, ...others } = paces;
  const { [PACES]: _all, ...root } = data;
  return { mine: mine ?? null, rest: Object.keys(others).length ? { ...root, [PACES]: others } : root };
}

/** The save of `slot` with the rest of the cloud data: what goes to player.setData. */
export function joinCloud(rest: Record<string, unknown>, save: object, slot?: string | undefined): Record<string, unknown> {
  const paces = isObj(rest[PACES]) ? rest[PACES] : {};
  if (!slot) return Object.keys(paces).length ? { ...save, [PACES]: paces } : (save as Record<string, unknown>);
  return { ...rest, [PACES]: { ...paces, [slot]: save } };
}
