import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  adapter,
  mergeInputBudget,
  prompt,
  type AdapterResponse,
  type AdapterSpec,
} from "../src";
import { agent } from "../src/agent";

const budgetPrompt = prompt({
  id: "request-budget",
  input: z.object({ message: z.string() }),
  prompt: ({ input }) => input.message,
});

function response(): AdapterResponse {
  return {
    text: "done",
    toolCalls: undefined,
    usage: undefined,
    finishReason: "stop",
    responseId: undefined,
    actualModelId: "budget-model",
  };
}

describe("request input budget", () => {
  it("reports conservative measurement when no adapter capability is available", async () => {
    const spec: AdapterSpec<object, object> = {
      providerId: "budget-test",
      call: async () => ({ raw: {}, extracted: response() }),
      stream: async () => {
        throw new Error("not used");
      },
      appendToolRound: (messages) => messages,
      mapSettings: () => ({}),
    };

    const result = await adapter(spec)({}).generate(budgetPrompt, {
      model: "unknown-model",
      input: { message: "hello" },
    });

    expect(result.steps[0]?.request?.measurement).toBe("conservative");
  });

  it("merges invocation overrides per field", () => {
    expect(
      mergeInputBudget(
        { optimizeAt: 400, max: 800 },
        { optimizeAt: 300 },
      ),
    ).toEqual({ optimizeAt: 300, max: 800 });
  });

  it("retains frozen definition-level defaults on agents", () => {
    const defined = agent({
      id: "budget-agent",
      prompt: budgetPrompt,
      inputBudget: { optimizeAt: 400, max: 500 },
    });

    expect(defined.inputBudget).toEqual({ optimizeAt: 400, max: 500 });
    expect(Object.isFrozen(defined.inputBudget)).toBe(true);
  });

  it("uses the model output reserve when maxTokens is absent", async () => {
    const countTokens = vi.fn(async () => 10);
    const spec: AdapterSpec<object, object> = {
      providerId: "budget-test",
      capacity: () => ({
        contextWindow: 1_000,
        defaultOutputReserve: 200,
        countingConfidence: "estimated",
      }),
      countTokens,
      call: async () => ({ raw: {}, extracted: response() }),
      stream: async () => {
        throw new Error("not used");
      },
      appendToolRound: (messages) => messages,
      mapSettings: () => ({}),
    };

    const result = await adapter(spec)({}).generate(budgetPrompt, {
      model: "budget-model",
      input: { message: "x".repeat(4_000) },
    });

    expect(result.steps[0]?.request).toMatchObject({
      inputTokens: 10,
      maxInputTokens: 768,
      measurement: "exact",
    });
    expect(countTokens).toHaveBeenCalledOnce();
  });

  it("skips authoritative counting when the conservative estimate safely fits", async () => {
    const countTokens = vi.fn(async () => 10);
    const spec: AdapterSpec<object, object> = {
      providerId: "budget-test",
      capacity: () => ({
        contextWindow: 1_000,
        defaultOutputReserve: 200,
        countingConfidence: "estimated",
      }),
      countTokens,
      call: async () => ({ raw: {}, extracted: response() }),
      stream: async () => {
        throw new Error("not used");
      },
      appendToolRound: (messages) => messages,
      mapSettings: () => ({}),
    };

    const result = await adapter(spec)({}).generate(budgetPrompt, {
      model: "budget-model",
      input: { message: "hello" },
    });

    expect(result.steps[0]?.request?.measurement).toBe("estimated");
    expect(countTokens).not.toHaveBeenCalled();
  });
});
