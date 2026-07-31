/**
 * Immutable editing and mutable branch selection for Threads.
 *
 * Alternative operations publish only through the control record: message
 * nodes remain immutable while the standalone owner position moves.
 *
 * @module
 */

import {
  mutateRecord,
  StorageError,
  type Storage,
} from "../../storage";
import { ThreadCommitError, ThreadError } from "../errors";
import { deriveThreadGroup } from "../groups";
import type {
  ThreadCommit,
  ThreadEditPatch,
} from "../types";
import { threadControlKey } from "./keys";
import {
  createImmutableThreadNodes,
  createThreadNodes,
  prepareThreadMessages,
} from "./nodes";
import {
  getThreadNodeRecord,
  isNodePublished,
  loadThreadPath,
} from "./path";
import {
  parseThreadControlRecord,
  parseThreadNodeRecord,
  type ThreadControlRecord,
  type ThreadNodeRecord,
} from "./records";

const OWNER = "main";

/** Create and select an immutable sibling replacement for one user message. */
export async function commitThreadEdit(
  storage: Storage,
  threadId: string,
  messageId: string,
  patch: ThreadEditPatch,
): Promise<ThreadCommit> {
  ensureMutationCapability(storage, threadId);
  const rawControl = await storage.records.get(threadControlKey(threadId));
  if (!rawControl) throw targetNotFound(threadId, messageId);
  const observedControl = parseThreadControlRecord(rawControl);
  assertLive(observedControl, threadId);
  const target = await loadEditTarget(
    storage,
    threadId,
    observedControl,
    messageId,
  );
  const observedHead = observedControl.heads[OWNER];
  if (!observedHead) throw targetNotFound(threadId, messageId);
  const targetPath = await loadThreadPath(storage, threadId, messageId);

  const prepared = await prepareThreadMessages(storage, [{
    ...(patch.id !== undefined ? { id: patch.id } : {}),
    role: "user",
    content: patch.content,
    ...(patch.metadata ? { metadata: patch.metadata } : {}),
  }]);
  const group = deriveThreadGroup(target.parentId, prepared);
  const createdAt = new Date().toISOString();
  const requested = createThreadNodes(
    group.members,
    target.parentId,
    group.id,
    createdAt,
  ).map((node) => ({ ...node, editOf: target.id }));
  const existed = await getThreadNodeRecord(storage, threadId, requested[0]!.id);
  const nodes = await createImmutableThreadNodes(
    storage,
    threadId,
    requested,
  );
  const replacement = nodes[0]!;
  if (
    existed &&
    await isNodePublished(
      storage,
      threadId,
      observedControl,
      replacement.id,
    )
  ) {
    return editReceipt(replacement, target.parentId, true);
  }

  let replayed = false;
  try {
    await mutateRecord(
      storage.records,
      threadControlKey(threadId),
      async (current) => {
        if (!current) throw targetNotFound(threadId, messageId);
        const control = parseThreadControlRecord(current);
        assertLive(control, threadId);
        if (!(await isNodePublished(storage, threadId, control, messageId))) {
          throw targetNotFound(threadId, messageId);
        }
        if (
          await isNodePublished(
            storage,
            threadId,
            control,
            replacement.id,
          )
        ) {
          replayed = true;
          return { type: "none" };
        }
        const currentHead = control.heads[OWNER];
        if (!currentHead) throw targetNotFound(threadId, messageId);
        const currentPath = await loadThreadPath(storage, threadId, currentHead);
        const currentBranch = branchAfterCommonParent(currentPath, targetPath);
        const originalLeaf = await rememberedLeafForTarget(
          storage,
          threadId,
          control,
          currentHead,
          currentPath,
          targetPath,
          target.id,
        );
        const leaves = {
          ...control.leaves,
          ...(currentBranch ? { [currentBranch.id]: currentHead } : {}),
          [target.id]: originalLeaf,
        };
        const now = new Date().toISOString();
        const next: ThreadControlRecord = {
          ...control,
          heads: { ...control.heads, [OWNER]: replacement.id },
          leaves,
          updatedAt: now,
        };
        return { type: "put", value: next };
      },
    );
  } catch (error) {
    throw mapEditError(threadId, error);
  }
  return editReceipt(replacement, target.parentId, replayed);
}

async function loadEditTarget(
  storage: Storage,
  threadId: string,
  control: ThreadControlRecord,
  messageId: string,
): Promise<ThreadNodeRecord> {
  const raw = await getThreadNodeRecord(storage, threadId, messageId);
  if (!raw || !(await isNodePublished(storage, threadId, control, messageId))) {
    throw targetNotFound(threadId, messageId);
  }
  const target = parseThreadNodeRecord(raw);
  if (target.state === "redacted") {
    throw new ThreadError(
      "redacted",
      `Edit target "${messageId}" in Thread "${threadId}" has been redacted.`,
    );
  }
  if (
    target.state !== "live" ||
    target.message?.role !== "user" ||
    target.seq !== 0 ||
    !target.groupEnd
  ) {
    throw new ThreadError(
      "invalid_group",
      `Edit target "${messageId}" must be a live user message that is the sole member of its causal group.`,
    );
  }
  return target;
}

function branchAfterCommonParent(
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

async function rememberedLeafForTarget(
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

function editReceipt(
  replacement: ThreadNodeRecord,
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

function ensureMutationCapability(storage: Storage, threadId: string): void {
  if (storage.records.capabilities().mutate === false) {
    throw new ThreadError(
      "unsupported_capability",
      `Thread "${threadId}" requires linearizable record mutation for edit().`,
    );
  }
}

function assertLive(control: ThreadControlRecord, threadId: string): void {
  if (control.state === "deleted") {
    throw new ThreadError("deleted", `Thread "${threadId}" has been deleted.`);
  }
}

function targetNotFound(threadId: string, messageId: string): ThreadError {
  return new ThreadError(
    "not_found",
    `Edit target "${messageId}" is not published in Thread "${threadId}".`,
  );
}

function mapEditError(threadId: string, error: unknown): ThreadError {
  if (error instanceof ThreadError) return error;
  if (error instanceof StorageError && error.code === "unsupported_capability") {
    return new ThreadError(
      "unsupported_capability",
      `Thread "${threadId}" requires a records store with linearizable mutate() support.`,
      { cause: error },
    );
  }
  return new ThreadCommitError(
    `Thread "${threadId}" edit could not be published; visible history may be unchanged.`,
    error,
  );
}
