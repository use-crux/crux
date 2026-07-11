import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { prompt as makePrompt } from "@use-crux/core";
import { classifyProviderHttpError, CruxAdapterError, isCruxAdapterError } from "@use-crux/core/adapter";
import {
  describeNormalizedOutcomeBehavior,
  describeNormalizedOutcomeConformance,
  standardHttpErrorCases,
} from "@use-crux/core/adapter/testing";
import { createAnthropic } from "../src";
import { mapAnthropicStopReason } from "../src/response";
import { anthropicBehavioralHarness } from "./normalized-outcome-behavior-harness";

const textPrompt = makePrompt({ id: "anthropic-normalized", prompt: "Hi" });

describeNormalizedOutcomeBehavior({
  name: "anthropic",
  harness: anthropicBehavioralHarness(),
});

describeNormalizedOutcomeConformance({
  name: "anthropic",
  mapFinishReason: (raw: string) => mapAnthropicStopReason(raw),
  finishReasonCases: [
    { label: "end_turn", raw: "end_turn", expected: "stop" },
    { label: "max_tokens", raw: "max_tokens", expected: "length" },
    { label: "tool_use", raw: "tool_use", expected: "tool-calls" },
    { label: "refusal", raw: "refusal", expected: "refusal" },
  ],
  unrecognizedFinishReason: "pause_turn",
  modelSideBlocking: true,
  mapError: (error) => classifyProviderHttpError(error, "anthropic"),
  errorCases: standardHttpErrorCases(),
  unrecognizedError: new Error("mystery"),
});

describe("Anthropic normalized finish reasons", () => {
  const cases: Array<[string, string]> = [
    ["end_turn", "stop"],
    ["stop_sequence", "stop"],
    ["max_tokens", "length"],
    ["tool_use", "tool-calls"],
    ["refusal", "refusal"],
  ];

  for (const [stopReason, expected] of cases) {
    it(`maps stop_reason "${stopReason}" to "${expected}"`, async () => {
      const adapter = createAnthropic(scriptedClient({ stopReason }));
      const result = await adapter.generate(textPrompt, { model: "claude" });
      expect(result.finalStep.finishReason).toBe(expected);
    });
  }

  it("leaves an unknown stop_reason as 'unknown'", async () => {
    const adapter = createAnthropic(scriptedClient({ stopReason: "pause_turn" }));
    const result = await adapter.generate(textPrompt, { model: "claude" });
    expect(result.finalStep.finishReason).toBe("unknown");
  });
});

describe("Anthropic normalized provider errors", () => {
  it("classifies a 429 as a retryable rate-limit error", async () => {
    const adapter = createAnthropic(throwingClient({ status: 429, name: "RateLimitError" }));
    const error = await capture(adapter.generate(textPrompt, { model: "claude" }));
    expect(isCruxAdapterError(error)).toBe(true);
    expect((error as CruxAdapterError).providerError).toMatchObject({
      kind: "rate-limit",
      retryable: true,
    });
  });

  it("classifies a 400 as a non-retryable invalid-request error", async () => {
    const adapter = createAnthropic(throwingClient({ status: 400, name: "BadRequestError" }));
    const error = await capture(adapter.generate(textPrompt, { model: "claude" }));
    expect((error as CruxAdapterError).providerError).toMatchObject({
      kind: "invalid-request",
      retryable: false,
    });
  });

  it("classifies a 500 as a retryable provider error", async () => {
    const adapter = createAnthropic(throwingClient({ status: 500, name: "InternalServerError" }));
    const error = await capture(adapter.generate(textPrompt, { model: "claude" }));
    expect((error as CruxAdapterError).providerError).toMatchObject({
      kind: "provider-error",
      retryable: true,
    });
  });
});

describe("Anthropic abort/timeout normalization", () => {
  it("threads the caller AbortSignal into the SDK call", async () => {
    const seen: Array<AbortSignal | undefined> = [];
    const client = {
      messages: {
        create: async (_req: unknown, options?: { signal?: AbortSignal }) => {
          seen.push(options?.signal);
          return message("end_turn");
        },
      },
    } as unknown as Anthropic;
    const controller = new AbortController();
    await createAnthropic(client).generate(textPrompt, {
      model: "claude",
      signal: controller.signal,
    });
    expect(seen[0]).toBeInstanceOf(AbortSignal);
  });

  it("normalizes a user abort to kind 'aborted' (non-retryable)", async () => {
    const client = {
      messages: {
        create: async (_req: unknown, options?: { signal?: AbortSignal }) => {
          if (options?.signal?.aborted) {
            const err = new Error("Request was aborted.");
            err.name = "AbortError";
            throw err;
          }
          return message("end_turn");
        },
      },
    } as unknown as Anthropic;
    const controller = new AbortController();
    controller.abort();
    const error = await capture(
      createAnthropic(client).generate(textPrompt, {
        model: "claude",
        signal: controller.signal,
      }),
    );
    expect((error as CruxAdapterError).providerError).toMatchObject({
      kind: "aborted",
      retryable: false,
    });
  });

  it("normalizes a step timeout to kind 'timeout' (retryable)", async () => {
    const client = {
      messages: {
        create: () => new Promise<never>(() => {}),
      },
    } as unknown as Anthropic;
    const error = await capture(
      createAnthropic(client).generate(textPrompt, {
        model: "claude",
        timeout: { stepMs: 20 },
      }),
    );
    expect((error as CruxAdapterError).providerError.kind).toBe("timeout");
    expect((error as CruxAdapterError).providerError.retryable).toBe(true);
  });
});

describe("Anthropic completed tool calls (generate)", () => {
  it("assembles the completed tool call and runs the tool loop to completion", async () => {
    const executed: unknown[] = [];
    const emissions = [
      messageWithTool("call_1", "echo", { value: "hi" }),
      message("end_turn", "done"),
    ];
    const client = {
      messages: {
        create: async () => emissions.shift(),
      },
    } as unknown as Anthropic;

    const result = await createAnthropic(client).generate(textPrompt, {
      model: "claude",
      maxSteps: 5,
      tools: {
        echo: {
          description: "echo",
          parameters: { type: "object", properties: {} },
          execute: async (args: unknown) => {
            executed.push(args);
            return "ok";
          },
        },
      },
    });

    expect(result.text).toBe("done");
    expect(executed).toEqual([{ value: "hi" }]);
  });
});

function scriptedClient(opts: { stopReason: string }): Anthropic {
  return {
    messages: {
      create: async () => message(opts.stopReason),
    },
  } as unknown as Anthropic;
}

function throwingClient(shape: { status: number; name: string }): Anthropic {
  return {
    messages: {
      create: async () => {
        const err = new Error(`anthropic ${shape.status}`) as Error & {
          status: number;
        };
        err.name = shape.name;
        err.status = shape.status;
        throw err;
      },
    },
  } as unknown as Anthropic;
}

function message(stopReason: string, text = "hello"): unknown {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-actual",
    content: [{ type: "text", text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 5, output_tokens: 2 },
  };
}

function messageWithTool(
  id: string,
  name: string,
  input: Record<string, unknown>,
): unknown {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-actual",
    content: [{ type: "tool_use", id, name, input }],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 5, output_tokens: 2 },
  };
}

async function capture(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    throw new Error("expected the call to reject");
  } catch (error) {
    return error;
  }
}
