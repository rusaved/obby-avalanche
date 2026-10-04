/** Texts come only from content/<pack>/i18n/<lang>.json (docs/02-tech.md 12). Loaded before any UI shows. */
export type Dict = Record<string, string>;

let dict: Dict = {};
let current = 'ru';

export function setDictionary(lang: string, d: Dict): void {
  current = lang;
  dict = d;
}

export function currentLang(): string {
  return current;
}

export function hasKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(dict, key);
}

/** t('hud.perStep', { n: '7' }) → "+7 за шаг". Unknown key returns the key itself (visible in tests). */
export function t(key: string, params?: Record<string, string | number>): string {
  let s = dict[key];
  if (s === undefined) return key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

export async function loadDictionary(url: string): Promise<Dict> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`i18n: ${url} → ${res.status}`);
  return (await res.json()) as Dict;
}
