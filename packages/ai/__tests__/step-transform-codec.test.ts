/** Native/canonical model-step edit contract at the AI SDK middleware seam. */

import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import type {
  LanguageModelV3Content,
  LanguageModelV3GenerateResult,
} from "@ai-sdk/provider";
import { isPolicyTerminal } from "@use-crux/core/safety";
import { createStepTransformModelWrapper } from "../src/sdk-codec/step-transform";

function generateResult(
  content: LanguageModelV3Content[],
): LanguageModelV3GenerateResult {
  return {
    content,
    finishReason: { unified: "tool-calls", raw: "native-finish" },
    usage: {
      inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 5, text: 2, reasoning: 3 },
      raw: { providerTokens: 8 },
    },
    providerMetadata: { example: { traceId: "trace-1" } },
    request: { body: { prompt: "raw request" } },
    response: {
      body: { output: "raw response" },
      headers: { "x-request-id": "request-1" },
    },
    warnings: [{ type: "other", message: "native warning" }],
  };
}

describe("AI SDK step transform codec", () => {
  it("maps canonical indexes back to native parts with shallow identity-safe edits", async () => {
    const source = {
      type: "source" as const,
      sourceType: "url" as const,
      id: "source-1",
      url: "https://example.test",
    };
    const reasoning = { type: "reasoning" as const, text: "unsafe reasoning" };
    const image = {
      type: "file" as const,
      mediaType: "image/png",
      data: "aW1hZ2U=",
    };
    const text = { type: "text" as const, text: "unsafe answer" };
    const toolCall = {
      type: "tool-call" as const,
      toolCallId: "call-1",
      toolName: "lookup",
      input: "{}",
    };
    const original = generateResult([source, reasoning, image, text, toolCall]);
    const model = new MockLanguageModelV3({ doGenerate: async () => original });
    const wrapped = createStepTransformModelWrapper({
      transform: async (step) => {
        expect(step.index).toBe(0);
        expect(step.content.map((part) => part.type)).toEqual([
          "reasoning",
          "image",
          "text",
          "tool-call",
        ]);
        return [
          { kind: "replace-text", partIndex: 0, text: "safe reasoning" },
          { kind: "remove", partIndex: 1 },
          { kind: "replace-text", partIndex: 2, text: "safe answer" },
        ];
      },
    })(model);

    const guarded = await wrapped.doGenerate({} as never);

    expect(guarded).not.toBe(original);
    expect(guarded.content).toEqual([
      source,
      { type: "reasoning", text: "safe reasoning" },
      { type: "text", text: "safe answer" },
      toolCall,
    ]);
    expect(guarded.content[0]).toBe(source);
    expect(guarded.content[3]).toBe(toolCall);
    expect(guarded.finishReason).toBe(original.finishReason);
    expect(guarded.usage).toBe(original.usage);
    expect(guarded.providerMetadata).toBe(original.providerMetadata);
    expect(guarded.request).toBe(original.request);
    expect(guarded.response).toBe(original.response);
    expect(guarded.warnings).toBe(original.warnings);
    expect(original.content).toEqual([
      source,
      reasoning,
      image,
      text,
      toolCall,
    ]);
  });

  it("treats a tool-call edit as a terminal transformer contract failure", async () => {
    const original = generateResult([
      { type: "text", text: "answer" },
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "lookup",
        input: "{}",
      },
    ]);
    const wrapped = createStepTransformModelWrapper({
      transform: async () => [{ kind: "remove", partIndex: 1 }],
    })(new MockLanguageModelV3({ doGenerate: async () => original }));

    try {
      await wrapped.doGenerate({} as never);
      expect.fail("Expected the invalid tool-call edit to fail.");
    } catch (error) {
      expect(isPolicyTerminal(error)).toBe(true);
      expect(error).toMatchObject({ name: "SafetyResultError" });
    }
  });
});
