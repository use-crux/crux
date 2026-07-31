import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  adapter,
  prompt,
  RequestCompositionError,
  tool,
  type AdapterResponse,
  type AdapterSpec,
} from "../src";

const exactPrompt = prompt({
  id: "request-planner-exact",
  input: z.object({ message: z.string() }),
  system: "Answer precisely.",
  prompt: ({ input }) => input.message,
});

function response(
  text: string,
  toolCalls?: AdapterResponse["toolCalls"],
): AdapterResponse {
  return {
    text,
    toolCalls,
    usage: undefined,
    finishReason: "stop",
    responseId: "response-1",
    actualModelId: "model-1",
  };
}

function exactAdapter() {
  const spec: AdapterSpec<object, { readonly text: string }> = {
    providerId: "request-test",
    capacity: () => ({
      contextWindow: 1_024,
      defaultOutputReserve: 128,
      countingConfidence: "estimated",
    }),
    async call() {
      return {
        raw: { text: "done" },
        extracted: response("done"),
      };
    },
    async stream() {
      throw new Error("not used");
    },
    appendToolRound: (messages) => messages,
    mapSettings: () => ({}),
  };
  return adapter(spec)({});
}

describe("request planner", () => {
  it("links a fresh receipt for each Core-owned tool-loop step", async () => {
    const lookup = tool({
      description: "Look up one value.",
      input: z.object({ key: z.string() }),
      execute: ({ key }) => `value:${key}`,
    });
    const loopPrompt = prompt({
      id: "request-planner-loop",
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
      tools: { lookup },
    });
    let calls = 0;
    const spec: AdapterSpec<object, { readonly call: number }> = {
      providerId: "request-test",
      capacity: () => ({
        contextWindow: 4_096,
        defaultOutputReserve: 256,
        countingConfidence: "estimated",
      }),
      async call() {
        calls += 1;
        return {
          raw: { call: calls },
          extracted:
            calls === 1
              ? response("", [
                  { id: "tool-1", name: "lookup", args: { key: "a" } },
                ])
              : response("done"),
        };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound: (messages, assistant, results) => [
        ...messages,
        {
          role: "assistant",
          content: assistant.text,
          metadata: { toolCalls: assistant.toolCalls },
        },
        ...results.map((result) => ({
          role: "tool" as const,
          content: result.content,
          metadata: {
            toolCallId: result.toolCallId,
            toolName: result.name,
          },
        })),
      ],
      mapSettings: () => ({}),
    };

    const result = await adapter(spec)({}).generate(loopPrompt, {
      model: "model-1",
      input: { message: "look it up" },
      maxSteps: 2,
    });

    expect(result.steps).toHaveLength(2);
    expect(result.steps[1]?.request?.previousRequestId).toBe(
      result.steps[0]?.request?.id,
    );
    expect(result.steps[1]?.request?.id).not.toBe(
      result.steps[0]?.request?.id,
    );
    expect(result.steps[1]?.request?.inputTokens).toBeGreaterThan(
      result.steps[0]?.request?.inputTokens ?? 0,
    );
  });

  it("fails oversized exact requests before provider dispatch", async () => {
    const call = vi.fn(async () => ({
      raw: { text: "unexpected" },
      extracted: response("unexpected"),
    }));
    const spec: AdapterSpec<object, { readonly text: string }> = {
      providerId: "request-test",
      capacity: () => ({
        contextWindow: 1_024,
        defaultOutputReserve: 128,
        countingConfidence: "estimated",
      }),
      call,
      async stream() {
        throw new Error("not used");
      },
      appendToolRound: (messages) => messages,
      mapSettings: () => ({}),
    };
    const secret = "private-customer-message";

    const error = await adapter(spec)({})
      .generate(exactPrompt, {
        model: "model-1",
        input: { message: secret },
        inputBudget: { max: 1 },
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RequestCompositionError);
    expect(error).toMatchObject({ code: "REQUEST_TOO_LARGE" });
    expect(error.requestId).toMatch(/^request_/);
    expect(error.message).toContain(error.requestId);
    expect(error.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringContaining(error.requestId),
          code: "EXACT_REPRESENTATION_EXHAUSTED",
        }),
      ]),
    );
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(call).not.toHaveBeenCalled();
  });

  it("receipts a small exact request before provider dispatch", async () => {
    const result = await exactAdapter().generate(exactPrompt, {
      model: "model-1",
      input: { message: "hello" },
      settings: { maxTokens: 64 },
    });

    expect(result.steps[0]?.request).toMatchObject({
      model: "model-1",
      maxInputTokens: 876,
      measurement: "estimated",
      adaptations: [],
    });
    expect(result.steps[0]?.request.inputTokens).toBeGreaterThan(0);
  });
});
