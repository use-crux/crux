import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchPromptLatestRun } from "./service";

describe("Prompt latest-Run service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("performs one protected request and validates the canonical response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "found",
          definitionId: "prompt:a+b",
          observabilityRevision: 7,
          operationId: "operation/latest",
          path: "/runs/operation%2Flatest",
        }),
        { status: 200 },
      ),
    );
    const controller = new AbortController();

    await expect(
      fetchPromptLatestRun("prompt:a+b", controller.signal),
    ).resolves.toMatchObject({
      status: "found",
      operationId: "operation/latest",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5173/api/devtools/prompt-latest-run/prompt%3Aa%2Bb",
      {
        headers: {
          "X-Crux-Devtools-Request": "prompt-latest-run-v1",
        },
        signal: controller.signal,
      },
    );
  });
});
