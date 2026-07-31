/**
 * Exact path reads for generic Storage-backed Threads.
 *
 * Reads begin at a published control position, walk immutable parents, then
 * reverse into canonical root-to-head order. Pagination preserves whole causal
 * groups even when one group exceeds the requested limit.
 *
 * @module
 */

import type { Storage } from "../../storage";
import { ThreadError } from "../errors";
import type {
  ThreadEntry,
  ThreadReadOptions,
  ThreadSnapshot,
  ThreadVariantInfo,
} from "../types";
import { computeThreadVariants } from "../variants";
import { threadControlKey } from "./keys";
import { hydrateThreadMessage } from "./hydrate";
import {
  isNodePublished,
  loadThreadPath,
} from "./path";
import {
  parseThreadControlRecord,
  type ThreadNodeRecord,
} from "./records";
import { threadControlRevision } from "./revision";

/** Read one exact Thread path, optionally as a whole-group page. */
export async function readThread(
  storage: Storage,
  threadId: string,
  options: ThreadReadOptions = {},
): Promise<ThreadSnapshot> {
  validateReadOptions(options);
  const rawControl = await storage.records.get(threadControlKey(threadId));
  if (!rawControl) {
    return frozenSnapshot(
      threadId,
      threadControlRevision(undefined),
      undefined,
      [],
    );
  }
  const control = parseThreadControlRecord(rawControl);
  if (control.state === "deleted") {
    throw new ThreadError("deleted", `Thread "${threadId}" has been deleted.`);
  }
  const head = options.at ?? control.heads.main;
  const revision = threadControlRevision(control);
  if (!head) return frozenSnapshot(threadId, revision, undefined, []);
  if (options.at && !(await isNodePublished(storage, threadId, control, head))) {
    throw new ThreadError(
      "not_found",
      `Message "${head}" is not published in Thread "${threadId}".`,
    );
  }

  const path = await loadThreadPath(storage, threadId, head);
  const addressed = applyBefore(path, options.before);
  const page = applyLimit(addressed, options.limit);
  const variants = await computeThreadVariants(
    storage,
    threadId,
    control,
    path,
  );
  const entries = await Promise.all(
    page.nodes.map((node) =>
      nodeToEntry(
        storage,
        node,
        variants.get(node.id),
        control.redactions[node.id] === true,
        control.removals[node.id] === true,
      )),
  );
  return frozenSnapshot(threadId, revision, head, entries, page.cursor);
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
  variant: ThreadVariantInfo | undefined,
  redacted: boolean,
  removed: boolean,
): Promise<ThreadEntry> {
  const structural = {
    id: node.id,
    ...(node.parentId ? { parentId: node.parentId } : {}),
  };
  if (redacted || node.state === "redacted") {
    return Object.freeze({ kind: "redacted", ...structural });
  }
  if (removed || node.state === "removed") {
    return Object.freeze({
      kind: "removed",
      ...structural,
      createdAt: node.createdAt,
    });
  }
  const message = await hydrateThreadMessage(storage, node);
  return Object.freeze({
    kind: "message",
    ...structural,
    createdAt: node.createdAt,
    ...(variant ? { variant } : {}),
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
  revision: string,
  head: string | undefined,
  entries: readonly ThreadEntry[],
  cursor?: string,
): ThreadSnapshot {
  return Object.freeze({
    threadId,
    revision,
    ...(head ? { head } : {}),
    entries: Object.freeze([...entries]),
    ...(cursor ? { cursor } : {}),
  });
}
