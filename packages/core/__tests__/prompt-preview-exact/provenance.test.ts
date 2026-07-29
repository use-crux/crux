import { describe, expect, it } from "vitest";

import type { ContextTextSegment } from "../../src/prompt/context-types";
import type { InspectResult } from "../../src/resolver/types";
import { projectPromptInspection } from "../../src/runtime-bridge/prompt-preview/projection";

describe("exact prompt preview provenance", () => {
  it("maps valid Unicode segments to half-open UTF-16 offsets", () => {
    const result = projectPromptInspection(
      "prompt:unicode",
      1,
      inspection("A😀β", [
        {
          text: "A😀",
          dynamic: false,
          source: "prompt:unicode",
          observedAt: 7,
          sourceVersion: "v1",
        },
        { text: "β", dynamic: true },
      ]),
    );

    expect(result).toMatchObject({
      inspection: {
        prompt: {
          text: "A😀β",
          segments: [
            {
              kind: "static",
              startUtf16: 0,
              endUtf16: 3,
              source: "prompt:unicode",
              observedAt: 7,
              sourceVersion: "v1",
            },
            { kind: "dynamic", startUtf16: 3, endUtf16: 4 },
          ],
        },
      },
    });
  });

  it.each([
    ["missing", undefined],
    ["non-reconstructing", [{ text: "different", dynamic: false }]],
    ["invalid metadata", [{ text: "text", dynamic: false, source: "" }]],
  ])("falls back atomically for %s provenance", (_name, segments) => {
    const result = projectPromptInspection(
      "prompt:fallback",
      1,
      inspection("text", segments),
    );

    expect(result).toMatchObject({
      inspection: {
        prompt: {
          segments: [{ kind: "unknown", startUtf16: 0, endUtf16: 4 }],
        },
      },
    });
  });

  it("uses no provenance segment for empty text", () => {
    const result = projectPromptInspection(
      "prompt:empty",
      1,
      inspection("", [{ text: "", dynamic: true }]),
    );

    expect(result).toMatchObject({
      inspection: { prompt: { text: "", segments: [] } },
    });
  });
});

function inspection(
  text: string,
  segments: readonly ContextTextSegment[] | undefined,
): InspectResult {
  return {
    system: { total: "", totalTokens: 0, parts: [] },
    prompt: { text, tokens: 0, segments },
    totalTokens: 0,
    droppedContexts: [],
    excludedContexts: [],
    tokenBudget: undefined,
    tools: undefined,
  };
}
