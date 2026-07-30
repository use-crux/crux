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

  it("rejects foreign fields in closed PromptText evidence", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          definitions: [
            {
              id: "prompt:writer",
              kind: "prompt",
              name: "writer",
              fidelity: "resolved",
              sourceRefs: [
                {
                  id: "source:writer",
                  role: "prompt",
                  property: "prompt",
                  source: { file: "src/writer.ts", line: 1 },
                  fidelity: "resolved",
                  metadata: {
                    promptText: {
                      tag: "md",
                      language: "markdown",
                      lifecycle: "static",
                      sourceKind: "owner",
                      privateCompilerState: true,
                    },
                  },
                },
              ],
            },
          ],
        }),
      ),
    );

    await expect(fetchProjectIndex()).rejects.toThrow();
  });
});
