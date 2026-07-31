/**
 * Exact path reads for generic Storage-backed Threads.
 *
 * Reads begin at a published control position, walk immutable parents, then
 * reverse into canonical root-to-head order. Pagination preserves whole causal
 * groups even when one group exceeds the requested limit.
 *
 * @module
 */

import { decodePersistedMessages } from "../../content/persisted-message";
import type { JsonObject, Storage } from "../../storage";
import { ThreadError } from "../errors";
import type {
  ThreadEntry,
  ThreadReadOptions,
  ThreadSnapshot,
} from "../types";
import { threadControlKey, threadNodeKey } from "./keys";
import {
  parseThreadControlRecord,
  parseThreadNodeRecord,
  type ThreadControlRecord,
  type ThreadNodeRecord,
} from "./records";

/** Read one exact Thread path, optionally as a whole-group page. */
export async function readThread(
  storage: Storage,
  threadId: string,
  options: ThreadReadOptions = {},
): Promise<ThreadSnapshot> {
  validateReadOptions(options);
  const rawControl = await storage.records.get(threadControlKey(threadId));
  if (!rawControl) return frozenSnapshot(threadId, undefined, []);
  const control = parseThreadControlRecord(rawControl);
  if (control.state === "deleted") {
    throw new ThreadError("deleted", `Thread "${threadId}" has been deleted.`);
  }
  const head = options.at ?? control.heads.main;
  if (!head) return frozenSnapshot(threadId, undefined, []);
  if (options.at && !(await isNodePublished(storage, threadId, control, head))) {
    throw new ThreadError(
      "not_found",
      `Message "${head}" is not published in Thread "${threadId}".`,
    );
  }

  const path = await loadPath(storage, threadId, head);
  const addressed = applyBefore(path, options.before);
  const page = applyLimit(addressed, options.limit);
  const entries = await Promise.all(
    page.nodes.map((node) => nodeToEntry(storage, node)),
  );
  return frozenSnapshot(threadId, head, entries, page.cursor);
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
    let cursor: string | null = position;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor)) {
      if (cursor === messageId) return true;
      visited.add(cursor);
      const raw = await getNodeRecord(storage, threadId, cursor);
      if (!raw) break;
      cursor = parseThreadNodeRecord(raw).parentId;
    }
  }
  return false;
}

async function loadPath(
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
    const raw = await getNodeRecord(storage, threadId, cursor);
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

async function getNodeRecord(
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

function applyBefore(
  path: readonly ThreadNodeRecord[],
  before: string | undefined,
): readonly ThreadNodeRecord[] {
  if (!before) return path;
  const index = path.findIndex((node) => node.id === before);
  if (index < 0) {
    throw new ThreadError("not_found", `Pagination boundary "${before}" is not on this Thread path.`);
  }
  if (path[index]?.seq !== 0) {
    throw new ThreadError(
      "invalid_group",
      `Pagination boundary "${before}" must be the first message of a causal group.`,
    );
  }
  return path.slice(0, index);
}

function applyLimit(
  path: readonly ThreadNodeRecord[],
  limit: number | undefined,
): { readonly nodes: readonly ThreadNodeRecord[]; readonly cursor?: string } {
  if (limit === undefined || path.length === 0) return { nodes: path };
  const groups = groupPath(path);
  const selected: ThreadNodeRecord[][] = [];
  let count = 0;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index]!;
    if (selected.length > 0 && count + group.length > limit) break;
    selected.unshift(group);
    count += group.length;
    if (count >= limit) break;
  }
  const nodes = selected.flat();
  return {
    nodes,
    ...(nodes.length < path.length && nodes[0] ? { cursor: nodes[0].id } : {}),
  };
}

function groupPath(path: readonly ThreadNodeRecord[]): ThreadNodeRecord[][] {
  const groups: ThreadNodeRecord[][] = [];
  for (const node of path) {
    const current = groups.at(-1);
    if (!current || current[0]?.groupId !== node.groupId) groups.push([node]);
    else current.push(node);
  }
  return groups;
}

async function nodeToEntry(
  storage: Storage,
  node: ThreadNodeRecord,
): Promise<ThreadEntry> {
  const structural = {
    id: node.id,
    ...(node.parentId ? { parentId: node.parentId } : {}),
  };
  if (node.state === "redacted") {
    return Object.freeze({ kind: "redacted", ...structural });
  }
  if (node.state === "removed") {
    return Object.freeze({
      kind: "removed",
      ...structural,
      createdAt: node.createdAt,
    });
  }
  const [message] = await decodePersistedMessages({
    storage,
    messages: [node.message!],
  });
  if (!message) {
    throw new ThreadError("commit_failed", "Stored Thread message could not be decoded.");
  }
  return Object.freeze({
    kind: "message",
    ...structural,
    createdAt: node.createdAt,
    ...message,
  });
}

function validateReadOptions(options: ThreadReadOptions): void {
  if (options.before !== undefined && options.limit === undefined) {
    throw new ThreadError(
      "invalid_group",
      "Thread read `before` requires a `limit` so pagination stays group-safe.",
    );
  }
  if (
    options.limit !== undefined &&
    (!Number.isInteger(options.limit) || options.limit < 1)
  ) {
    throw new ThreadError("invalid_message", "Thread read limit must be a positive integer.");
  }
}

function frozenSnapshot(
  threadId: string,
  head: string | undefined,
  entries: readonly ThreadEntry[],
  cursor?: string,
): ThreadSnapshot {
  return Object.freeze({
    threadId,
    ...(head ? { head } : {}),
    entries: Object.freeze([...entries]),
    ...(cursor ? { cursor } : {}),
  });
}
