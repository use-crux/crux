/**
 * Irreversible provenance erasure for canonical Threads.
 *
 * One control mutation publishes the complete normalized redaction set before
 * message payloads and Thread-owned assets are physically erased. Reads and
 * retries therefore fail closed while cleanup remains recoverable.
 *
 * @module
 */

import {
  mutateRecord,
  StorageError,
  type Storage,
} from "../storage";
import { ThreadCommitError, ThreadError } from "./errors";
import { assertThreadId } from "./ids";
import { threadControlKey, threadNodeKey } from "./store/keys";
import {
  isNodePublished,
  getThreadNodeRecord,
} from "./store/path";
import {
  parseThreadControlRecord,
  parseThreadNodeRecord,
  type ThreadControlRecord,
  type ThreadRedactedNodeRecord,
  type ThreadNodeRecord,
} from "./store/records";

/** Atomically publish and physically clean one normalized redaction set. */
export async function redactThreadMessages(
  storage: Storage,
  threadId: string,
  input: string | readonly string[],
): Promise<void> {
  ensureMutationCapability(storage, threadId);
  const ids = normalizeIds(input);
  let nodes: readonly ThreadNodeRecord[] = [];
  try {
    await mutateRecord(
      storage.records,
      threadControlKey(threadId),
      async (current) => {
        if (!current) throw notFound(threadId, ids[0]!);
        const control = parseThreadControlRecord(current);
        assertLive(control, threadId);
        nodes = await Promise.all(ids.map((id) =>
          loadPublishedNode(storage, threadId, control, id)));
        const redactions = { ...control.redactions };
        let changed = false;
        for (const id of ids) {
          if (redactions[id]) continue;
          redactions[id] = true;
          changed = true;
        }
        if (!changed) return { type: "none" };
        return {
          type: "put",
          value: {
            ...control,
            redactions,
            updatedAt: new Date().toISOString(),
          },
        };
      },
    );
    await Promise.all(nodes.map((node) =>
      eraseNode(storage, threadId, node)));
  } catch (error) {
    if (error instanceof ThreadError) throw error;
    if (
      error instanceof StorageError &&
      error.code === "unsupported_capability"
    ) {
      throw new ThreadError(
        "unsupported_capability",
        `Thread "${threadId}" requires a records store with linearizable mutate() support for redact().`,
        { cause: error },
      );
    }
    throw new ThreadCommitError(
      `Thread "${threadId}" redaction was published but physical cleanup did not finish.`,
      error,
    );
  }
}

function normalizeIds(input: string | readonly string[]): readonly string[] {
  const ids = [...new Set(typeof input === "string" ? [input] : input)].sort();
  if (ids.length === 0) {
    throw new ThreadError(
      "invalid_message",
      "Thread redact() requires at least one message id.",
    );
  }
  ids.forEach((id) => assertThreadId(id, "Thread message id"));
  return ids;
}

async function loadPublishedNode(
  storage: Storage,
  threadId: string,
  control: ThreadControlRecord,
  id: string,
): Promise<ThreadNodeRecord> {
  const raw = await getThreadNodeRecord(storage, threadId, id);
  if (!raw || !(await isNodePublished(storage, threadId, control, id))) {
    throw notFound(threadId, id);
  }
  return parseThreadNodeRecord(raw);
}

async function eraseNode(
  storage: Storage,
  threadId: string,
  node: ThreadNodeRecord,
): Promise<void> {
  if (node.state === "redacted") return;
  if (node.assetRefs.length > 0 && !storage.assets) {
    throw new ThreadError(
      "unsupported_capability",
      `Thread "${threadId}" cannot erase message assets without their owning AssetStore.`,
    );
  }
  if (storage.assets) {
    for (const uri of node.assetRefs) {
      await storage.assets.delete({ uri });
    }
  }
  await mutateRecord(
    storage.records,
    threadNodeKey(threadId, node.id),
    (current) => {
      if (!current) return { type: "none" };
      const stored = parseThreadNodeRecord(current);
      if (stored.state === "redacted") return { type: "none" };
      return { type: "put", value: tombstone(stored) };
    },
  );
}

function tombstone(node: ThreadNodeRecord): ThreadRedactedNodeRecord {
  return {
    schema: 1,
    id: node.id,
    parentId: node.parentId,
    groupId: node.groupId,
    seq: node.seq,
    groupEnd: node.groupEnd,
    state: "redacted",
  };
}

function ensureMutationCapability(storage: Storage, threadId: string): void {
  if (storage.records.capabilities().mutate === false) {
    throw new ThreadError(
      "unsupported_capability",
      `Thread "${threadId}" requires linearizable record mutation for redact().`,
    );
  }
}

function assertLive(control: ThreadControlRecord, threadId: string): void {
  if (control.state === "deleted") {
    throw new ThreadError("deleted", `Thread "${threadId}" has been deleted.`);
  }
}

function notFound(threadId: string, messageId: string): ThreadError {
  return new ThreadError(
    "not_found",
    `Redaction target "${messageId}" is not published in Thread "${threadId}".`,
  );
}
