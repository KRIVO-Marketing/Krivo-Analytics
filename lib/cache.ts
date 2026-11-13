// Cache leve em memória no cliente com deduplicação de requisições em voo e assinatura por chave.
type Entry<T> = {
  value?: T;
  promise?: Promise<T>;
  expiresAt: number;
};

const store = new Map<string, Entry<unknown>>();
const listeners = new Map<string, Set<() => void>>();
const DEFAULT_TTL_MS = 5 * 60_000;
const STORAGE_PREFIX = "krivo_cache:";

function shouldPersist(key: string): boolean {
  return key.startsWith("metrics:") || key.startsWith("contact:");
}

function readStorage<T>(key: string): Entry<T> | undefined {
  if (typeof window === "undefined" || !shouldPersist(key)) return undefined;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Entry<T>;
    if (!parsed || typeof parsed.expiresAt !== "number" || Date.now() > parsed.expiresAt) {
      window.sessionStorage.removeItem(STORAGE_PREFIX + key);
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function writeStorage<T>(key: string, entry: { value: T; expiresAt: number }) {
  if (typeof window === "undefined" || !shouldPersist(key)) return;
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
  } catch {
    /* quota ou modo privado */
  }
}

function deleteStorage(prefix?: string) {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k);
    }
    for (const k of keys) {
      const bare = k.slice(STORAGE_PREFIX.length);
      if (!prefix || bare === prefix || bare.startsWith(prefix)) {
        window.sessionStorage.removeItem(k);
      }
    }
  } catch {
    /* ignorar */
  }
}

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
  if (entry && entry.value !== undefined) {
    if (Date.now() <= entry.expiresAt) return entry.value;
    store.delete(key);
  }
  const persisted = readStorage<T>(key);
  if (persisted?.value !== undefined) {
    store.set(key, persisted);
    return persisted.value;
  }
  return undefined;
}

export function setCached<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): T {
  const entry = { value, expiresAt: Date.now() + ttlMs };
  store.set(key, entry);
  writeStorage(key, entry);
  notify(key);
  return value;
}

export function invalidateCache(prefix?: string) {
  deleteStorage(prefix);
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

  if (!options?.force) {
    const warm = getCached<T>(key);
    if (warm !== undefined) return Promise.resolve(warm);
  }
  if (!options?.force && existing?.promise) {
    return existing.promise;
  }

  const promise = fetcher()
    .then((value) => {
      const next = { value, expiresAt: Date.now() + ttlMs };
      store.set(key, next);
      writeStorage(key, next);
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
