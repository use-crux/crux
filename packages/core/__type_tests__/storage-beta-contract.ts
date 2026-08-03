/**
 * Type-level contract for the canonical Storage Beta API.
 *
 * Runs under `tsc --noEmit`; `expectTypeOf` assertions and
 * `@ts-expect-error` markers carry the public API contract.
 */

import { expectTypeOf } from "vitest";
import * as CoreExports from "../src";
import * as StorageExports from "../src/storage";
import * as WorkspaceExports from "../src/workspace";
import { storage, StorageError } from "../src/storage";
import type {
  IndexedStorageCapabilities,
  StorageFacts as IndexedStorageFacts,
} from "../src/project-index";
import type {
  AssetStore,
  ExactFilter,
  JsonObject,
  RecordEntry,
  RecordStore,
  Storage,
  StorageErrorCode,
  StorageSetupPort,
  StorageSetupResult,
  VectorRecord,
  VectorSearchQuery,
} from "../src/storage";
import { workspace } from "../src/workspace";
import type { WorkspaceConfig } from "../src/workspace";

interface DocumentRecord extends JsonObject {
  readonly title: string;
  readonly count: number;
  readonly nested: {
    readonly ok: boolean;
  };
}

declare const records: RecordStore<DocumentRecord>;

expectTypeOf(
  records.get("docs:a"),
).resolves.toEqualTypeOf<DocumentRecord | null>();
expectTypeOf(records.list("docs:")).resolves.toEqualTypeOf<{
  readonly entries: readonly RecordEntry<DocumentRecord>[];
  readonly cursor?: string;
}>();

if (records.scan) {
  expectTypeOf(records.scan("docs:")).toEqualTypeOf<
    AsyncIterable<RecordEntry<DocumentRecord>>
  >();
}

records.put("docs:a", {
  title: "Alpha",
  count: 1,
  nested: { ok: true },
});
records.put(
  "docs:b",
  { title: "Beta", count: 2, nested: { ok: false } },
  { ttlMs: 1_000 },
);
records.put(
  "docs:c",
  { title: "Gamma", count: 3, nested: { ok: true } },
  // @ts-expect-error — `ttlMs` is the only public TTL option.
  { ttl: 1_000 },
);

// @ts-expect-error — record values must be JSON, not Date/function/class-instance shapes.
declare const badRecords: RecordStore<{ readonly createdAt: Date }>;
void badRecords;

const exactFilter: ExactFilter = {
  status: "ready",
  attempts: 2,
  archived: false,
  parent: null,
};
void exactFilter;

// @ts-expect-error — filters only allow exact top-level scalar JSON values.
const badFilter: ExactFilter = { tags: ["ready"] };
void badFilter;

const denseQuery: VectorSearchQuery = {
  mode: "dense",
  dense: [1, 0],
  filter: { status: "ready" },
};
const sparseQuery: VectorSearchQuery = {
  mode: "sparse",
  sparse: { indices: [0], values: [1] },
};
const hybridQuery: VectorSearchQuery = {
  mode: "hybrid",
  dense: [1, 0],
  sparse: { indices: [0], values: [1] },
  fusion: "rrf",
};
void denseQuery;
void sparseQuery;
void hybridQuery;

// @ts-expect-error — dense queries cannot carry sparse vectors.
const invalidDenseQuery: VectorSearchQuery = {
  mode: "dense",
  dense: [1],
  sparse: { indices: [0], values: [1] },
};
void invalidDenseQuery;

// @ts-expect-error — sparse queries cannot carry dense vectors.
const invalidSparseQuery: VectorSearchQuery = {
  mode: "sparse",
  sparse: { indices: [0], values: [1] },
  dense: [1],
};
void invalidSparseQuery;

// @ts-expect-error — hybrid queries require both dense and sparse vectors.
const invalidHybridQuery: VectorSearchQuery = { mode: "hybrid", dense: [1] };
void invalidHybridQuery;

const vectorRecord: VectorRecord = {
  key: "docs:a",
  dense: [1, 0],
  metadata: { status: "ready", archived: false },
};
void vectorRecord;

const badVectorRecord: VectorRecord = {
  key: "docs:b",
  dense: [1, 0],
  // @ts-expect-error — vector metadata uses exact scalar filters, not nested objects.
  metadata: { nested: { ok: true } },
};
void badVectorRecord;

declare const assets: AssetStore;
declare const setup: StorageSetupPort;
const bundle = storage({ records, assets, setup, close: async () => undefined });

expectTypeOf(bundle).toEqualTypeOf<Storage>();
expectTypeOf(bundle.records).toEqualTypeOf<RecordStore>();
expectTypeOf(bundle.assets).toEqualTypeOf<AssetStore | undefined>();
expectTypeOf(bundle.setup).toEqualTypeOf<StorageSetupPort | undefined>();
expectTypeOf(bundle.close).toEqualTypeOf<(() => Promise<void>) | undefined>();
expectTypeOf(Object.isFrozen(bundle)).toEqualTypeOf<boolean>();

expectTypeOf(setup.check()).resolves.toEqualTypeOf<StorageSetupResult>();
expectTypeOf(setup.apply()).resolves.toEqualTypeOf<StorageSetupResult>();

// @ts-expect-error — canonical storage bundles require `records`.
storage({});
// @ts-expect-error — canonical storage bundles reject unknown storage fields.
storage({ records, extraRecords: records });
// @ts-expect-error — `Storage.blobs` was removed; use `Storage.assets`.
type RemovedStorageBlobs = Storage["blobs"];
// @ts-expect-error — `storage({ blobs })` was removed; use `storage({ assets })`.
storage({ records, blobs: assets });

// @ts-expect-error — AssetStore signing/streaming details are not public Project Index capabilities.
type RemovedIndexedAssetCapabilities = IndexedStorageCapabilities["asset"];
declare const indexedStorageFacts: IndexedStorageFacts;
expectTypeOf(indexedStorageFacts.assets).toEqualTypeOf<string | undefined>();

type CoreValueExports = typeof CoreExports;
type StorageValueExports = typeof StorageExports;
type WorkspaceValueExports = typeof WorkspaceExports;

// @ts-expect-error — BlobStore is not exported from the root API.
type RemovedCoreBlobStore = CoreExports.BlobStore;
// @ts-expect-error — BlobRef is not exported from the root API.
type RemovedCoreBlobRef = CoreExports.BlobRef;
// @ts-expect-error — BlobPutInput is not exported from the root API.
type RemovedCoreBlobPutInput = CoreExports.BlobPutInput;
// @ts-expect-error — BlobReadResult is not exported from the root API.
type RemovedCoreBlobReadResult = CoreExports.BlobReadResult;
// @ts-expect-error — BlobStoreCapabilities is not exported from the root API.
type RemovedCoreBlobStoreCapabilities = CoreExports.BlobStoreCapabilities;
// @ts-expect-error — inMemoryBlobStore was removed; use inMemoryAssetStore.
type RemovedCoreInMemoryBlobStore = CoreValueExports["inMemoryBlobStore"];
// @ts-expect-error — memoryWorkspaceBlobStore was removed with workspace blob storage.
type RemovedCoreMemoryWorkspaceBlobStore = CoreValueExports["memoryWorkspaceBlobStore"];
// @ts-expect-error — WorkspaceBlobStore is not exported from the root API.
type RemovedCoreWorkspaceBlobStore = CoreExports.WorkspaceBlobStore;
// @ts-expect-error — WorkspaceBlobRef is not exported from the root API.
type RemovedCoreWorkspaceBlobRef = CoreExports.WorkspaceBlobRef;
// @ts-expect-error — WorkspaceBlobReadResult is not exported from the root API.
type RemovedCoreWorkspaceBlobReadResult = CoreExports.WorkspaceBlobReadResult;

// @ts-expect-error — BlobStore is not exported from @use-crux/core/storage.
type RemovedStorageBlobStore = StorageExports.BlobStore;
// @ts-expect-error — BlobRef is not exported from @use-crux/core/storage.
type RemovedStorageBlobRef = StorageExports.BlobRef;
// @ts-expect-error — BlobPutInput is not exported from @use-crux/core/storage.
type RemovedStorageBlobPutInput = StorageExports.BlobPutInput;
// @ts-expect-error — BlobReadResult is not exported from @use-crux/core/storage.
type RemovedStorageBlobReadResult = StorageExports.BlobReadResult;
// @ts-expect-error — BlobStoreCapabilities is not exported from @use-crux/core/storage.
type RemovedStorageBlobStoreCapabilities = StorageExports.BlobStoreCapabilities;
// @ts-expect-error — inMemoryBlobStore was removed from @use-crux/core/storage.
type RemovedStorageInMemoryBlobStore = StorageValueExports["inMemoryBlobStore"];
// @ts-expect-error — memoryWorkspaceBlobStore was removed from @use-crux/core/storage.
type RemovedStorageMemoryWorkspaceBlobStore = StorageValueExports["memoryWorkspaceBlobStore"];

// @ts-expect-error — WorkspaceConfig.blobs was removed; use assets/storage.assets.
type RemovedWorkspaceConfigBlobs = WorkspaceConfig["blobs"];
// @ts-expect-error — workspace({ blobs }) was removed; use workspace({ assets }).
const removedWorkspaceBlobsConfig = { id: "docs", namespace: "docs", records, blobs: assets } satisfies WorkspaceConfig;
void removedWorkspaceBlobsConfig;
// @ts-expect-error — WorkspaceBlobStore is not exported from @use-crux/core/workspace.
type RemovedWorkspaceBlobStore = WorkspaceExports.WorkspaceBlobStore;
// @ts-expect-error — WorkspaceBlobRef is not exported from @use-crux/core/workspace.
type RemovedWorkspaceBlobRef = WorkspaceExports.WorkspaceBlobRef;
// @ts-expect-error — WorkspaceBlobReadResult is not exported from @use-crux/core/workspace.
type RemovedWorkspaceBlobReadResult = WorkspaceExports.WorkspaceBlobReadResult;
// @ts-expect-error — memoryWorkspaceBlobStore was removed from @use-crux/core/workspace.
type RemovedWorkspaceMemoryWorkspaceBlobStore = WorkspaceValueExports["memoryWorkspaceBlobStore"];

const error = new StorageError("invalid_filter", "Unsupported filter value", {
  cause: new Error("provider"),
});
expectTypeOf(error.code).toEqualTypeOf<StorageErrorCode>();
expectTypeOf(error.cause).toEqualTypeOf<unknown>();
