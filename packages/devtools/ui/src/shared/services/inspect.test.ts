import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRunsQuery, inspectService } from "./inspect";

describe("inspection service", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds only retained run filters", () => {
    expect(
      buildRunsQuery({
        status: ["ok"],
        target: ["support"],
        limit: 20,
      }),
    ).toBe("?status=ok&target=support&limit=20");
  });

  it("reads the retained overview endpoint", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
    const fetchMock = vi.fn(
      async (_input: string | URL | Request) => new Response("{}"),
    );
    vi.stubGlobal("fetch", fetchMock);

    await inspectService.overview("24h");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:5173/api/inspect/overview?window=24h",
    );
  });
});
