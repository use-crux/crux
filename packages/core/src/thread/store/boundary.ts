/**
 * Structural append-boundary validation for canonical Threads.
 *
 * @module
 */

import type { Storage } from "../../storage";
import { ThreadError } from "../errors";
import { threadNodeKey } from "./keys";
import { isNodePublished } from "./path";
import {
  parseThreadNodeRecord,
  type ThreadControlRecord,
} from "./records";

/** Prove that one published append target ends its complete causal group. */
export async function assertThreadAppendBoundary(
  storage: Storage,
  threadId: string,
  control: ThreadControlRecord | null,
  messageId: string,
): Promise<void> {
  if (
    !control ||
    !(await isNodePublished(storage, threadId, control, messageId))
  ) {
    throw new ThreadError(
      "not_found",
      `Append target "${messageId}" is not published in Thread "${threadId}".`,
    );
  }
  const raw = await storage.records.get(threadNodeKey(threadId, messageId));
  const node = raw ? parseThreadNodeRecord(raw) : null;
  if (
    control.redactions[messageId] &&
    node?.state !== "redacted"
  ) {
    throw new ThreadError(
      "redacted",
      `Append target "${messageId}" is redacted but its structural tombstone is not yet durable.`,
    );
  }
  if (!node?.groupEnd) {
    throw new ThreadError(
      "invalid_group",
      `Append target "${messageId}" splits a causal group; target its final message instead.`,
    );
  }
}
