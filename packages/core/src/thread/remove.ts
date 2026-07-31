/**
 * Internal causal-group removal for future Channel synchronization.
 *
 * Removal preserves canonical provenance while atomically changing visibility:
 * exact reads retain structural entries and managed projection drops the whole
 * causal group. Channels own the eventual public trigger.
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
  getThreadNodeRecord,
  isNodePublished,
  loadThreadPath,
} from "./store/path";
import {
  parseThreadControlRecord,
  parseThreadNodeRecord,
  type ThreadControlRecord,
  type ThreadLiveNodeRecord,
  type ThreadNodeRecord,
} from "./store/records";

/** Mark the published causal group containing `messageId` as removed. */
export async function removeThreadGroup(
  storage: Storage,
  threadId: string,
  messageId: string,
): Promise<void> {
  assertThreadId(messageId, "Thread message id");
  ensureMutationCapability(storage, threadId);
  let nodes: readonly ThreadNodeRecord[] = [];
  try {
    await mutateRecord(
      storage.records,
      threadControlKey(threadId),
      async (current) => {
        if (!current) throw notFound(threadId, messageId);
        const control = parseThreadControlRecord(current);
        assertLive(control, threadId);
        nodes = await loadPublishedGroup(
          storage,
          threadId,
          control,
          messageId,
        );
        const removals = { ...control.removals };
        let changed = false;
        for (const node of nodes) {
          if (removals[node.id]) continue;
          removals[node.id] = true;
          changed = true;
        }
        if (!changed) return { type: "none" };
        return {
          type: "put",
          value: {
            ...control,
            removals,
            updatedAt: new Date().toISOString(),
          },
        };
      },
    );
    await Promise.all(nodes.map((node) =>
      publishRemovedNode(storage, threadId, node)));
  } catch (error) {
    if (error instanceof ThreadError) throw error;
    if (
      error instanceof StorageError &&
      error.code === "unsupported_capability"
    ) {
      throw new ThreadError(
        "unsupported_capability",
        `Thread "${threadId}" requires a records store with linearizable mutate() support for removal.`,
        { cause: error },
      );
    }
    throw new ThreadCommitError(
      `Thread "${threadId}" removal was published but node cleanup did not finish.`,
      error,
    );
  }
}

async function loadPublishedGroup(
  storage: Storage,
  threadId: string,
  control: ThreadControlRecord,
  messageId: string,
): Promise<readonly ThreadNodeRecord[]> {
  const raw = await getThreadNodeRecord(storage, threadId, messageId);
  if (
    !raw ||
    !(await isNodePublished(storage, threadId, control, messageId))
  ) {
    throw notFound(threadId, messageId);
  }
  const target = parseThreadNodeRecord(raw);
  const group = new Map<string, ThreadNodeRecord>();
  const positions = new Set([
    ...Object.values(control.heads),
    ...Object.values(control.leaves),
  ]);
  for (const position of positions) {
    for (const node of await loadThreadPath(storage, threadId, position)) {
      if (node.groupId === target.groupId) group.set(node.id, node);
    }
  }
  return [...group.values()].sort((left, right) => left.seq - right.seq);
}

async function publishRemovedNode(
  storage: Storage,
  threadId: string,
  node: ThreadNodeRecord,
): Promise<void> {
  await mutateRecord(
    storage.records,
    threadNodeKey(threadId, node.id),
    (current) => {
      if (!current) return { type: "none" };
      const stored = parseThreadNodeRecord(current);
      if (stored.state !== "live") return { type: "none" };
      const removed: ThreadLiveNodeRecord = {
        ...stored,
        state: "removed",
      };
      return { type: "put", value: removed };
    },
  );
}

function ensureMutationCapability(storage: Storage, threadId: string): void {
  if (storage.records.capabilities().mutate === false) {
    throw new ThreadError(
      "unsupported_capability",
      `Thread "${threadId}" requires linearizable record mutation for removal.`,
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
    `Removal target "${messageId}" is not published in Thread "${threadId}".`,
  );
}
