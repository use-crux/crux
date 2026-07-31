/**
 * Published path traversal for generic Storage-backed Threads.
 *
 * Thread operations share this one cycle-safe parent walk so publication,
 * alternatives, and exact reads agree on structural reachability.
 *
 * @module
 */

import type { JsonObject, Storage } from "../../storage";
import { ThreadError } from "../errors";
import { threadNodeKey } from "./keys";
import {
  parseThreadNodeRecord,
  type ThreadControlRecord,
  type ThreadNodeRecord,
} from "./records";

/** Load one immutable root-to-head path. */
export async function loadThreadPath(
  storage: Storage,
  threadId: string,
  head: string,
): Promise<readonly ThreadNodeRecord[]> {
  const reverse: ThreadNodeRecord[] = [];
  const visited = new Set<string>();
  let cursor: string | null = head;
  while (cursor) {
    if (visited.has(cursor)) {
      throw new ThreadError("commit_failed", "Stored Thread path contains a cycle.");
    }
    visited.add(cursor);
    const raw = await getThreadNodeRecord(storage, threadId, cursor);
    if (!raw) {
      throw new ThreadError(
        "commit_failed",
        `Published Thread path references missing message "${cursor}".`,
      );
    }
    const node = parseThreadNodeRecord(raw);
    reverse.push(node);
    cursor = node.parentId;
  }
  return reverse.reverse();
}

/** Read one untrusted node record by message identity. */
export async function getThreadNodeRecord(
  storage: Storage,
  threadId: string,
  messageId: string,
): Promise<JsonObject | null> {
  const key = threadNodeKey(threadId, messageId);
  if (storage.records.getMany) {
    return (await storage.records.getMany([key]))[0] ?? null;
  }
  return storage.records.get(key);
}

/** Whether a node is reachable from any published Thread position. */
export async function isNodePublished(
  storage: Storage,
  threadId: string,
  control: ThreadControlRecord,
  messageId: string,
): Promise<boolean> {
  const positions = new Set([
    ...Object.values(control.heads),
    ...Object.values(control.leaves),
  ]);
  for (const position of positions) {
    const path = await loadThreadPath(storage, threadId, position);
    if (path.some((node) => node.id === messageId)) return true;
  }
  return false;
}
