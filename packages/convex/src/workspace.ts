/**
 * Convex asset storage helpers.
 *
 * Bridges `@use-crux/core/storage` data assets to Convex file storage while
 * leaving workspace metadata in a normal `RecordStore`.
 *
 * @module
 */

import { StorageError } from "@use-crux/core/storage";
import type {
  AssetStore,
  DataAsset,
  StoredAsset,
} from "@use-crux/core/storage";

interface ConvexStorageLike {
  store(content: Blob): Promise<string>;
  get?(storageId: string): Promise<Blob | null>;
  delete?(storageId: string): Promise<void>;
}

export interface ConvexAssetStoreConfig {
  readonly ctx: {
    readonly storage: ConvexStorageLike;
  };
}

/**
 * Create an `AssetStore` backed by Convex file storage.
 *
 * `put()` accepts data assets and performs Convex file-storage I/O. It rejects
 * URL and provider-file assets because this backend cannot hydrate them into
 * workspace-readable bytes without hidden network/provider calls. `get()`
 * requires a Convex runtime that exposes `ctx.storage.get`.
 *
 * Use this together with a Convex `RecordStore`:
 *
 * ```ts
 * import { storage } from '@use-crux/core/storage'
 * import { workspace } from '@use-crux/core/workspace'
 * import { convexAssetStore, convexRecordStore } from '@use-crux/convex'
 *
 * const ws = workspace({
 *   id: 'thread-workspace',
 *   namespace: threadId,
 *   storage: storage({
 *     records: convexRecordStore({ component: components.crux, ctx }),
 *     assets: convexAssetStore({ ctx }),
 *   }),
 * })
 * ```
 */
export function convexAssetStore(config: ConvexAssetStoreConfig): AssetStore {
  return Object.freeze({
    async put(asset, options): Promise<StoredAsset> {
      void options;
      if (asset.type !== "data") {
        throw new StorageError(
          "unsupported_capability",
          "convexAssetStore.put() supports data assets only.",
        );
      }
      const mediaType = assertDataAsset(asset);
      const blob = await toBlob(asset, mediaType);
      const storageId = await config.ctx.storage.store(blob);
      return {
        type: "data",
        data: blob,
        mediaType,
        size: asset.size ?? blob.size,
        ...(asset.filename !== undefined
          ? { filename: asset.filename.trim() }
          : {}),
        ...(asset.sha256 !== undefined ? { sha256: asset.sha256 } : {}),
        ...(asset.width !== undefined ? { width: asset.width } : {}),
        ...(asset.height !== undefined ? { height: asset.height } : {}),
        ...(asset.durationInSeconds !== undefined
          ? { durationInSeconds: asset.durationInSeconds }
          : {}),
        ...(asset.pageCount !== undefined
          ? { pageCount: asset.pageCount }
          : {}),
        ref: { uri: `convex://${storageId}` },
      };
    },

    async get(ref): Promise<StoredAsset> {
      const storageId = parseConvexUri(ref.uri);
      if (!config.ctx.storage.get) {
        throw new StorageError(
          "unsupported_capability",
          "convexAssetStore.get() requires ctx.storage.get, which is not available here.",
        );
      }
      const blob = await config.ctx.storage.get(storageId);
      if (!blob)
        throw new StorageError(
          "not_found",
          "Convex asset not found for this ref.",
        );
      return {
        type: "data",
        data: blob,
        mediaType: blob.type
          ? normalizeMediaType(blob.type)
          : "application/octet-stream",
        size: blob.size,
        ref,
      };
    },

    async delete(ref): Promise<void> {
      if (!config.ctx.storage.delete) return;
      await config.ctx.storage.delete(parseConvexUri(ref.uri));
    },
  });
}

function assertDataAsset(asset: DataAsset): string {
  const mediaType = normalizeMediaType(asset.mediaType);
  assertAssetInfo(asset);
  if (!(asset.data instanceof Uint8Array) && !isBlob(asset.data)) {
    throw new StorageError(
      "invalid_value",
      "Data asset content must be a Blob or Uint8Array.",
    );
  }
  if (isBlob(asset.data) && asset.data.type.trim().length > 0) {
    const blobMediaType = normalizeMediaType(asset.data.type);
    if (blobMediaType !== mediaType) {
      throw new StorageError(
        "invalid_value",
        "Data asset mediaType must match the Blob type.",
      );
    }
  }
  return mediaType;
}

function assertAssetInfo(asset: DataAsset): void {
  if (asset.filename !== undefined && asset.filename.trim().length === 0) {
    throw new StorageError(
      "invalid_value",
      "Asset filename must not be empty.",
    );
  }
  if (
    asset.size !== undefined &&
    (!Number.isFinite(asset.size) || asset.size < 0)
  ) {
    throw new StorageError(
      "invalid_value",
      "Asset size must be a finite non-negative number.",
    );
  }
  if (asset.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(asset.sha256)) {
    throw new StorageError(
      "invalid_value",
      "Asset sha256 must be a lowercase 64-character hexadecimal digest.",
    );
  }
  if (asset.width !== undefined && !isPositiveInteger(asset.width)) {
    throw new StorageError(
      "invalid_value",
      "Asset width must be a positive integer.",
    );
  }
  if (asset.height !== undefined && !isPositiveInteger(asset.height)) {
    throw new StorageError(
      "invalid_value",
      "Asset height must be a positive integer.",
    );
  }
  if (
    asset.durationInSeconds !== undefined &&
    (!Number.isFinite(asset.durationInSeconds) ||
      asset.durationInSeconds < 0)
  ) {
    throw new StorageError(
      "invalid_value",
      "Asset durationInSeconds must be a finite non-negative number.",
    );
  }
  if (asset.pageCount !== undefined && !isPositiveInteger(asset.pageCount)) {
    throw new StorageError(
      "invalid_value",
      "Asset pageCount must be a positive integer.",
    );
  }
}

async function toBlob(asset: DataAsset, mediaType: string): Promise<Blob> {
  if (asset.data instanceof Blob) {
    return new Blob([await asset.data.arrayBuffer()], { type: mediaType });
  }
  if (asset.data instanceof Uint8Array) {
    const buffer = new ArrayBuffer(asset.data.byteLength);
    new Uint8Array(buffer).set(asset.data);
    return new Blob([buffer], { type: mediaType });
  }
  throw new StorageError(
    "invalid_value",
    "Data asset content must be a Blob or Uint8Array.",
  );
}

function normalizeMediaType(mediaType: string): string {
  const essence = mediaType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(essence)) {
    throw new StorageError(
      "invalid_value",
      "Asset mediaType must be a valid MIME type essence.",
    );
  }
  return essence;
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== "undefined" && value instanceof Blob;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function parseConvexUri(uri: string): string {
  if (!uri.startsWith("convex://")) {
    throw new StorageError("invalid_key", "Expected a convex:// asset ref.");
  }
  const storageId = uri.slice("convex://".length).split("?", 1)[0] ?? "";
  if (!storageId)
    throw new StorageError(
      "invalid_key",
      "Convex asset ref is missing a storage id.",
    );
  return storageId;
}
