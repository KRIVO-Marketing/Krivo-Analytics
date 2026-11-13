// Cache leve em memória no cliente com deduplicação de requisições em voo e assinatura por chave.
type Entry<T> = {
  value?: T;
  promise?: Promise<T>;
  expiresAt: number;
};

const store = new Map<string, Entry<unknown>>();
const listeners = new Map<string, Set<() => void>>();
const DEFAULT_TTL_MS = 5 * 60_000;

function notify(key: string) {
  listeners.get(key)?.forEach((fn) => fn());
}

export function subscribeCache(key: string, fn: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) listeners.delete(key);
  };
}

export function getCached<T>(key: string): T | undefined {
  const entry = store.get(key) as Entry<T> | undefined;
  if (!entry || entry.value === undefined) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

export function setCached<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): T {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  notify(key);
  return value;
}

export function invalidateCache(prefix?: string) {
  if (!prefix) {
    store.clear();
    for (const key of listeners.keys()) notify(key);
    return;
  }
  for (const k of [...store.keys()]) {
    if (k === prefix || k.startsWith(prefix)) {
      store.delete(k);
      notify(k);
    }
  }
}

export function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  options?: { ttlMs?: number; force?: boolean },
): Promise<T> {
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  const existing = store.get(key) as Entry<T> | undefined;

  if (!options?.force && existing?.value !== undefined && Date.now() <= existing.expiresAt) {
    return Promise.resolve(existing.value);
  }
  if (!options?.force && existing?.promise) {
    return existing.promise;
  }

  const promise = fetcher()
    .then((value) => {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      notify(key);
      return value;
    })
    .catch((err) => {
      const cur = store.get(key) as Entry<T> | undefined;
      if (cur?.promise === promise) {
        if (cur.value !== undefined) store.set(key, { value: cur.value, expiresAt: cur.expiresAt });
        else store.delete(key);
      }
      throw err;
    });

  store.set(key, {
    value: options?.force ? existing?.value : undefined,
    expiresAt: existing?.expiresAt ?? 0,
    promise,
  });
  return promise;
}
