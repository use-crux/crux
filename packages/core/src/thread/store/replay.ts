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
      node.state !== "live"
    ) {
      throw identityConflict();
    }
  }

  const selectedHead = control.heads.main;
  const leaf = nodes.at(-1)!.id;
  const selected = selectedHead
    ? await isAncestor(storage, threadId, selectedHead, leaf)
    : false;
  if (!selected && !Object.values(control.leaves).includes(leaf)) {
    throw identityConflict();
  }

  return Object.freeze({
    status: selected ? "selected" : "alternative",
    messageIds: Object.freeze(nodes.map((node) => node.id)),
    ...(first.parentId ? { parentId: first.parentId } : {}),
    selectedHead: selected
      ? leaf
      : await selectedSiblingLeaf(
          storage,
          threadId,
          selectedHead,
          first.parentId,
        ),
    committedAt: first.createdAt,
    replayed: true,
  });
}

async function isAncestor(
  storage: Storage,
  threadId: string,
  head: string,
  candidate: string,
): Promise<boolean> {
  let cursor: string | null = head;
  while (cursor) {
    if (cursor === candidate) return true;
    const value = await storage.records.get(threadNodeKey(threadId, cursor));
    if (!value) return false;
    cursor = parseThreadNodeRecord(value).parentId;
  }
  return false;
}

async function selectedSiblingLeaf(
  storage: Storage,
  threadId: string,
  head: string | undefined,
  parentId: string | null,
): Promise<string> {
  if (!head) {
    throw identityConflict();
  }
  const path: ThreadNodeRecord[] = [];
  let cursor: string | null = head;
  while (cursor) {
    const value = await storage.records.get(threadNodeKey(threadId, cursor));
    if (!value) throw identityConflict();
    const node = parseThreadNodeRecord(value);
    path.unshift(node);
    cursor = node.parentId;
  }
  const start = parentId
    ? path.findIndex((node) => node.id === parentId) + 1
    : 0;
  const first = path[start];
  if (!first || first.parentId !== parentId) throw identityConflict();
  const group = path.slice(start).filter((node) => node.groupId === first.groupId);
  const leaf = group.find((node) => node.groupEnd);
  if (!leaf) throw identityConflict();
  return leaf.id;
}

function identityConflict(): ThreadError {
  return new ThreadError(
    "identity_conflict",
    "Thread message ids are already reserved for different content or position.",
  );
}
