/** Minimal Durable Object storage surface shared by storage and transactions. */
export interface CloudflareStoragePort {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string | string[]): Promise<boolean | number>;
  list<T>(options?: {
    prefix?: string;
    limit?: number;
  }): Promise<Map<string, T>>;
}

export function asStoragePort(
  storage: DurableObjectStorage | DurableObjectTransaction,
): CloudflareStoragePort {
  return storage as unknown as CloudflareStoragePort;
}

export function scopedKey(
  prefix: string,
  namespace: string,
  id: string,
): string {
  return `${prefix}:${encodeURIComponent(namespace)}:${encodeURIComponent(id)}`;
}

export function scopedPrefix(prefix: string, namespace: string): string {
  return `${prefix}:${encodeURIComponent(namespace)}:`;
}
