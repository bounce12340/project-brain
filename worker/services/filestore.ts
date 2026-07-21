export interface FileStore {
  put(key: string, value: Blob, contentType: string): Promise<void>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string): Promise<void>;
}

export function r2FileStore(bucket: R2Bucket): FileStore {
  return {
    async put(key, value, contentType) { await bucket.put(key, value, { httpMetadata: { contentType } }); },
    async get(key) { return await bucket.get(key); },
    async delete(key) { await bucket.delete(key); },
  };
}
