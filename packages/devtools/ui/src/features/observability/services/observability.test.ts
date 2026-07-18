import { afterEach, describe, expect, it, vi } from "vitest";
import { observabilityService } from "./observability";

describe("observability service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the runs list only through the revisioned page contract", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ revision: 1, rows: [] })),
    );
    vi.stubGlobal("fetch", fetchMock);

    // The bare-array list path is gone — Global Search and the Runs page share
    // this one server-owned, revisioned read model.
    expect(observabilityService).not.toHaveProperty("listRuns");

    await observabilityService.listRunsPage({ status: ["ok"] });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5173/api/observability/runs/page?status=ok",
      expect.anything(),
    );
  });

  it("fetches focused span events from the lazy endpoint with encoded ids", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([])));
    vi.stubGlobal("fetch", fetchMock);

    await observabilityService.getSpanEvents("run/id", "span/id", {
      name: "token.chunk",
      limit: 512,
      after: "2026-07-03T10:00:00.000Z",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5173/api/observability/runs/run%2Fid/spans/span%2Fid/events?name=token.chunk&after=2026-07-03T10%3A00%3A00.000Z&limit=512",
      expect.anything(),
    );
  });
});
