/**
 * Storage bundle helpers.
 *
 * @module
 */

import type { AssetPutOptions, AssetStore } from "../asset";
import type { RecordStore, Storage, VectorStore } from "./types";

/** Factory for normalizing storage bundles and scoped wrappers. */
export interface StorageFactory {
  /**
   * Normalize and shallow-freeze a storage capability bundle.
   *
   * @param config - Explicit storage capabilities.
   * @returns A shallow-frozen storage bundle.
   */
  (config: Storage): Storage;

  /**
   * Prefix storage keys for tenant, user, session, or workspace namespaces.
   *
   * This is deterministic key namespacing, not an authorization boundary.
   * Asset refs remain opaque bearer references owned by the underlying
   * `AssetStore`; scoped asset views prefix only `AssetPutOptions.key` and pass
   * `get()`/`delete()` refs through unchanged.
   *
   * @param base - Storage bundle to scope.
   * @param prefix - Prefix applied to record, vector, and asset keys.
   * @returns A shallow-frozen scoped storage bundle.
   */
  scope(base: Storage, prefix: string): Storage;
}

/** Normalize and shallow-freeze a storage capability bundle. */
export const storage: StorageFactory = Object.assign(createStorage, {
  scope,
});

function createStorage(config: Storage): Storage {
  return Object.freeze({ ...config });
}

function scope(base: Storage, prefix: string): Storage {
  const normalizedPrefix = prefix.endsWith(":") ? prefix : `${prefix}:`;
  return storage({
    records: scopeRecords(base.records, normalizedPrefix),
    ...(base.vectors
      ? { vectors: scopeVectors(base.vectors, normalizedPrefix) }
      : {}),
    ...(base.assets
      ? { assets: scopeAssets(base.assets, normalizedPrefix) }
      : {}),
  });
}

function scopeRecords(records: RecordStore, prefix: string): RecordStore {
  return {
    _tag: "RecordStore",
    get: (key) => records.get(prefixKey(prefix, key)),
    getMany: records.getMany
      ? (keys) => records.getMany!(keys.map((key) => prefixKey(prefix, key)))
      : undefined,
    put: (key, value, options) =>
      records.put(prefixKey(prefix, key), value, options),
    putMany: records.putMany
      ? (entries) =>
          records.putMany!(
            entries.map((entry) => ({
              ...entry,
              key: prefixKey(prefix, entry.key),
            })),
          )
      : undefined,
    create: (key, value, options) =>
      records.create(prefixKey(prefix, key), value, options),
    delete: (key) => records.delete(prefixKey(prefix, key)),
    deleteMany: records.deleteMany
      ? (keys) => records.deleteMany!(keys.map((key) => prefixKey(prefix, key)))
      : undefined,
    list: async (listPrefix, options) => {
      const page = await records.list(prefixKey(prefix, listPrefix), options);
      return {
        ...page,
        entries: page.entries.map((entry) => ({
          ...entry,
          key: unprefixKey(prefix, entry.key),
        })),
      };
    },
    scan: records.scan
      ? async function* (scanPrefix, options) {
          for await (const entry of records.scan!(
            prefixKey(prefix, scanPrefix),
            options,
          )) {
            yield {
              ...entry,
              key: unprefixKey(prefix, entry.key),
            };
          }
        }
      : undefined,
    watch: records.watch
      ? (watchPrefix, callback) =>
          records.watch!(prefixKey(prefix, watchPrefix), (event) =>
            callback({
              ...event,
              key: unprefixKey(prefix, event.key),
            }),
          )
      : undefined,
    capabilities: () => records.capabilities(),
  };
}

function scopeVectors(vectors: VectorStore, prefix: string): VectorStore {
  return {
    _tag: "VectorStore",
    upsert: (records) =>
      vectors.upsert(
        records.map((record) => ({
          ...record,
          key: prefixKey(prefix, record.key),
        })),
      ),
    delete: (keys) => vectors.delete(keys.map((key) => prefixKey(prefix, key))),
    search: async (query) =>
      (await vectors.search(query)).map((hit) => ({
        ...hit,
        key: unprefixKey(prefix, hit.key),
      })),
    capabilities: () => vectors.capabilities(),
  };
}

function scopeAssets(assets: AssetStore, prefix: string): AssetStore {
  return Object.freeze({
    put: (asset, options) =>
      assets.put(asset, scopeAssetPutOptions(prefix, options)),
    get: (ref) => assets.get(ref),
    delete: (ref) => assets.delete(ref),
  });
}

function scopeAssetPutOptions(
  prefix: string,
  options: AssetPutOptions | undefined,
): AssetPutOptions | undefined {
  if (!options) return undefined;
  return {
    ...options,
    ...(options.key ? { key: prefixKey(prefix, options.key) } : {}),
  };
}

function prefixKey(prefix: string, key: string): string {
  return key.startsWith(prefix) ? key : `${prefix}${key}`;
}

function unprefixKey(prefix: string, key: string): string {
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}
