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
});
