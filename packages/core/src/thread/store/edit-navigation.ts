/**
 * Pure and read-only navigation helpers for immutable Thread edits.
 *
 * @module
 */

import type { Storage } from "../../storage";
import type { ThreadCommit } from "../types";
import { loadThreadPath } from "./path";
import type {
  ThreadControlRecord,
  ThreadLiveNodeRecord,
  ThreadNodeRecord,
} from "./records";

/** Find the selected sibling immediately after two paths diverge. */
export function branchAfterCommonParent(
  currentPath: readonly ThreadNodeRecord[],
  targetPath: readonly ThreadNodeRecord[],
): ThreadNodeRecord | undefined {
  const targetParentPath = targetPath.slice(0, -1);
  let index = 0;
  while (
    index < currentPath.length &&
    index < targetParentPath.length &&
    currentPath[index]!.id === targetParentPath[index]!.id
  ) {
    index += 1;
  }
  return currentPath[index];
}

/** Resolve the deepest remembered continuation containing an edit target. */
export async function rememberedLeafForTarget(
  storage: Storage,
  threadId: string,
  control: ThreadControlRecord,
  currentHead: string,
  currentPath: readonly ThreadNodeRecord[],
  targetPath: readonly ThreadNodeRecord[],
  targetId: string,
): Promise<string> {
  if (currentPath.some((node) => node.id === targetId)) return currentHead;
  let remembered = targetId;
  let bestBranchDepth = -2;
  let bestLeafDepth = -1;
  for (const [branchId, leafId] of Object.entries(control.leaves)) {
    const leafPath = await loadThreadPath(storage, threadId, leafId);
    if (!leafPath.some((node) => node.id === targetId)) continue;
    const branchDepth = targetPath.findIndex((node) => node.id === branchId);
    if (
      branchDepth > bestBranchDepth ||
      (branchDepth === bestBranchDepth && leafPath.length > bestLeafDepth)
    ) {
      remembered = leafId;
      bestBranchDepth = branchDepth;
      bestLeafDepth = leafPath.length;
    }
  }
  return remembered;
}

/** Project an immutable replacement into the public edit receipt. */
export function editReceipt(
  replacement: ThreadLiveNodeRecord,
  parentId: string | null,
  replayed: boolean,
): ThreadCommit {
  return Object.freeze({
    status: "selected",
    messageIds: Object.freeze([replacement.id]),
    ...(parentId ? { parentId } : {}),
    selectedHead: replacement.id,
    committedAt: replacement.createdAt,
    replayed,
  });
}
