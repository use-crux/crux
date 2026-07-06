import { describe, expect, it } from "vitest";
import {
  assertCanonicalResult,
  type CanonicalResultStepExpectation,
} from "../../adapter/testing";

const firstStep: CanonicalResultStepExpectation = {
  text: "hello ",
  usage: {
    inputTokens: 2,
    outputTokens: 3,
    totalTokens: 5,
    inputTokenDetails: { cacheReadTokens: 1 },
    outputTokenDetails: {},
  },
  finishReason: "tool_calls",
  responseId: "resp_1",
  modelId: "model-a",
};

const finalStep: CanonicalResultStepExpectation = {
  text: "world",
  usage: {
    inputTokens: 4,
    outputTokens: 5,
    totalTokens: 9,
    inputTokenDetails: { cacheWriteTokens: 2 },
    outputTokenDetails: { reasoningTokens: 3 },
  },
  finishReason: "stop",
  responseId: "resp_2",
  modelId: "model-a",
};

describe("assertCanonicalResult", () => {
  it("accepts a canonical envelope with accumulated text, usage, and finalStep data", () => {
    const result = {
      text: "hello world",
      usage: {
        inputTokens: 6,
        outputTokens: 8,
        totalTokens: 14,
        inputTokenDetails: { cacheReadTokens: 1, cacheWriteTokens: 2 },
        outputTokenDetails: { reasoningTokens: 3 },
      },
      cost: 0.012,
      steps: 2,
      finalStep,
      messages: [{ role: "assistant", content: "hello world" }],
      raw: { id: "raw_1" },
      _meta: { finishReason: "stop" },
    };

    expect(() =>
      assertCanonicalResult(result, { steps: [firstStep, finalStep] }),
    ).not.toThrow();
  });

  it("rejects fabricated detail token counts that no step reported", () => {
    const result = {
      text: "world",
      usage: {
        inputTokens: 4,
        outputTokens: 5,
        totalTokens: 9,
        inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 2 },
        outputTokenDetails: { reasoningTokens: 3 },
      },
      steps: 1,
      finalStep: {
        ...finalStep,
        usage: {
          ...finalStep.usage,
          inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 2 },
        },
      },
      messages: [{ role: "assistant", content: "world" }],
      raw: { id: "raw_1" },
      _meta: { finishReason: "stop" },
    };

    expect(() => assertCanonicalResult(result, { steps: [finalStep] })).toThrow(
      "result.usage.inputTokenDetails.cacheReadTokens",
    );
  });

  it("accepts omitted accumulated usage when any expected step is unmetered", () => {
    const result = {
      text: "hello world",
      steps: 2,
      finalStep,
      messages: [{ role: "assistant", content: "hello world" }],
      raw: { id: "raw_1" },
      _meta: { finishReason: "stop" },
    };

    expect(() =>
      assertCanonicalResult(result, {
        steps: [{ ...firstStep, usage: undefined }, finalStep],
      }),
    ).not.toThrow();
  });
});
