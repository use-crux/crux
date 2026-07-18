import {
  currentObservabilityFeedbackDestination,
  currentObservabilityRedactPaths,
  currentObservabilityTransport,
} from "../observability/observe";
import { observe } from "../observability/observe";
import type { CruxRunId } from "../observability/contract";
import {
  normalizeFeedbackReceipt,
  normalizeFeedbackSubmission,
} from "./validation";
import type {
  CruxFeedbackDestination,
  FeedbackInput,
  FeedbackRating,
  FeedbackReceipt,
} from "./types";
import { DEFAULT_EVAL_PERSISTENCE_POLICY } from "../eval/internal/redact";

/**
 * Durably submit feedback for an authoritative Crux generation run.
 *
 * The promise resolves only after the configured destination returns its
 * durable receipt. Crux does not silently fall back to process-local storage.
 */
export async function feedback(
  runId: CruxRunId,
  input: FeedbackRating | FeedbackInput,
): Promise<FeedbackReceipt> {
  const destination = (currentObservabilityFeedbackDestination() ??
    currentObservabilityTransport()) as
    | (Partial<CruxFeedbackDestination> & object)
    | undefined;
  if (typeof destination?.submitFeedback !== "function") {
    throw new TypeError(
      "feedback() requires a configured durable feedback destination. Configure the Crux observability destination before submitting feedback.",
    );
  }
  const submission = normalizeFeedbackSubmission(runId, input, {
    ...DEFAULT_EVAL_PERSISTENCE_POLICY,
    redactPaths: currentObservabilityRedactPaths(),
  });
  const span = observe.openSpan({
    name: "feedback.record",
    primitive: "feedback.record",
    attributes: {
      rating: submission.rating,
      hasComment: submission.comment !== undefined,
      hasCorrection: submission.correction !== undefined,
    },
  });
  try {
    const receipt = await span.withContext(async () => {
      const accepted = normalizeFeedbackReceipt(
        await destination.submitFeedback!(submission),
      );
      observe.edge({
        edgeType: "feedback.for",
        from: { kind: "span", id: span.spanId },
        to: { kind: "run", id: submission.runId },
        attributes: {
          feedbackId: accepted.feedbackId,
          reviewId: accepted.reviewId,
          revision: accepted.revision,
          status: accepted.status,
        },
      });
      return accepted;
    });
    span.end({
      attributes: {
        feedbackId: receipt.feedbackId,
        reviewId: receipt.reviewId,
        revision: receipt.revision,
        status: receipt.status,
      },
    });
    return receipt;
  } catch (error) {
    span.error(error);
    throw error;
  }
}
