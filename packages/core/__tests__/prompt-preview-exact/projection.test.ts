import { describe, expect, it } from "vitest";

import type { RequestPreview } from "../../src/request/preview/types";
import {
  projectRequestPreview,
  PromptPreviewResultLimitError,
} from "../../src/runtime-bridge/prompt-preview/projection";
import {
  PROMPT_PREVIEW_MAX_RESULT_BYTES,
  compactJson,
} from "../../src/runtime-bridge/prompt-preview/limits";

describe("request preview result limits", () => {
  it("accepts bounded redacted evidence and rejects aggregate string overflow", () => {
    expect(() =>
      projectRequestPreview("p", 1, preview(2_000, 250)),
    ).not.toThrow();
    expect(() =>
      projectRequestPreview("p", 1, preview(2_000, 600)),
    ).toThrow(PromptPreviewResultLimitError);
  });

  it("keeps the maximum adaptation cardinality within the compact bound", () => {
    const adaptations = Array.from({ length: 1_024 }, (_, index) => ({
      contributor: `context-${index}`,
      representation: "authored" as const,
      state: "selected" as const,
      selectedTokens: index,
    }));
    const value: RequestPreview = {
      ...preview(1, 1),
      adaptations,
    };
    const projected = projectRequestPreview("p", 1, value);

    expect(compactJson(projected).bytes).toBeLessThan(
      PROMPT_PREVIEW_MAX_RESULT_BYTES,
    );
  });
});

function preview(messageLength: number, warningCount: number): RequestPreview {
  return {
    status: "unknown",
    model: "preview-model",
    measurement: "incomplete",
    adaptations: [],
    warnings: Array.from({ length: warningCount }, (_, index) => ({
      code: `PREVIEW_WARNING_${index}`,
      message: "x".repeat(messageLength),
    })),
    diagnostics: [],
  };
}
