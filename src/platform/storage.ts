/**
 * The only localStorage wrapper in the game (docs/02-tech.md 4.4): every key gets the `<pack.id>:` prefix,
 * every call is guarded (private mode, quota, disabled storage never throw into the game).
 */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): boolean;
  remove(key: string): void;
  getJSON<T>(key: string): T | null;
  setJSON(key: string, value: unknown): boolean;
}

export function createStorage(prefix: string, backend?: Storage | null): KeyValueStore {
  const store = (): Storage | null => {
    if (backend !== undefined) return backend;
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  };
  const full = (key: string): string => `${prefix}:${key}`;
  return {
    get(key) {
      try {
        return store()?.getItem(full(key)) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        store()?.setItem(full(key), value);
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        store()?.removeItem(full(key));
      } catch {
        /* ignore */
      }
    },
    getJSON<T>(key: string): T | null {
      const raw = this.get(key);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },
    setJSON(key, value) {
      return this.set(key, JSON.stringify(value));
    },
  };
}
