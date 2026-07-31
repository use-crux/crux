/**
 * Validated private storage records for Threads.
 *
 * Every record is treated as untrusted JSON at the storage boundary. Structural
 * validation prevents malformed adapter data from becoming canonical history.
 *
 * @module
 */

import type { PersistedMessage } from "../../content/persisted-message";
import { isPersistedMessages } from "../../content/persisted-message-validation";
import type { JsonObject } from "../../storage";
import { ThreadError } from "../errors";

/** The single mutable publication point for one Thread. */
export interface ThreadControlRecord extends JsonObject {
  readonly schema: 1;
  readonly state: "live" | "deleted";
  readonly heads: Readonly<Record<string, string>>;
  readonly leaves: Readonly<Record<string, string>>;
  readonly redactions: Readonly<Record<string, true>>;
  readonly removals: Readonly<Record<string, true>>;
  readonly pendingReceipts: Readonly<Record<string, ThreadReceiptRecord>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface ThreadNodeBase extends JsonObject {
  readonly schema: 1;
  readonly id: string;
  readonly parentId: string | null;
  readonly groupId: string;
  readonly seq: number;
  readonly groupEnd: boolean;
}

/** One live or visibility-removed canonical-message record. */
export interface ThreadLiveNodeRecord extends ThreadNodeBase {
  readonly createdAt: string;
  readonly state: "live" | "removed";
  readonly message: PersistedMessage & JsonObject;
  readonly identity: string;
  readonly assetRefs: readonly string[];
  readonly editOf?: string;
  readonly revisionOf?: string;
}

/** Minimal irreversible provenance tombstone. */
export interface ThreadRedactedNodeRecord extends ThreadNodeBase {
  readonly state: "redacted";
}

/** One structural Thread node in live or erased form. */
export type ThreadNodeRecord =
  | ThreadLiveNodeRecord
  | ThreadRedactedNodeRecord;

/** Immutable original receipt for one published append group. */
export interface ThreadReceiptRecord extends JsonObject {
  readonly schema: 1;
  readonly status: "selected" | "alternative";
  readonly messageIds: readonly string[];
  readonly parentId: string | null;
  readonly selectedHead: string;
  readonly committedAt: string;
}

/** Validate and narrow an untrusted control record. */
export function parseThreadControlRecord(
  value: JsonObject,
): ThreadControlRecord {
  const redactions = value.redactions ?? {};
  const removals = value.removals ?? {};
  if (
    value.schema !== 1 ||
    (value.state !== "live" && value.state !== "deleted") ||
    !isStringRecord(value.heads) ||
    !isStringRecord(value.leaves) ||
    !isTrueRecord(redactions) ||
    !isTrueRecord(removals) ||
    !isReceiptRecord(value.pendingReceipts) ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt)
  ) {
    throw corruptRecord("control");
  }
  return { ...value, redactions, removals } as ThreadControlRecord;
}

/** Validate and narrow an untrusted immutable node record. */
export function parseThreadNodeRecord(value: JsonObject): ThreadNodeRecord {
  const state = value.state;
  const assetRefs = value.assetRefs ?? [];
  const livePayload =
    state === "live" || state === "removed"
      ? typeof value.identity === "string" &&
        isStringArray(assetRefs) &&
        isTimestamp(value.createdAt) &&
        value.message !== undefined &&
        isPersistedMessages([value.message])
      : value.identity === undefined &&
        value.message === undefined &&
        value.assetRefs === undefined &&
        value.createdAt === undefined;
  if (
    value.schema !== 1 ||
    typeof value.id !== "string" ||
    (value.parentId !== null && typeof value.parentId !== "string") ||
    typeof value.groupId !== "string" ||
    !Number.isInteger(value.seq) ||
    Number(value.seq) < 0 ||
    typeof value.groupEnd !== "boolean" ||
    (state !== "live" && state !== "removed" && state !== "redacted") ||
    !livePayload ||
    (value.editOf !== undefined && typeof value.editOf !== "string") ||
    (value.revisionOf !== undefined && typeof value.revisionOf !== "string")
  ) {
    throw corruptRecord("node");
  }
  if (state === "live" || state === "removed") {
    return { ...value, assetRefs } as unknown as ThreadNodeRecord;
  }
  return value as unknown as ThreadNodeRecord;
}

function isTrueRecord(
  value: unknown,
): value is Readonly<Record<string, true>> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => entry === true)
  );
}

/** Validate and narrow an untrusted immutable append receipt. */
export function parseThreadReceiptRecord(
  value: JsonObject,
): ThreadReceiptRecord {
  if (
    value.schema !== 1 ||
    (value.status !== "selected" && value.status !== "alternative") ||
    !isStringArray(value.messageIds) ||
    value.messageIds.length === 0 ||
    (value.parentId !== null && typeof value.parentId !== "string") ||
    typeof value.selectedHead !== "string" ||
    !isTimestamp(value.committedAt)
  ) {
    throw corruptRecord("receipt");
  }
  return value as ThreadReceiptRecord;
}

function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function isReceiptRecord(
  value: unknown,
): value is Readonly<Record<string, ThreadReceiptRecord>> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return false;
  }
  try {
    return Object.values(value).every((entry) => {
      if (
        entry === null ||
        typeof entry !== "object" ||
        Array.isArray(entry)
      ) {
        return false;
      }
      parseThreadReceiptRecord(entry as JsonObject);
      return true;
    });
  } catch {
    return false;
  }
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
  );
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function corruptRecord(kind: string): ThreadError {
  return new ThreadError(
    "commit_failed",
    `Stored Thread ${kind} record is malformed.`,
  );
}
