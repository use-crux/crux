/**
 * Canonical Storage Beta API for Crux.
 *
 * `RecordStore` is for JSON records, `SearchStore` is for retrieval-index
 * search, and `AssetStore` is for optional media persistence. Use
 * {@link storage} to bundle capabilities for Crux primitives.
 *
 * @module
 */

export { StorageError } from "./errors";
export { storage } from "./bundle";
export { mutateRecord } from "./mutate";
export { searchStoreCapabilities } from "./capabilities";
export {
  inMemoryRecordStore,
  inMemoryStorage,
  inMemorySearchStore,
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
  ExactFilter,
  FilterValue,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  RecordEntry,
  RecordEvent,
  RecordListOptions,
  RecordMutation,
  RecordPage,
  RecordStore,
  RecordStoreCapabilities,
  RecordWrite,
  RecordWriteOptions,
  SearchFusion,
  SearchHit,
  SearchLeg,
  SearchLegKind,
  SearchLegMatch,
  SearchQuery,
  SearchRecord,
  SearchStore,
  SearchStoreCapabilities,
  SearchStoreCapabilityConfig,
  SparseVector,
  Storage,
  StorageSetupFinding,
  StorageSetupPort,
  StorageSetupResult,
} from "./types";
export type { StorageErrorCode, StorageErrorOptions } from "./errors";
export type { MutateRecordOptions } from "./mutate";
