import type {
  AssetStore,
  JsonObject,
  RecordStore,
  StoredAsset,
} from "@use-crux/core";

export function fakeRecordStore(
  operations: string[],
  options: { readonly failPut?: boolean } = {},
): RecordStore {
  const records = new Map<string, JsonObject>();
  return {
    _tag: "RecordStore",
    get: async (key) => records.get(key) ?? null,
    put: async (key, value) => {
      operations.push(`record.put:${key}`);
      if (options.failPut) throw new Error("record put failed");
      records.set(key, value);
    },
    create: async (key, value) => {
      if (records.has(key)) return false;
      records.set(key, value);
      return true;
    },
    delete: async (key) => {
      records.delete(key);
    },
    list: async () => ({ entries: [] }),
    capabilities: () => ({
      ttl: false,
      filter: false,
      watch: false,
      batch: false,
    }),
  };
}

export function fakeAssetStore(
  operations: string[],
  options: { readonly failPutOn?: number } = {},
): AssetStore {
  const assets = new Map<string, StoredAsset>();
  let puts = 0;
  return {
    put: async (asset) => {
      puts += 1;
      operations.push(`asset.put:${asset.mediaType ?? "none"}`);
      if (options.failPutOn === puts) throw new Error("asset put failed");
      const stored = {
        ...asset,
        ref: { uri: `memory://asset/stored/${puts}` },
      } as StoredAsset;
      assets.set(stored.ref.uri, stored);
      return stored;
    },
    get: async (ref) => {
      const stored = assets.get(ref.uri);
      if (!stored) throw new Error("not found");
      return stored;
    },
    delete: async (ref) => {
      operations.push(`asset.delete:${ref.uri}`);
      assets.delete(ref.uri);
    },
  };
}
