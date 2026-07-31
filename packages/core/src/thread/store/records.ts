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
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One immutable structural and canonical-message record. */
export interface ThreadNodeRecord extends JsonObject {
  readonly schema: 1;
  readonly id: string;
  readonly parentId: string | null;
  readonly groupId: string;
  readonly seq: number;
  readonly groupEnd: boolean;
  readonly createdAt: string;
  readonly state: "live" | "removed" | "redacted";
  readonly message?: PersistedMessage & JsonObject;
  readonly identity?: string;
  readonly editOf?: string;
  readonly revisionOf?: string;
}

/** Validate and narrow an untrusted control record. */
export function parseThreadControlRecord(
  value: JsonObject,
): ThreadControlRecord {
  if (
    value.schema !== 1 ||
    (value.state !== "live" && value.state !== "deleted") ||
    !isStringRecord(value.heads) ||
    !isStringRecord(value.leaves) ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt)
  ) {
    throw corruptRecord("control");
  }
  return value as ThreadControlRecord;
}

/** Validate and narrow an untrusted immutable node record. */
export function parseThreadNodeRecord(value: JsonObject): ThreadNodeRecord {
  const state = value.state;
  const livePayload =
    state === "live" || state === "removed"
      ? typeof value.identity === "string" &&
        value.message !== undefined &&
        isPersistedMessages([value.message])
      : value.identity === undefined && value.message === undefined;
  if (
    value.schema !== 1 ||
    typeof value.id !== "string" ||
    (value.parentId !== null && typeof value.parentId !== "string") ||
    typeof value.groupId !== "string" ||
    !Number.isInteger(value.seq) ||
    Number(value.seq) < 0 ||
    typeof value.groupEnd !== "boolean" ||
    !isTimestamp(value.createdAt) ||
    (state !== "live" && state !== "removed" && state !== "redacted") ||
    !livePayload ||
    (value.editOf !== undefined && typeof value.editOf !== "string") ||
    (value.revisionOf !== undefined && typeof value.revisionOf !== "string")
  ) {
    throw corruptRecord("node");
  }
  return value as ThreadNodeRecord;
}

function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
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
