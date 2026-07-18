import type { CruxRunId } from "../observability/contract";
import type { JsonValue } from "../storage/types";

/** User sentiment accepted by the durable feedback API. */
export type FeedbackRating = "up" | "down";

/** Optional detail submitted with a run rating. */
export interface FeedbackInput {
  readonly rating: FeedbackRating;
  readonly comment?: string;
  readonly correction?: JsonValue;
  readonly dedupeKey?: string;
}

/** Normalized run-linked payload delivered to the configured destination. */
export interface FeedbackSubmission extends FeedbackInput {
  readonly runId: CruxRunId;
}

/** Durable server disposition for one feedback submission. */
export type FeedbackReceiptStatus = "created" | "updated" | "duplicate";

/** Receipt proving that a feedback destination durably handled the request. */
export interface FeedbackReceipt {
  readonly feedbackId: string;
  readonly reviewId: string;
  readonly revision: number;
  readonly status: FeedbackReceiptStatus;
  readonly acceptedAt: string;
}

/** Durable feedback capability implemented by an observability destination. */
export interface CruxFeedbackDestination {
  submitFeedback(submission: FeedbackSubmission): Promise<FeedbackReceipt>;
}
