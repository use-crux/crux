/** AI SDK message-metadata bridge for durable Crux feedback. @module */

import {
  feedback as submitRunFeedback,
  type FeedbackInput,
  type FeedbackRating,
  type FeedbackReceipt,
} from "@use-crux/core/feedback";
import type { CruxRunId } from "@use-crux/core/observability";

/** Minimal message shape accepted without coupling Core to AI SDK types. */
export interface MessageWithCruxMetadata {
  readonly metadata?: unknown;
}

/**
 * Submit durable feedback for the run linked from an AI message.
 *
 * Call this only on an authenticated application server after verifying that
 * the current user owns the message. A run ID is correlation, not authority.
 */
export async function feedback(
  message: MessageWithCruxMetadata,
  input: FeedbackRating | FeedbackInput,
): Promise<FeedbackReceipt> {
  const runId = extractRunId(message.metadata);
  return submitRunFeedback(runId, input);
}

function extractRunId(metadata: unknown): CruxRunId {
  const crux =
    isRecord(metadata) && isRecord(metadata.crux) ? metadata.crux : undefined;
  const runId = crux?.runId;
  if (typeof runId !== "string" || !/^run_[0-9a-f]{24}$/u.test(runId)) {
    throw new TypeError(
      "feedback() requires a message with valid metadata.crux.runId from a Crux stream result.",
    );
  }
  return runId as CruxRunId;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type {
  FeedbackInput,
  FeedbackRating,
  FeedbackReceipt,
} from "@use-crux/core/feedback";
