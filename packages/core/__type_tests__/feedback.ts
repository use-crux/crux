import { feedback, type FeedbackInput } from "../src/feedback";
import type { CruxRunId } from "../src/observability";

declare const runId: CruxRunId;

feedback(runId, "up");
feedback(runId, {
  rating: "down",
  comment: "The response missed the refund policy.",
  correction: { answer: "Refunds take five business days." },
  dedupeKey: "message-1",
} satisfies FeedbackInput);

// @ts-expect-error Feedback accepts authoritative run IDs, not trace strings.
feedback("trace_0123456789abcdef01234567", "up");
// @ts-expect-error Feedback ratings are deliberately binary in V1.
feedback(runId, "neutral");
