import {
  resetObservabilityRuntime,
  setObservabilityTransport,
  subscribeObservability,
} from "../../src/observability";
import { feedback } from "../../src/feedback";
import type { FeedbackReceipt, FeedbackSubmission } from "../../src/feedback";
import { afterEach, describe, expect, it } from "vitest";

describe("feedback", () => {
  afterEach(() => resetObservabilityRuntime());

  it("fails actionably when the configured destination is not durable", async () => {
    setObservabilityTransport({
      send: () => ({ dispositions: [] }),
    });

    await expect(
      feedback("run_0123456789abcdef01234567" as never, "up"),
    ).rejects.toThrow(/durable feedback destination.*configure/i);
  });

  it("privacy-normalizes input and awaits the durable receipt", async () => {
    let accept!: (receipt: FeedbackReceipt) => void;
    const receipt = new Promise<FeedbackReceipt>((resolve) => {
      accept = resolve;
    });
    const submissions: FeedbackSubmission[] = [];
    setObservabilityTransport({
      send: () => ({ dispositions: [] }),
      submitFeedback: async (submission) => {
        submissions.push(submission);
        return receipt;
      },
    });

    let settled = false;
    const pending = feedback("run_0123456789abcdef01234567" as never, {
      rating: "down",
      comment: "Email me at owner@example.com",
      correction: { token: "token-private", answer: "safe" },
      dedupeKey: "message-1",
    }).finally(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(submissions).toEqual([
      {
        runId: "run_0123456789abcdef01234567",
        rating: "down",
        comment: "Email me at [redacted-email]",
        correction: { token: "[redacted]", answer: "safe" },
        dedupeKey: "message-1",
      },
    ]);

    accept({
      feedbackId: "feedback-1",
      reviewId: "review-1",
      revision: 1,
      status: "created",
      acceptedAt: "2026-07-16T20:00:00.000Z",
    });
    await expect(pending).resolves.toMatchObject({ feedbackId: "feedback-1" });
  });

  it("propagates destination errors without exposing submission secrets", async () => {
    const failure = new Error("destination unavailable");
    setObservabilityTransport({
      send: () => ({ dispositions: [] }),
      submitFeedback: async () => Promise.reject(failure),
    });

    await expect(
      feedback("run_0123456789abcdef01234567" as never, {
        rating: "up",
        comment: "token-secret-value",
      }),
    ).rejects.toBe(failure);
    expect(failure.message).not.toContain("secret-value");
  });

  it("emits feedback evidence linked to the authoritative generation run", async () => {
    const records: Array<Record<string, unknown>> = [];
    subscribeObservability((record) => records.push(record));
    setObservabilityTransport({
      send: () => ({ dispositions: [] }),
      submitFeedback: async () => ({
        feedbackId: "feedback-1",
        reviewId: "review-1",
        revision: 1,
        status: "created",
        acceptedAt: "2026-07-16T20:00:00.000Z",
      }),
    });

    await feedback("run_0123456789abcdef01234567" as never, "up");

    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "span:start",
          primitive: "feedback.record",
        }),
        expect.objectContaining({
          type: "edge",
          edgeType: "feedback.for",
          to: { kind: "run", id: "run_0123456789abcdef01234567" },
        }),
      ]),
    );
  });
});
