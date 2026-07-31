import { describe, expect, it } from "vitest";

import { decodePromptPreviewBrowserResponse } from "../wire";

const ready = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  status: "ready",
  peer: {
    peerId: "peer",
    runtimeName: "App",
    environment: "node",
  },
  catalogueRevision: 4,
  preview: {
    status: "fits",
    model: "provider:model",
    inputTokens: 120,
    maxInputTokens: 1_000,
    measurement: "estimated",
    adaptations: [],
    warnings: [],
    diagnostics: [],
  },
  contributions: [
    { id: "prompt:writer", boundary: "required", representations: ["full"] },
    {
      id: "context:style",
      boundary: "sticky",
      representations: ["full", "summary"],
    },
    {
      id: "context:examples",
      boundary: "elastic",
      representations: ["full", "omitted"],
    },
  ],
  ...overrides,
});

describe("Prompt preview ready wire", () => {
  it("accepts a bounded redacted preview and contribution map", () => {
    expect(
      decodePromptPreviewBrowserResponse(ready(), "prompt:writer"),
    ).toMatchObject({ status: "ready" });
  });

  it("rejects unknown boundaries, representations, and wire fields", () => {
    expect(() =>
      decodePromptPreviewBrowserResponse(
        ready({
          contributions: [
            {
              id: "context:x",
              boundary: "optional",
              representations: ["full"],
            },
          ],
        }),
        "prompt:writer",
      ),
    ).toThrow();
    expect(() =>
      decodePromptPreviewBrowserResponse(
        ready({
          contributions: [
            {
              id: "context:x",
              boundary: "sticky",
              representations: ["private"],
            },
          ],
        }),
        "prompt:writer",
      ),
    ).toThrow();
    expect(() =>
      decodePromptPreviewBrowserResponse(
        ready({ unexpected: true }),
        "prompt:writer",
      ),
    ).toThrow();
  });

  it("rejects contributor and adaptation cardinality overflow", () => {
    const contribution = {
      id: "context:x",
      boundary: "required",
      representations: ["full"],
    };
    expect(() =>
      decodePromptPreviewBrowserResponse(
        ready({
          contributions: Array.from({ length: 1_025 }, () => contribution),
        }),
        "prompt:writer",
      ),
    ).toThrow();
  });
});
