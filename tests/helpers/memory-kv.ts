/**
 * 記憶體版的 Workers KV，給 OAuth 流程的測試用。
 * 涵蓋 OAuth 套件用到的 get（text／json）、put（TTL 與 metadata）、delete、list（prefix、cursor）。
 */
interface Entry { value: string; expiresAt?: number; metadata?: unknown }

export function createMemoryKV(now: () => number = Date.now): KVNamespace {
  const store = new Map<string, Entry>();
  const alive = (key: string) => {
    const entry = store.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= now()) { store.delete(key); return undefined; }
    return entry;
  };
  const read = (entry: Entry | undefined, type?: string) => {
    if (!entry) return null;
    if (type === "json") return JSON.parse(entry.value);
    if (type === "arrayBuffer") return new TextEncoder().encode(entry.value).buffer;
    return entry.value;
  };
  const typeOf = (options: unknown) => typeof options === "string" ? options : (options as { type?: string } | undefined)?.type;
  const kv = {
    async get(key: string, options?: unknown) { return read(alive(key), typeOf(options)); },
    async getWithMetadata(key: string, options?: unknown) { const entry = alive(key); return { value: read(entry, typeOf(options)), metadata: entry?.metadata ?? null }; },
    async put(key: string, value: string | ArrayBuffer, options: { expiration?: number; expirationTtl?: number; metadata?: unknown } = {}) {
      const text = typeof value === "string" ? value : new TextDecoder().decode(value);
      const expiresAt = options.expirationTtl ? now() + options.expirationTtl * 1000 : options.expiration ? options.expiration * 1000 : undefined;
      store.set(key, { value: text, expiresAt, metadata: options.metadata });
    },
    async delete(key: string) { store.delete(key); },
    async list(options: { prefix?: string; limit?: number; cursor?: string } = {}) {
      const keys = [...store.keys()].filter((key) => key.startsWith(options.prefix ?? "") && alive(key)).sort();
      const start = options.cursor ? Number(options.cursor) : 0;
      const limit = options.limit ?? 1000;
      const page = keys.slice(start, start + limit);
      const done = start + limit >= keys.length;
      return {
        keys: page.map((name) => { const entry = store.get(name)!; return { name, ...(entry.expiresAt ? { expiration: Math.floor(entry.expiresAt / 1000) } : {}), ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}) }; }),
        list_complete: done, ...(done ? {} : { cursor: String(start + limit) }), cacheStatus: null,
      };
    },
  };
  return kv as unknown as KVNamespace;
}
