import { afterEach, describe, expect, it, vi } from "vitest";
import { evalsService } from "./evals";

describe("Eval services", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses only the V3 catalog and run read models with encoded detail IDs", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response("{}"),
    );
    vi.stubGlobal("fetch", fetchMock);

    await evalsService.catalog();
    await evalsService.runs();
    await evalsService.run("run/id with space");
    await evalsService.setBaseline("run/id", "candidate");

    const calls = fetchMock.mock.calls;
    expect(calls.map(([url]) => url)).toEqual([
      "http://localhost:5173/api/eval/catalog",
      "http://localhost:5173/api/eval/runs",
      "http://localhost:5173/api/eval/runs/run%2Fid%20with%20space",
      "http://localhost:5173/api/eval/baselines",
    ]);
    expect(
      JSON.parse((fetchMock.mock.calls[3]?.[1] as RequestInit).body as string),
    ).toEqual({
      runId: "run/id",
      variant: "candidate",
    });
  });
});
