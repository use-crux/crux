/**
 * Idempotent Thread append replay.
 *
 * Caller-stable message IDs make retries safe only when every member still
 * names the same persisted content and structural position.
 *
 * @module
 */

import type { PersistedMessage } from "../../content/persisted-message";
import type { Storage } from "../../storage";
import { ThreadError } from "../errors";
import type { ThreadCommit } from "../types";
import { threadNodeKey } from "./keys";
import {
  parseThreadNodeRecord,
  type ThreadControlRecord,
  type ThreadNodeRecord,
} from "./records";
import { readThreadReceipt } from "./receipts";
import { isNodePublished } from "./path";

/** Prepared identity needed to recognize an already-published append. */
export interface ReplayMessage {
  readonly id: string;
  readonly message: PersistedMessage;
  readonly identity: string;
}

/** Return the original receipt shape when an append is an exact replay. */
export async function replayThreadAppend(
  storage: Storage,
  threadId: string,
  control: ThreadControlRecord | null,
  messages: readonly ReplayMessage[],
  after: string | undefined,
): Promise<ThreadCommit | null> {
  const stored = await Promise.all(
    messages.map(async ({ id }) => {
      const value = await storage.records.get(threadNodeKey(threadId, id));
      return value ? parseThreadNodeRecord(value) : null;
    }),
  );
  if (stored.every((node) => node === null)) return null;
  if (!control || stored.some((node) => node === null)) {
    throw identityConflict();
  }

  const nodes = stored as readonly ThreadNodeRecord[];
  const first = nodes[0]!;
  if (after !== undefined && first.parentId !== after) {
    throw identityConflict();
  }
  for (const [index, node] of nodes.entries()) {
    const expectedParent = index === 0 ? first.parentId : nodes[index - 1]!.id;
    const prepared = messages[index]!;
    if (
      node.id !== prepared.id ||
      node.identity !== prepared.identity ||
      node.parentId !== expectedParent ||
      node.groupId !== first.groupId ||
      node.seq !== index ||
      node.groupEnd !== (index === nodes.length - 1) ||
      node.state !== "live" ||
      node.editOf !== undefined ||
      node.revisionOf !== undefined
    ) {
      throw identityConflict();
    }
  }

  const leaf = nodes.at(-1)!.id;
  if (!(await isNodePublished(storage, threadId, control, leaf))) {
    throw identityConflict();
  }
  const receipt = await readThreadReceipt(
    storage,
    threadId,
    first.id,
    control.pendingReceipts[first.id],
  );
  if (
    receipt.committedAt !== first.createdAt ||
    receipt.messageIds.length !== nodes.length ||
    receipt.messageIds.some((id, index) => id !== nodes[index]!.id) ||
    receipt.parentId !== (first.parentId ?? undefined)
  ) {
    throw identityConflict();
  }
  return receipt;
}

function identityConflict(): ThreadError {
  return new ThreadError(
    "identity_conflict",
    "Thread message ids are already reserved for different content or position.",
  );
}
