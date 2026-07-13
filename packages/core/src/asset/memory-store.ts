/**
 * Functional in-memory `AssetStore` implementation.
 *
 * Asset refs are process-local `memory://asset/` URIs scoped to one store
 * instance. The store clones mutable byte content on write and read so tests
 * can assert ownership behavior without caller mutation leaking through
 * persistence.
 *
 * @module
 */

import { StorageError } from "../storage/errors";
import { assertExactFilter, assertValidKey } from "../storage/memory-utils";
import type {
  Asset,
  AssetInfo,
  AssetRef,
  AssetStore,
  DataAsset,
  ProviderFileAsset,
  StoredAsset,
  UrlAsset,
} from "./types";
import { assertValidAsset, normalizeMediaType } from "./validation";

let nextStoreNamespaceId = 0;

/**
 * Create an in-memory asset store for tests and local development.
 *
 * The store performs process-local persistence only. `put()` copies inline
 * byte arrays, records no metadata in returned assets, and never downloads URL
 * assets or talks to providers. Generated refs and caller-provided keys are
 * scoped to this factory call, so `get()` fails with `StorageError` when a ref
 * was created by another store.
 */
export function inMemoryAssetStore(): AssetStore {
  const assets = new Map<string, StoredAsset>();
  const storeNamespace = createStoreNamespace();
  let counter = 0;

  return Object.freeze({
    put: async (asset, options) => {
      if (options?.key !== undefined) assertValidKey(options.key);
      if (options?.metadata) assertExactFilter(options.metadata);
      assertValidAsset(asset);

      const ref = Object.freeze({
        uri: options?.key
          ? `memory://asset/${storeNamespace}/key/${encodeURIComponent(options.key)}`
          : `memory://asset/${storeNamespace}/generated/${nextId()}`,
      });
      const stored = projectStoredAsset(asset, ref);
      assets.set(ref.uri, stored);
      return cloneStoredAsset(stored);
    },
    get: async (ref) => {
      const stored = assets.get(ref.uri);
      if (!stored) {
        throw new StorageError(
          "not_found",
          "Asset not found for this store ref.",
        );
      }
      return cloneStoredAsset(stored);
    },
    delete: async (ref) => {
      assets.delete(ref.uri);
    },
  });

  function nextId(): number {
    counter += 1;
    return counter;
  }
}

/**
 * Return a process-local namespace for one in-memory store instance.
 *
 * Memory refs are opaque and only valid inside the current process, so a
 * monotonic module counter gives deterministic store ownership even when
 * Web Crypto is unavailable.
 */
function createStoreNamespace(): string {
  nextStoreNamespaceId += 1;
  return nextStoreNamespaceId.toString(36);
}

function projectStoredAsset(asset: Asset, ref: AssetRef): StoredAsset {
  switch (asset.type) {
    case "data":
      return freezeDataAsset({
        ...copyAssetInfo(asset),
        type: "data",
        data: cloneData(asset.data),
        mediaType: normalizeMediaType(asset.mediaType),
        ref,
      });
    case "url":
      return freezeUrlAsset({
        ...copyAssetInfo(asset),
        type: "url",
        url: new URL(asset.url.href),
        ...(asset.mediaType !== undefined
          ? { mediaType: normalizeMediaType(asset.mediaType) }
          : {}),
        ref,
      });
    case "provider-file":
      return freezeProviderFileAsset({
        ...copyAssetInfo(asset),
        type: "provider-file",
        provider: asset.provider.trim(),
        fileId: asset.fileId.trim(),
        ...(asset.mediaType !== undefined
          ? { mediaType: normalizeMediaType(asset.mediaType) }
          : {}),
        ref,
      });
  }
}

function cloneStoredAsset(asset: StoredAsset): StoredAsset {
  switch (asset.type) {
    case "data":
      return freezeDataAsset({
        ...copyAssetInfo(asset),
        type: "data",
        data: cloneData(asset.data),
        mediaType: asset.mediaType,
        ref: Object.freeze({ ...asset.ref }),
      });
    case "url":
      return freezeUrlAsset({
        ...copyAssetInfo(asset),
        type: "url",
        url: new URL(asset.url.href),
        ...(asset.mediaType !== undefined
          ? { mediaType: asset.mediaType }
          : {}),
        ref: Object.freeze({ ...asset.ref }),
      });
    case "provider-file":
      return freezeProviderFileAsset({
        ...copyAssetInfo(asset),
        type: "provider-file",
        provider: asset.provider,
        fileId: asset.fileId,
        ...(asset.mediaType !== undefined
          ? { mediaType: asset.mediaType }
          : {}),
        ref: Object.freeze({ ...asset.ref }),
      });
  }
}

function copyAssetInfo(asset: Asset): AssetInfo {
  return {
    ...(asset.filename !== undefined
      ? { filename: asset.filename.trim() }
      : {}),
    ...(asset.size !== undefined ? { size: asset.size } : {}),
    ...(asset.sha256 !== undefined ? { sha256: asset.sha256 } : {}),
    ...(asset.width !== undefined ? { width: asset.width } : {}),
    ...(asset.height !== undefined ? { height: asset.height } : {}),
    ...(asset.durationInSeconds !== undefined
      ? { durationInSeconds: asset.durationInSeconds }
      : {}),
    ...(asset.pageCount !== undefined ? { pageCount: asset.pageCount } : {}),
  };
}

function freezeDataAsset(
  asset: DataAsset & { readonly ref: AssetRef },
): StoredAsset {
  return Object.freeze(asset);
}

function freezeUrlAsset(
  asset: UrlAsset & { readonly ref: AssetRef },
): StoredAsset {
  return Object.freeze(asset);
}

function freezeProviderFileAsset(
  asset: ProviderFileAsset & { readonly ref: AssetRef },
): StoredAsset {
  return Object.freeze(asset);
}

function cloneData(data: Uint8Array | Blob): Uint8Array | Blob {
  return data instanceof Uint8Array ? new Uint8Array(data) : data;
}
