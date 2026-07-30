import { describe, expect, it } from "vitest";

import { decodePromptLatestRunResult } from "./wire";

describe("Prompt latest-Run wire", () => {
  it("decodes request-bound found and empty destinations", () => {
    expect(
      decodePromptLatestRunResult(
        {
          status: "found",
          definitionId: "prompt:greeting",
          observabilityRevision: 7,
          operationId: "operation+latest",
          path: "/runs/operation%2Blatest",
        },
        "prompt:greeting",
      ),
    ).toEqual({
      status: "found",
      definitionId: "prompt:greeting",
      observabilityRevision: 7,
      operationId: "operation+latest",
      path: "/runs/operation%2Blatest",
    });
    expect(
      decodePromptLatestRunResult(
        {
          status: "empty",
          definitionId: "prompt:greeting",
          observabilityRevision: 8,
          path: "/library/index/prompt%3Agreeting/runs",
          exactPreview: { status: "available" },
        },
        "prompt:greeting",
      ),
    ).toMatchObject({ status: "empty", exactPreview: { status: "available" } });
  });

  it.each([
    {
      status: "found",
      definitionId: "prompt:other",
      observabilityRevision: 7,
      operationId: "operation",
      path: "/runs/operation",
    },
    {
      status: "found",
      definitionId: "prompt:greeting",
      observabilityRevision: 7,
      operationId: "operation+latest",
      path: "/runs/operation+latest",
    },
    {
      status: "empty",
      definitionId: "prompt:greeting",
      observabilityRevision: 7,
      path: "/library/index/prompt%3agreeting/runs",
      exactPreview: { status: "available" },
    },
    {
      status: "empty",
      definitionId: "prompt:greeting",
      observabilityRevision: 7,
      path: "/library/index/prompt%3Agreeting/runs",
      exactPreview: { status: "available", extra: true },
    },
  ])("rejects mismatched or noncanonical result %#", (value) => {
    expect(() =>
      decodePromptLatestRunResult(value, "prompt:greeting"),
    ).toThrow();
  });
});
