/**
 * Immutable append receipts for stable replay across branch navigation.
 *
 * Selection changes mutable heads, so replay cannot reconstruct the original
 * publication decision from current control state. One small immutable record
 * preserves the value returned by the successful append.
 *
 * @module
 */

import {
  mutateRecord,
  type Storage,
} from "../../storage";
import { ThreadCommitError, ThreadError } from "../errors";
import type { ThreadCommit } from "../types";
import {
  threadControlKey,
  threadReceiptKey,
} from "./keys";
import {
  parseThreadControlRecord,
  parseThreadReceiptRecord,
  type ThreadReceiptRecord,
} from "./records";

const RECEIPT_READ_ATTEMPTS = 8;

/** Persist the original append receipt idempotently. */
export async function finalizeThreadReceipt(
  storage: Storage,
  threadId: string,
  receipt: ThreadCommit,
): Promise<void> {
  await finalizeThreadReceiptRecord(
    storage,
    threadId,
    receipt.messageIds[0]!,
    toThreadReceiptRecord(receipt),
  );
}

/** Finalize one atomically published pending receipt record. */
export async function finalizeThreadReceiptRecord(
  storage: Storage,
  threadId: string,
  firstMessageId: string,
  record: ThreadReceiptRecord,
): Promise<void> {
  try {
    await persistReceiptRecord(storage, threadId, firstMessageId, record);
    await clearPendingReceipt(storage, threadId, firstMessageId, record);
  } catch (error) {
    if (error instanceof ThreadError) throw error;
    throw new ThreadCommitError(
      `Thread "${threadId}" append receipt for "${firstMessageId}" could not be finalized; visible history may already contain the commit.`,
      error,
    );
  }
}

async function persistReceiptRecord(
  storage: Storage,
  threadId: string,
  firstMessageId: string,
  record: ThreadReceiptRecord,
): Promise<void> {
  const key = threadReceiptKey(threadId, firstMessageId);
  if (await storage.records.create(key, record)) return;
  const current = await storage.records.get(key);
  if (
    !current ||
    !sameReceipt(parseThreadReceiptRecord(current), record)
  ) {
    throw new ThreadCommitError(
      `Thread "${threadId}" stores a conflicting append receipt for "${firstMessageId}".`,
    );
  }
}

/** Load the immutable original receipt for an exact append replay. */
export async function readThreadReceipt(
  storage: Storage,
  threadId: string,
  firstMessageId: string,
  pending: ThreadReceiptRecord | undefined,
): Promise<ThreadCommit> {
  if (pending) {
    await finalizeThreadReceiptRecord(
      storage,
      threadId,
      firstMessageId,
      pending,
    );
    return commitFromReceipt(pending);
  }
  const key = threadReceiptKey(threadId, firstMessageId);
  for (let attempt = 0; attempt < RECEIPT_READ_ATTEMPTS; attempt += 1) {
    const current = await storage.records.get(key);
    if (current) {
      const record = parseThreadReceiptRecord(current);
      return commitFromReceipt(record);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, attempt));
  }
  throw new ThreadCommitError(
    `Thread "${threadId}" append receipt for "${firstMessageId}" is unavailable; visible history may already contain the commit.`,
  );
}

/** Convert a public append receipt to its immutable storage record. */
export function toThreadReceiptRecord(
  receipt: ThreadCommit,
): ThreadReceiptRecord {
  return {
    schema: 1,
    status: receipt.status,
    messageIds: receipt.messageIds,
    parentId: receipt.parentId ?? null,
    selectedHead: receipt.selectedHead,
    committedAt: receipt.committedAt,
  };
}

/** Read one already-finalized receipt without retrying. */
export async function readPersistedThreadReceiptRecord(
  storage: Storage,
  threadId: string,
  firstMessageId: string,
): Promise<ThreadReceiptRecord | null> {
  const current = await storage.records.get(
    threadReceiptKey(threadId, firstMessageId),
  );
  return current ? parseThreadReceiptRecord(current) : null;
}

function commitFromReceipt(record: ThreadReceiptRecord): ThreadCommit {
  return Object.freeze({
    status: record.status,
    messageIds: Object.freeze([...record.messageIds]),
    ...(record.parentId ? { parentId: record.parentId } : {}),
    selectedHead: record.selectedHead,
    committedAt: record.committedAt,
    replayed: true,
  });
}

async function clearPendingReceipt(
  storage: Storage,
  threadId: string,
  firstMessageId: string,
  receipt: ThreadReceiptRecord,
): Promise<void> {
  await mutateRecord(
    storage.records,
    threadControlKey(threadId),
    (current) => {
      if (!current) return { type: "none" };
      const control = parseThreadControlRecord(current);
      const pending = control.pendingReceipts[firstMessageId];
      if (!pending) return { type: "none" };
      if (!sameReceipt(pending, receipt)) {
        throw new ThreadCommitError(
          `Thread "${threadId}" stores a conflicting pending receipt for "${firstMessageId}".`,
        );
      }
      const pendingReceipts = { ...control.pendingReceipts };
      delete pendingReceipts[firstMessageId];
      return {
        type: "put",
        value: { ...control, pendingReceipts },
      };
    },
  );
}

function sameReceipt(
  left: ThreadReceiptRecord,
  right: ThreadReceiptRecord,
): boolean {
  return (
    left.status === right.status &&
    left.parentId === right.parentId &&
    left.selectedHead === right.selectedHead &&
    left.committedAt === right.committedAt &&
    left.messageIds.length === right.messageIds.length &&
    left.messageIds.every((id, index) => id === right.messageIds[index])
  );
}
