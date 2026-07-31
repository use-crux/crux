/**
 * Deterministic alternative navigation metadata for Thread reads.
 *
 * Variants are derived from published positions rather than persisted on
 * messages, keeping immutable nodes free of owner-specific navigation state.
 *
 * @module
 */

import type { Storage } from "../storage";
import { ThreadError } from "./errors";
import { getThreadNodeRecord } from "./store/path";
import type {
  ThreadControlRecord,
  ThreadNodeRecord,
} from "./store/records";
import { parseThreadNodeRecord } from "./store/records";
import type { ThreadVariantInfo } from "./types";

/** Compute navigation metadata for every published sibling group start. */
export async function computeThreadVariants(
  storage: Storage,
  threadId: string,
  control: ThreadControlRecord,
  selectedPath: readonly ThreadNodeRecord[] = [],
): Promise<ReadonlyMap<string, ThreadVariantInfo>> {
  const cache = new Map(selectedPath.map((node) => [node.id, node]));
  const nodes = new Map(
    selectedPath
      .filter((node) => node.seq === 0)
      .map((node) => [node.id, node]),
  );
  const positions = new Set([
    ...Object.values(control.heads),
    ...Object.values(control.leaves),
  ]);
  for (const position of positions) {
    for (const node of await loadVariantPath(
      storage,
      threadId,
      position,
      cache,
    )) {
      if (node.seq === 0) nodes.set(node.id, node);
    }
  }

  const byParent = new Map<string | null, ThreadNodeRecord[]>();
  for (const node of nodes.values()) {
    const siblings = byParent.get(node.parentId) ?? [];
    siblings.push(node);
    byParent.set(node.parentId, siblings);
  }

  const variants = new Map<string, ThreadVariantInfo>();
  for (const siblings of byParent.values()) {
    if (siblings.length < 2) continue;
    siblings.sort(compareSibling);
    for (const [index, sibling] of siblings.entries()) {
      variants.set(sibling.id, Object.freeze({
        index,
        count: siblings.length,
        ...(siblings[index - 1]
          ? { previous: siblings[index - 1]!.id }
          : {}),
        ...(siblings[index + 1]
          ? { next: siblings[index + 1]!.id }
          : {}),
      }));
    }
  }
  return variants;
}

async function loadVariantPath(
  storage: Storage,
  threadId: string,
  head: string,
  cache: Map<string, ThreadNodeRecord>,
): Promise<readonly ThreadNodeRecord[]> {
  const reverse: ThreadNodeRecord[] = [];
  const visited = new Set<string>();
  let cursor: string | null = head;
  while (cursor) {
    if (visited.has(cursor)) {
      throw new ThreadError("commit_failed", "Stored Thread path contains a cycle.");
    }
    visited.add(cursor);
    let node = cache.get(cursor);
    if (!node) {
      const raw = await getThreadNodeRecord(storage, threadId, cursor);
      if (!raw) {
        throw new ThreadError(
          "commit_failed",
          `Published Thread path references missing message "${cursor}".`,
        );
      }
      node = parseThreadNodeRecord(raw);
      cache.set(node.id, node);
    }
    reverse.push(node);
    cursor = node.parentId;
  }
  return reverse.reverse();
}

function compareSibling(
  left: ThreadNodeRecord,
  right: ThreadNodeRecord,
): number {
  const leftCreatedAt = left.state === "redacted" ? "" : left.createdAt;
  const rightCreatedAt = right.state === "redacted" ? "" : right.createdAt;
  if (leftCreatedAt < rightCreatedAt) return -1;
  if (leftCreatedAt > rightCreatedAt) return 1;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}
