import { inMemoryAssetStore, inMemoryRecordStore } from "../../../src/storage";
import type {
  AssetRef,
  AssetStore,
  JsonObject,
  RecordStore,
} from "../../../src/storage";

/** Controllable RecordStore boundary for snapshot failure tests. */
export function controlledRecordStore(): {
  readonly store: RecordStore;
  failPutWhen(predicate: (value: JsonObject) => boolean, error: Error): void;
  clearPutFailure(): void;
  failLists(error: Error): void;
  blockPutWhen(predicate: (value: JsonObject) => boolean): {
    readonly entered: Promise<void>;
    release(): void;
  };
} {
  const inner = inMemoryRecordStore();
  let putFailure:
    | {
        readonly predicate: (value: JsonObject) => boolean;
        readonly error: Error;
      }
    | undefined;
  let putBarrier:
    | {
        readonly predicate: (value: JsonObject) => boolean;
        readonly entered: () => void;
        readonly wait: Promise<void>;
      }
    | undefined;
  let listFailure: Error | undefined;
  return {
    store: Object.freeze({
      get: inner.get,
      getMany: inner.getMany,
      put: async (key, value, options) => {
        if (putFailure?.predicate(value)) throw putFailure.error;
        if (putBarrier?.predicate(value)) {
          const barrier = putBarrier;
          barrier.entered();
          await barrier.wait;
        }
        await inner.put(key, value, options);
      },
      putMany: inner.putMany,
      create: inner.create,
      delete: inner.delete,
      deleteMany: inner.deleteMany,
      list: async (prefix, options) => {
        if (listFailure) throw listFailure;
        return inner.list(prefix, options);
      },
      scan: inner.scan,
      watch: inner.watch,
      capabilities: inner.capabilities,
    }),
    failPutWhen: (predicate, error) => {
      putFailure = { predicate, error };
    },
    clearPutFailure: () => {
      putFailure = undefined;
    },
    failLists: (error) => {
      listFailure = error;
    },
    blockPutWhen: (predicate) => {
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      putBarrier = { predicate, entered: enter, wait };
      return {
        entered,
        release: () => {
          putBarrier = undefined;
          release();
        },
      };
    },
  };
}

/** Controllable AssetStore boundary with successful ownership logs. */
export function controlledAssetStore(): {
  readonly store: AssetStore;
  readonly putRefs: readonly AssetRef[];
  readonly deletedRefs: readonly AssetRef[];
  failGets(error: Error): void;
  failDelete(ref: AssetRef, error: Error): void;
  clearFailures(): void;
} {
  const inner = inMemoryAssetStore();
  const putRefs: AssetRef[] = [];
  const deletedRefs: AssetRef[] = [];
  let getFailure: Error | undefined;
  let deleteFailure:
    | { readonly uri: string; readonly error: Error }
    | undefined;
  return {
    store: Object.freeze({
      put: async (asset, options) => {
        const stored = await inner.put(asset, options);
        putRefs.push(stored.ref);
        return stored;
      },
      get: async (ref) => {
        if (getFailure) throw getFailure;
        return inner.get(ref);
      },
      delete: async (ref) => {
        if (deleteFailure?.uri === ref.uri) throw deleteFailure.error;
        await inner.delete(ref);
        deletedRefs.push(ref);
      },
    }),
    putRefs,
    deletedRefs,
    failGets: (error) => {
      getFailure = error;
    },
    failDelete: (ref, error) => {
      deleteFailure = { uri: ref.uri, error };
    },
    clearFailures: () => {
      getFailure = undefined;
      deleteFailure = undefined;
    },
  };
}

/** Collect stored records matching a value predicate without asserting key syntax. */
export async function storedValues(
  store: RecordStore,
  predicate: (value: JsonObject) => boolean,
): Promise<readonly JsonObject[]> {
  const values: JsonObject[] = [];
  let cursor: string | undefined;
  do {
    const page = await store.list(
      "workspace:",
      cursor ? { cursor } : undefined,
    );
    values.push(
      ...page.entries.flatMap(({ value }) => (predicate(value) ? [value] : [])),
    );
    cursor = page.cursor;
  } while (cursor);
  return values;
}

/** Load one private entry by value discriminator and snapshot id. */
export async function snapshotEntry(
  store: RecordStore,
  snapshotId: string,
): Promise<JsonObject> {
  const [entry] = await storedValues(
    store,
    (value) =>
      value._cruxWorkspaceSnapshotEntry === true &&
      value.snapshotId === snapshotId,
  );
  if (!entry) throw new Error(`Missing snapshot entry for ${snapshotId}.`);
  return entry;
}

/** Collect entry fingerprints keyed by their owning snapshot ids. */
export async function snapshotEntryFingerprints(
  store: RecordStore,
): Promise<Map<string, string>> {
  const entries = await storedValues(
    store,
    (value) => value._cruxWorkspaceSnapshotEntry === true,
  );
  return new Map(
    entries.flatMap((entry) =>
      typeof entry.snapshotId === "string" &&
      typeof entry.entryFingerprint === "string"
        ? [[entry.snapshotId, entry.entryFingerprint]]
        : [],
    ),
  );
}

/** Read the HEAD AssetStore URI from one snapshot entry. */
export async function snapshotAssetUri(
  store: RecordStore,
  snapshotId: string,
): Promise<string> {
  const entry = await snapshotEntry(store, snapshotId);
  if (
    isJsonObject(entry.head) &&
    isJsonObject(entry.head.payload) &&
    typeof entry.head.payload.assetUri === "string"
  ) {
    return entry.head.payload.assetUri;
  }
  throw new Error(`Missing snapshot asset for ${snapshotId}.`);
}

/** Read all HEAD/distinct-published AssetStore URIs from one snapshot entry. */
export async function snapshotAssetUris(
  store: RecordStore,
  snapshotId: string,
): Promise<readonly string[]> {
  const entry = await snapshotEntry(store, snapshotId);
  const uris: string[] = [];
  if (
    isJsonObject(entry.head) &&
    isJsonObject(entry.head.payload) &&
    typeof entry.head.payload.assetUri === "string"
  ) {
    uris.push(entry.head.payload.assetUri);
  }
  if (
    isJsonObject(entry.published) &&
    isJsonObject(entry.published.state) &&
    isJsonObject(entry.published.state.payload) &&
    typeof entry.published.state.payload.assetUri === "string"
  ) {
    uris.push(entry.published.state.payload.assetUri);
  }
  return uris;
}

/** Delete matching records without asserting their private key shape. */
export async function deleteStoredRecords(
  store: RecordStore,
  predicate: (value: JsonObject) => boolean,
): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await store.list(
      "workspace:",
      cursor ? { cursor } : undefined,
    );
    for (const entry of page.entries) {
      if (predicate(entry.value)) await store.delete(entry.key);
    }
    cursor = page.cursor;
  } while (cursor);
}

/** Limit backend pages independently from the caller's logical query. */
export function pageSizeRecordStore(
  inner: RecordStore,
  pageSize: number,
): RecordStore {
  return Object.freeze({
    get: inner.get,
    ...(inner.getMany ? { getMany: inner.getMany } : {}),
    put: inner.put,
    ...(inner.putMany ? { putMany: inner.putMany } : {}),
    create: inner.create,
    delete: inner.delete,
    ...(inner.deleteMany ? { deleteMany: inner.deleteMany } : {}),
    list: (prefix, options) =>
      inner.list(prefix, { ...options, limit: pageSize }),
    capabilities: inner.capabilities,
  });
}

/** Append synthetic records to backend listing pages for corruption tests. */
export function withListedRecords(
  inner: RecordStore,
  entries: readonly { readonly key: string; readonly value: JsonObject }[],
): RecordStore {
  return Object.freeze({
    get: inner.get,
    put: inner.put,
    create: inner.create,
    delete: inner.delete,
    list: async (prefix, options) => {
      const page = await inner.list(prefix, options);
      return {
        entries: [...page.entries, ...(options?.cursor ? [] : entries)],
        ...(page.cursor !== undefined ? { cursor: page.cursor } : {}),
      };
    },
    capabilities: inner.capabilities,
  });
}

function isJsonObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
