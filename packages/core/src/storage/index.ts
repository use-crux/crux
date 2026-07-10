/**
 * Canonical Storage Beta API for Crux.
 *
 * `RecordStore` is for JSON records, `VectorStore` is for dense/sparse/hybrid
 * search, and `AssetStore` is for optional media persistence. Use
 * {@link storage} to bundle capabilities for Crux primitives.
 *
 * @module
 */

export { StorageError } from "./errors";
export { storage } from "./bundle";
export {
  inMemoryRecordStore,
  inMemoryStorage,
  inMemoryVectorStore,
} from "./memory";
export { matchesExactFilter } from "./filter";
export { keySpace } from "./keyspace";
export { inMemoryAssetStore } from "../asset";
export type {
  Asset,
  AssetInfo,
  AssetPutOptions,
  AssetRef,
  AssetStore,
  DataAsset,
  ProviderFileAsset,
  StoredAsset,
  UrlAsset,
} from "../asset";

export type {
  DenseVectorSearchQuery,
  ExactFilter,
  FilterValue,
  HybridVectorSearchQuery,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  RecordEntry,
  RecordEvent,
  RecordListOptions,
  RecordPage,
  RecordStore,
  RecordStoreCapabilities,
  RecordWrite,
  RecordWriteOptions,
  SparseVector,
  SparseVectorSearchQuery,
  Storage,
  VectorHit,
  VectorRecord,
  VectorSearchQuery,
  VectorStore,
  VectorStoreCapabilities,
} from "./types";
export type { StorageErrorCode, StorageErrorOptions } from "./errors";
