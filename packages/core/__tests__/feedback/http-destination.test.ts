import { createHttpObservabilityTransport } from "../../src/observability";
import { describe, expect, it, vi } from "vitest";

describe("HTTP feedback destination", () => {
  it("posts to the write-only route with destination auth and parses a receipt", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        feedbackId: "feedback-1",
        reviewId: "review-1",
        revision: 1,
        status: "created",
        acceptedAt: "2026-07-16T20:00:00.000Z",
      }),
    );
    const destination = createHttpObservabilityTransport({
      serverUrl: "https://crux.example",
      token: "ingest-token",
      feedbackToken: "feedback-token",
      fetch,
    });

    const receipt = await destination.submitFeedback?.({
      runId: "run_0123456789abcdef01234567" as never,
      rating: "up",
    });

    expect(receipt).toMatchObject({ status: "created", revision: 1 });
    expect(fetch).toHaveBeenCalledWith(
      "https://crux.example/api/feedback",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer feedback-token",
        }),
        body: JSON.stringify({
          runId: "run_0123456789abcdef01234567",
          rating: "up",
        }),
      }),
    );
  });

  it("reports rejection without exposing the token or response body", async () => {
    const destination = createHttpObservabilityTransport({
      feedbackToken: "feedback-secret",
      fetch: async () =>
        new Response("feedback-secret should not escape", { status: 401 }),
    });

    const error = await destination
      .submitFeedback?.({
        runId: "run_0123456789abcdef01234567" as never,
        rating: "down",
      })
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("HTTP 401");
    expect(String(error)).not.toContain("feedback-secret");
  });
});
