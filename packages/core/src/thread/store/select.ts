/**
 * Linearizable standalone branch selection for Threads.
 *
 * Selection moves only the mutable owner head and records the continuation
 * being left, so returning to either sibling restores its last visited leaf.
 *
 * @module
 */

import {
  mutateRecord,
  StorageError,
  type Storage,
} from "../../storage";
import { ThreadCommitError, ThreadError } from "../errors";
import type { ThreadSnapshot } from "../types";
import { threadControlKey } from "./keys";
import {
  getThreadNodeRecord,
  isNodePublished,
  loadThreadPath,
} from "./path";
import { readThread } from "./read";
import {
  parseThreadControlRecord,
  parseThreadNodeRecord,
  type ThreadControlRecord,
  type ThreadNodeRecord,
} from "./records";

const OWNER = "main";

/** Select a sibling or ancestor and restore its remembered continuation. */
export async function selectThread(
  storage: Storage,
  threadId: string,
  messageId: string,
): Promise<ThreadSnapshot> {
  ensureMutationCapability(storage, threadId);
  let selectedHead: string | undefined;
  try {
    await mutateRecord(
      storage.records,
      threadControlKey(threadId),
      async (current) => {
        if (!current) throw targetNotFound(threadId, messageId);
        const control = parseThreadControlRecord(current);
        assertLive(control, threadId);
        const target = await loadTarget(storage, threadId, control, messageId);
        const currentHead = control.heads[OWNER];
        if (!currentHead) throw targetNotFound(threadId, messageId);
        const currentPath = await loadThreadPath(storage, threadId, currentHead);
        if (currentPath.some((node) => node.id === target.id)) {
          selectedHead = currentHead;
          return { type: "none" };
        }
        const currentBranch = selectionSibling(currentPath, target);
        const restored =
          control.leaves[target.id] ??
          await publishedGroupEnd(storage, threadId, control, target);
        const restoredPath = await loadThreadPath(storage, threadId, restored);
        if (
          !restoredPath.some((node) => node.id === target.id) ||
          !restoredPath.at(-1)?.groupEnd
        ) {
          throw new ThreadError(
            "commit_failed",
            `Thread "${threadId}" stores an invalid remembered continuation for "${messageId}".`,
          );
        }
        selectedHead = restored;
        const now = new Date().toISOString();
        const next: ThreadControlRecord = {
          ...control,
          heads: { ...control.heads, [OWNER]: restored },
          leaves: {
            ...control.leaves,
            [currentBranch.id]: currentHead,
          },
          updatedAt: now,
        };
        return { type: "put", value: next };
      },
    );
  } catch (error) {
    throw mapSelectionError(threadId, error);
  }
  if (!selectedHead) {
    throw new ThreadCommitError(
      `Thread "${threadId}" selection completed without a selected position.`,
    );
  }
  return readThread(storage, threadId, { at: selectedHead });
}

async function loadTarget(
  storage: Storage,
  threadId: string,
  control: ThreadControlRecord,
  messageId: string,
): Promise<ThreadNodeRecord> {
  const raw = await getThreadNodeRecord(storage, threadId, messageId);
  if (!raw || !(await isNodePublished(storage, threadId, control, messageId))) {
    throw targetNotFound(threadId, messageId);
  }
  return parseThreadNodeRecord(raw);
}

function selectionSibling(
  currentPath: readonly ThreadNodeRecord[],
  target: ThreadNodeRecord,
): ThreadNodeRecord {
  const sibling = currentPath.find(
    (node) =>
      node.parentId === target.parentId &&
      node.seq === 0 &&
      target.seq === 0,
  );
  if (sibling) return sibling;
  throw new ThreadError(
    "invalid_group",
    `Selection target "${target.id}" must be a sibling or ancestor of the selected Thread path.`,
  );
}

async function publishedGroupEnd(
  storage: Storage,
  threadId: string,
  control: ThreadControlRecord,
  target: ThreadNodeRecord,
): Promise<string> {
  if (target.groupEnd) return target.id;
  const positions = new Set([
    ...Object.values(control.heads),
    ...Object.values(control.leaves),
  ]);
  for (const position of positions) {
    const path = await loadThreadPath(storage, threadId, position);
    const index = path.findIndex((node) => node.id === target.id);
    if (index < 0) continue;
    const groupEnd = path.slice(index).find(
      (node) => node.groupId === target.groupId && node.groupEnd,
    );
    if (groupEnd) return groupEnd.id;
  }
  throw new ThreadError(
    "commit_failed",
    `Thread "${threadId}" cannot resolve the causal-group end for "${target.id}".`,
  );
}

function ensureMutationCapability(storage: Storage, threadId: string): void {
  if (storage.records.capabilities().mutate === false) {
    throw new ThreadError(
      "unsupported_capability",
      `Thread "${threadId}" requires linearizable record mutation for select().`,
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
    `Selection target "${messageId}" is not published in Thread "${threadId}".`,
  );
}

function mapSelectionError(threadId: string, error: unknown): ThreadError {
  if (error instanceof ThreadError) return error;
  if (error instanceof StorageError && error.code === "unsupported_capability") {
    return new ThreadError(
      "unsupported_capability",
      `Thread "${threadId}" requires a records store with linearizable mutate() support.`,
      { cause: error },
    );
  }
  return new ThreadCommitError(
    `Thread "${threadId}" selection could not be published; visible history may be unchanged.`,
    error,
  );
}
