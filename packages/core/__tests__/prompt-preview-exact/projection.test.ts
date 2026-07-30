import { describe, expect, it } from "vitest";

import type { InspectResult } from "../../src/resolver/types";
import {
  projectPromptInspection,
  PromptPreviewResultLimitError,
} from "../../src/runtime-bridge/prompt-preview/projection";
import {
  PROMPT_PREVIEW_MAX_RESULT_BYTES,
  compactJson,
} from "../../src/runtime-bridge/prompt-preview/limits";

describe("exact prompt preview result limits", () => {
  it("accepts exact aggregate string bytes and rejects one byte of overflow", () => {
    const inspection = (length: number): InspectResult => {
      const text = "x".repeat(length);
      return {
        system: {
          total: text,
          totalTokens: 0,
          parts: [
            {
              source: "s",
              text,
              tokens: 0,
              skipped: false,
            },
          ],
        },
        prompt: undefined,
        totalTokens: 0,
        droppedContexts: [],
        excludedContexts: [],
        tokenBudget: undefined,
        tools: undefined,
      };
    };

    expect(() =>
      projectPromptInspection("p", 1, inspection(524_277)),
    ).not.toThrow();
    expect(() => projectPromptInspection("p", 1, inspection(524_278))).toThrow(
      PromptPreviewResultLimitError,
    );
  });

  it("accepts exactly 10,000 provenance segments and rejects 10,001", () => {
    const inspection = (count: number): InspectResult => ({
      system: { total: "", totalTokens: 0, parts: [] },
      prompt: {
        text: "x".repeat(count),
        tokens: 0,
        segments: Array.from({ length: count }, () => ({
          text: "x",
          dynamic: false,
        })),
      },
      totalTokens: 0,
      droppedContexts: [],
      excludedContexts: [],
      tokenBudget: undefined,
      tools: undefined,
    });

    expect(() =>
      projectPromptInspection("p", 1, inspection(10_000)),
    ).not.toThrow();
    expect(() => projectPromptInspection("p", 1, inspection(10_001))).toThrow(
      PromptPreviewResultLimitError,
    );
  });

  it("accepts exact compact result bytes and rejects one-byte overflow", () => {
    const inspection = (length: number): InspectResult => {
      const text = "\0".repeat(length);
      return {
        system: {
          total: text,
          totalTokens: 0,
          parts: [
            {
              source: "s",
              text,
              tokens: 0,
              skipped: false,
            },
          ],
        },
        prompt: undefined,
        totalTokens: 0,
        droppedContexts: [],
        excludedContexts: [],
        tokenBudget: undefined,
        tools: undefined,
      };
    };
    const sampleBytes = compactJson(
      projectPromptInspection("p", 1, inspection(1)),
    ).bytes;
    let textLength = Math.floor(
      (PROMPT_PREVIEW_MAX_RESULT_BYTES - sampleBytes) / 12,
    );
    let current = projectPromptInspection("p", 1, inspection(textLength));
    for (;;) {
      try {
        current = projectPromptInspection("p", 1, inspection(textLength + 1));
        textLength += 1;
      } catch (error) {
        expect(error).toBeInstanceOf(PromptPreviewResultLimitError);
        break;
      }
    }
    const remaining =
      PROMPT_PREVIEW_MAX_RESULT_BYTES - compactJson(current).bytes;
    const targetId = "p".repeat(remaining + 1);
    const exact = projectPromptInspection(targetId, 1, inspection(textLength));

    expect(compactJson(exact).bytes).toBe(PROMPT_PREVIEW_MAX_RESULT_BYTES);
    expect(() =>
      projectPromptInspection(`${targetId}p`, 1, inspection(textLength)),
    ).toThrow(PromptPreviewResultLimitError);
  });
});
