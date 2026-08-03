/**
 * Permanent deletion for unowned canonical Threads.
 *
 * The deleted control record is the durable identity tombstone and the only
 * publication point. Node, receipt, pending-receipt, and asset cleanup follows
 * publication so every other handle fails closed while cleanup is in flight.
 *
 * @module
 */

import {
  mutateRecord,
  StorageError,
  type JsonObject,
  type RecordEntry,
  type Storage,
} from "../storage";
import {
  ThreadCommitError,
  ThreadError,
  ThreadInUseError,
} from "./errors";
import {
  threadControlKey,
  threadNodePrefix,
  threadReceiptPrefix,
} from "./store/keys";
import {
  parseThreadControlRecord,
  type ThreadControlRecord,
} from "./store/records";

const CLEANUP_ATTEMPTS = 8;

/** Publish permanent deletion and erase every owned child record. */
export async function deleteThread(
  storage: Storage,
  threadId: string,
): Promise<void> {
  ensureMutationCapability(storage, threadId);
  try {
    await publishDeletion(storage, threadId);
  } catch (error) {
    throw mapDeletionError(threadId, error, false);
  }
  try {
    await cleanupThread(storage, threadId);
  } catch (error) {
    throw mapDeletionError(threadId, error, true);
  }
}

function mapDeletionError(
  threadId: string,
  error: unknown,
  published: boolean,
): ThreadError {
  if (error instanceof ThreadError) return error;
  if (
    error instanceof StorageError &&
    error.code === "unsupported_capability"
  ) {
    return new ThreadError(
      "unsupported_capability",
      `Thread "${threadId}" requires a records store with linearizable mutate() support for delete().`,
      { cause: error },
    );
  }
  if (published) {
    return new ThreadCommitError(
      `Thread "${threadId}" deletion was published but physical cleanup did not finish.`,
      error,
    );
  }
  return new ThreadCommitError(
    `Thread "${threadId}" deletion could not be published.`,
    error,
  );
}

async function publishDeletion(
  storage: Storage,
  threadId: string,
): Promise<void> {
  await mutateRecord(
    storage.records,
    threadControlKey(threadId),
    (current) => {
      const now = new Date().toISOString();
      if (!current) {
        const tombstone: ThreadControlRecord = {
          schema: 1,
          state: "deleted",
          owners: {},
          heads: {},
          leaves: {},
          redactions: {},
          removals: {},
          pendingReceipts: {},
          createdAt: now,
          updatedAt: now,
        };
        return { type: "put", value: tombstone };
      }
      const control = parseThreadControlRecord(current);
      if (
        control.state === "deleted" &&
        Object.keys(control.pendingReceipts).length === 0
      ) {
        return { type: "none" };
      }
      if (control.state === "live" && Object.keys(control.owners).length > 0) {
        throw inUse(threadId);
      }
      return {
        type: "put",
        value: {
          ...control,
          state: "deleted",
          owners: {},
          heads: {},
          leaves: {},
          redactions: {},
          removals: {},
          pendingReceipts: {},
          updatedAt: now,
        },
      };
    },
  );
}

async function cleanupThread(storage: Storage, threadId: string): Promise<void> {
  for (let attempt = 0; attempt < CLEANUP_ATTEMPTS; attempt += 1) {
    const nodeEntries = await listAll(storage, threadNodePrefix(threadId));
    const receiptEntries = await listAll(
      storage,
      threadReceiptPrefix(threadId),
    );
    if (nodeEntries.length === 0 && receiptEntries.length === 0) return;
    const assetUris = [
      ...new Set(nodeEntries.flatMap(({ value }) => ownedAssetUris(value))),
    ];
    if (assetUris.length > 0 && !storage.assets) {
      throw new ThreadError(
        "unsupported_capability",
        `Thread "${threadId}" cannot erase message assets without their owning AssetStore.`,
      );
    }
    if (storage.assets) {
      for (const uri of assetUris) {
        await storage.assets.delete({ uri });
      }
    }
    await deleteKeys(
      storage,
      [...nodeEntries, ...receiptEntries].map(({ key }) => key),
    );
    await Promise.resolve();
  }
  throw new ThreadCommitError(
    `Thread "${threadId}" child records continued appearing during deletion cleanup.`,
  );
}

function ownedAssetUris(value: JsonObject): readonly string[] {
  if (value.state === "redacted" || value.assetRefs === undefined) return [];
  if (
    !Array.isArray(value.assetRefs) ||
    !value.assetRefs.every((uri) => typeof uri === "string")
  ) {
    return [];
  }
  return value.assetRefs;
}

async function listAll(
  storage: Storage,
  prefix: string,
): Promise<readonly RecordEntry[]> {
  const entries: RecordEntry[] = [];
  let cursor: string | undefined;
  do {
    const page = await storage.records.list(prefix, { cursor });
    entries.push(...page.entries);
    cursor = page.cursor;
  } while (cursor);
  return entries;
}

async function deleteKeys(
  storage: Storage,
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) return;
  if (storage.records.deleteMany) {
    await storage.records.deleteMany(keys);
    return;
  }
  await Promise.all(keys.map((key) => storage.records.delete(key)));
}

function ensureMutationCapability(storage: Storage, threadId: string): void {
  if (storage.records.capabilities().mutate === false) {
    throw new ThreadError(
      "unsupported_capability",
      `Thread "${threadId}" requires linearizable record mutation for delete().`,
    );
  }
}

function inUse(threadId: string): ThreadInUseError {
  return new ThreadInUseError(
    `Thread "${threadId}" is still owned. Close or kill every owning Session, delete those Sessions, then delete the Thread.`,
  );
}
