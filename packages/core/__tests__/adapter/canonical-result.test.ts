import { describe, expect, it } from "vitest";
import {
  assertCanonicalResult,
  type CanonicalResultStepExpectation,
} from "../../src/adapter/testing";
import { createCruxRunId } from "../../src/observability";

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

const publicStep = (step: CanonicalResultStepExpectation) => ({
  ...step,
  content: step.text ? [{ type: "text" as const, text: step.text }] : [],
  warnings: [],
});

describe("assertCanonicalResult", () => {
  it("accepts a canonical envelope with accumulated text, usage, and finalStep data", () => {
    const result = {
      runId: createCruxRunId(),
      text: "hello world",
      content: [{ type: "text", text: "hello world" }],
      usage: {
        inputTokens: 6,
        outputTokens: 8,
        totalTokens: 14,
        inputTokenDetails: { cacheReadTokens: 1, cacheWriteTokens: 2 },
        outputTokenDetails: { reasoningTokens: 3 },
      },
      cost: 0.012,
      steps: [publicStep(firstStep), publicStep(finalStep)],
      finalStep: publicStep(finalStep),
      messages: [{ role: "assistant", content: "hello world" }],
      warnings: [],
      raw: { id: "raw_1" },
      _meta: { finishReason: "stop" },
    };

    expect(() =>
      assertCanonicalResult(result, { steps: [firstStep, finalStep] }),
    ).not.toThrow();
  });

  it("rejects fabricated detail token counts that no step reported", () => {
    const result = {
      runId: createCruxRunId(),
      text: "world",
      content: [{ type: "text", text: "world" }],
      usage: {
        inputTokens: 4,
        outputTokens: 5,
        totalTokens: 9,
        inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 2 },
        outputTokenDetails: { reasoningTokens: 3 },
      },
      steps: [publicStep(finalStep)],
      finalStep: {
        ...publicStep(finalStep),
        usage: {
          ...finalStep.usage,
          inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 2 },
        },
      },
      messages: [{ role: "assistant", content: "world" }],
      warnings: [],
      raw: { id: "raw_1" },
      _meta: { finishReason: "stop" },
    };

    expect(() => assertCanonicalResult(result, { steps: [finalStep] })).toThrow(
      "result.usage.inputTokenDetails.cacheReadTokens",
    );
  });

  it("accepts omitted accumulated usage when any expected step is unmetered", () => {
    const result = {
      runId: createCruxRunId(),
      text: "hello world",
      content: [{ type: "text", text: "hello world" }],
      steps: [publicStep(firstStep), publicStep(finalStep)],
      finalStep: publicStep(finalStep),
      messages: [{ role: "assistant", content: "hello world" }],
      warnings: [],
      raw: { id: "raw_1" },
      _meta: { finishReason: "stop" },
    };

    expect(() =>
      assertCanonicalResult(result, {
        steps: [{ ...firstStep, usage: undefined }, finalStep],
      }),
    ).not.toThrow();
  });

  it("rejects an envelope without its authoritative run ID", () => {
    const result = {
      text: "world",
      content: [{ type: "text", text: "world" }],
      steps: [publicStep(finalStep)],
      finalStep: publicStep(finalStep),
      messages: [],
      warnings: [],
      raw: {},
      _meta: {},
    };

    expect(() => assertCanonicalResult(result)).toThrow("result.runId");
  });
});
