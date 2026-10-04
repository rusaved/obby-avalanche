/** Typed event bus (docs/02-tech.md 4.6). No dependencies, works in Node. */
export type Listener<T> = (payload: T) => void;

export interface Emitter<E extends Record<string, unknown>> {
  on<K extends keyof E>(name: K, fn: Listener<E[K]>): () => void;
  once<K extends keyof E>(name: K, fn: Listener<E[K]>): () => void;
  off<K extends keyof E>(name: K, fn: Listener<E[K]>): void;
  emit<K extends keyof E>(name: K, payload: E[K]): void;
  clear(): void;
}

export function createEmitter<E extends Record<string, unknown>>(): Emitter<E> {
  const map = new Map<keyof E, Set<Listener<never>>>();
  const listeners = <K extends keyof E>(name: K): Set<Listener<E[K]>> => {
    let set = map.get(name) as Set<Listener<E[K]>> | undefined;
    if (!set) {
      set = new Set();
      map.set(name, set as Set<Listener<never>>);
    }
    return set;
  };
  const off: Emitter<E>['off'] = (name, fn) => {
    map.get(name)?.delete(fn as Listener<never>);
  };
  return {
    on(name, fn) {
      listeners(name).add(fn);
      return () => off(name, fn);
    },
    once(name, fn) {
      const wrapped: Listener<E[typeof name]> = (payload) => {
        off(name, wrapped);
        fn(payload);
      };
      return this.on(name, wrapped);
    },
    off,
    emit(name, payload) {
      const set = map.get(name);
      if (!set || set.size === 0) return;
      for (const fn of Array.from(set)) (fn as Listener<E[typeof name]>)(payload);
    },
    clear() {
      map.clear();
    },
  };
}
