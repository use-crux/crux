/** Dense embedding-space namespace records and compatibility guard. @module */

import {
  EmbeddingSpaceMismatchError,
  embeddingSpaceDigest,
  embeddingIdentity,
  type DenseEmbedding,
  type EmbeddingModality,
  type EmbeddingSpace,
  type EmbeddingSpaceDescriptor,
} from "../embedding";
import type { JsonObject, RecordStore } from "../storage";

/** Persisted, human-debuggable dense space facts for one index namespace. */
export interface IndexedEmbeddingSpaceRecord extends JsonObject {
  readonly _cruxRecordType: "embedding-space";
  readonly digest: string;
  readonly name: string;
  readonly dimensions: number;
  readonly modalities: readonly string[];
  readonly writers: readonly string[];
  readonly updatedAt: number;
}

/**
 * Key containing the dense embedding space claimed by a namespace.
 *
 * The disjoint `indexer-namespace` prefix prevents collisions with the
 * id-first indexed-record key space. Because the storage contract has no
 * SearchStore identity, distinct search stores sharing one RecordStore and
 * namespace intentionally share this loud guard; use distinct namespaces.
 */
export function indexedEmbeddingSpaceKey(namespace: string): string {
  return `indexer-namespace:${namespace}:embedding-space`;
}

/** Resolve a full guardable space for authored or structural dense embeddings. */
export function resolveIndexedEmbeddingSpace<
  TModality extends EmbeddingModality,
>(embedding: DenseEmbedding<TModality>): EmbeddingSpace {
  if (embedding.space) return embedding.space;
  return {
    name: embedding.name,
    dimensions: embedding.dimensions,
    modalities: embedding.modalities ?? ["text"],
    normalization: "unknown",
    fingerprint: embeddingIdentity(embedding),
  };
}

/** Check, and optionally claim, a namespace for a dense embedding space. */
export async function guardIndexedEmbeddingSpace(args: {
  readonly records: RecordStore;
  readonly indexerId: string;
  readonly namespace: string;
  readonly space: EmbeddingSpace;
  readonly write: boolean;
}): Promise<string> {
  const key = indexedEmbeddingSpaceKey(args.namespace);
  const digest = embeddingSpaceDigest(args.space.fingerprint);
  const current = await args.records.get(key);
  if (current) {
    assertMatchingSpace(current, args, digest);
    return digest;
  }
  if (!args.write) return digest;

  const created = await args.records.create(
    key,
    createSpaceRecord(args.space, digest, args.indexerId),
  );
  if (created) return digest;

  const concurrent = await args.records.get(key);
  if (!concurrent) {
    throw new Error(
      `Embedding space record for namespace "${args.namespace}" disappeared during creation.`,
    );
  }
  assertMatchingSpace(concurrent, args, digest);
  return digest;
}

/**
 * Register a same-space indexer at the vector-write boundary.
 *
 * Writer updates are intentionally best-effort read-modify-write operations:
 * a stale writer fails loudly on the next claim, while premature deletion is
 * caught by the unconditional per-hit vector-space assertion during search.
 */
export async function registerIndexedEmbeddingSpaceWriter(args: {
  readonly records: RecordStore;
  readonly indexerId: string;
  readonly namespace: string;
  readonly space: EmbeddingSpace;
}): Promise<string> {
  const key = indexedEmbeddingSpaceKey(args.namespace);
  const digest = embeddingSpaceDigest(args.space.fingerprint);
  const current = await args.records.get(key);
  if (!current) {
    const created = await args.records.create(
      key,
      createSpaceRecord(args.space, digest, args.indexerId),
    );
    if (created) return digest;
    const concurrent = await args.records.get(key);
    if (!concurrent) {
      throw new Error(
        `Embedding space record for namespace "${args.namespace}" disappeared during creation.`,
      );
    }
    return registerWriterOnRecord(args, key, concurrent, digest);
  }
  return registerWriterOnRecord(args, key, current, digest);
}

/**
 * Release one indexer's claim after its id-scoped records and vectors clear.
 *
 * This update is best-effort for the same reason as writer registration. A
 * stale entry is recoverable by rerunning that indexer's clear operation.
 */
export async function releaseIndexedEmbeddingSpaceWriter(args: {
  readonly records: RecordStore;
  readonly indexerId: string;
  readonly namespace: string;
}): Promise<void> {
  const key = indexedEmbeddingSpaceKey(args.namespace);
  const current = await args.records.get(key);
  if (!current) return;
  const writers = spaceWriters(current).filter(
    (writer) => writer !== args.indexerId,
  );
  if (writers.length === 0) {
    await args.records.delete(key);
    return;
  }
  await args.records.put(key, { ...current, writers, updatedAt: Date.now() });
}

/** Check the namespace record for retrieval without creating it. */
export async function guardRetrievedEmbeddingSpace<
  TModality extends EmbeddingModality,
>(args: {
  readonly records: RecordStore;
  readonly namespace: string;
  readonly embedding: DenseEmbedding<TModality>;
}): Promise<{ readonly digest: string; readonly recorded: boolean }> {
  const space = resolveIndexedEmbeddingSpace(args.embedding);
  const digest = embeddingSpaceDigest(space.fingerprint);
  const current = await args.records.get(
    indexedEmbeddingSpaceKey(args.namespace),
  );
  if (!current) return { digest, recorded: false };
  assertMatchingSpace(current, { namespace: args.namespace, space }, digest);
  return { digest, recorded: true };
}

function createSpaceRecord(
  space: EmbeddingSpace,
  digest: string,
  indexerId: string,
): IndexedEmbeddingSpaceRecord {
  return {
    _cruxRecordType: "embedding-space",
    digest,
    name: space.name,
    dimensions: space.dimensions,
    modalities: [...space.modalities],
    writers: [indexerId],
    updatedAt: Date.now(),
  };
}

async function registerWriterOnRecord(
  args: {
    readonly records: RecordStore;
    readonly indexerId: string;
    readonly namespace: string;
    readonly space: EmbeddingSpace;
  },
  key: string,
  current: JsonObject,
  digest: string,
): Promise<string> {
  assertMatchingSpace(current, args, digest);
  const writers = spaceWriters(current);
  if (writers.includes(args.indexerId)) return digest;
  await args.records.put(key, {
    ...current,
    writers: [...writers, args.indexerId].sort(),
    updatedAt: Date.now(),
  });
  return digest;
}

function assertMatchingSpace(
  current: JsonObject,
  args: { readonly namespace: string; readonly space: EmbeddingSpace },
  actual: string,
): void {
  if (current.digest === actual) return;
  const error = new EmbeddingSpaceMismatchError({
    namespace: args.namespace,
    expected: typeof current.digest === "string" ? current.digest : "<invalid>",
    actual,
    expectedSpace: spaceDescriptor(current),
    actualSpace: { name: args.space.name, dimensions: args.space.dimensions },
  });
  const writers = spaceWriters(current);
  error.message +=
    writers.length > 0
      ? ` Namespace "${args.namespace}" holds space ${spaceLabel(current)} written by indexer(s) ${writers.map((writer) => `"${writer}"`).join(", ")}; clear them or index into a new namespace.`
      : " Clear the namespace or index into a new namespace.";
  throw error;
}

function spaceWriters(value: JsonObject): string[] {
  return Array.isArray(value.writers)
    ? [
        ...new Set(
          value.writers.filter(
            (writer): writer is string => typeof writer === "string",
          ),
        ),
      ].sort()
    : [];
}

function spaceLabel(value: JsonObject): string {
  return typeof value.name === "string" && typeof value.dimensions === "number"
    ? `${value.name} (${value.dimensions}d)`
    : "<unknown>";
}

function spaceDescriptor(
  value: JsonObject,
): EmbeddingSpaceDescriptor | undefined {
  return typeof value.name === "string" && typeof value.dimensions === "number"
    ? { name: value.name, dimensions: value.dimensions }
    : undefined;
}
