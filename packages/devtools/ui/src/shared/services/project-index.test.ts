import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProjectIndex } from "./project-index";

describe("Project Index service", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("preserves server session metadata from the REST snapshot", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          projectRoot: "/repo",
          serverVersion: "0.6.0",
          generation: 8,
        }),
      ),
    );

    const index = await fetchProjectIndex();

    expect(index).toMatchObject({
      projectRoot: "/repo",
      serverVersion: "0.6.0",
      generation: 8,
    });
  });
});
