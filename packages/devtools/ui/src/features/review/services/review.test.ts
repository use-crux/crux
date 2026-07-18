import { afterEach, describe, expect, it, vi } from "vitest";
import { reviewService } from "./review";

describe("Review service", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts explicit correction-save intent and preserves pending-sync artifacts", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
    const artifact = {
      status: "pending-sync",
      caseId: "refund",
      path: "evals/support.cases.jsonl",
      row: "{}\n",
      diff: "+{}\n",
      unvalidatedExpected: true,
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(artifact)));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      reviewService.action("review/1", {
        type: "add-to-eval",
        correctionProposal: "approved",
        saveCorrection: true,
      }),
    ).resolves.toEqual(artifact);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://localhost:5173/api/reviews/review%2F1/actions");
    expect(JSON.parse(init.body as string)).toMatchObject({
      correctionProposal: "approved",
      saveCorrection: true,
    });
  });

  it("surfaces the server's actionable Case validation error", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("Case 'refund' does not match the managed task schema", {
            status: 400,
          }),
      ),
    );

    await expect(
      reviewService.action("review-1", {
        type: "preview-add-to-eval",
        evalId: "support",
        caseId: "refund",
        input: {},
      }),
    ).rejects.toThrow("does not match the managed task schema");
  });

  it("normalizes empty Review history collections at the wire boundary", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              projection: {
                reviewId: "review-1",
                runId: "run-1",
                status: "open",
                rating: "down",
                contextStatus: "pending",
                updatedAt: "2026-07-17T00:00:00.000Z",
              },
              submissions: null,
              actions: null,
            }),
          ),
      ),
    );

    await expect(reviewService.detail("review-1")).resolves.toMatchObject({
      submissions: [],
      actions: [],
    });
  });
});
