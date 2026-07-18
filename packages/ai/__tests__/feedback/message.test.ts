import {
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "@use-crux/core/observability";
import { afterEach, describe, expect, it, vi } from "vitest";
import { feedback } from "../../src/feedback";

describe("AI message feedback", () => {
  afterEach(() => resetObservabilityRuntime());

  it("extracts the authoritative run ID and delegates durably", async () => {
    const submitFeedback = vi.fn(async () => ({
      feedbackId: "feedback-1",
      reviewId: "review-1",
      revision: 1,
      status: "created" as const,
      acceptedAt: "2026-07-16T20:00:00.000Z",
    }));
    setObservabilityTransport({
      send: () => ({ dispositions: [] }),
      submitFeedback,
    });

    await feedback(
      {
        metadata: {
          user: { messageId: "message-1" },
          crux: { runId: "run_0123456789abcdef01234567" },
        },
      },
      "up",
    );

    expect(submitFeedback).toHaveBeenCalledWith({
      runId: "run_0123456789abcdef01234567",
      rating: "up",
    });
  });

  it("rejects absent or invalid Crux message metadata", async () => {
    await expect(feedback({ metadata: {} }, "down")).rejects.toThrow(
      /metadata\.crux\.runId/i,
    );
    await expect(
      feedback({ metadata: { crux: { runId: "trace-not-a-run" } } }, "down"),
    ).rejects.toThrow(/metadata\.crux\.runId/i);
  });
});
