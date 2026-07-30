import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  adapter,
  loopRuntimeAdapter,
  mergeInputBudget,
  prompt,
  RequestCompositionError,
  tool,
  type AdapterResponse,
  type AdapterSpec,
  type ExecutorRequest,
  type LoopRuntimePort,
  type RequestReceipt,
} from "../src";

const parityPrompt = prompt({
  id: "request-loop-parity",
  input: z.object({ message: z.string() }),
  prompt: ({ input }) => input.message,
});
const lookup = tool({
  description: "Look up one value.",
  input: z.object({ key: z.string() }),
  execute: ({ key }) => `value:${key}`,
});
const parityLoopPrompt = prompt({
  id: "request-loop-parity-tools",
  input: z.object({ message: z.string() }),
  prompt: ({ input }) => input.message,
  tools: { lookup },
});

const capacity = {
  contextWindow: 1_024,
  defaultOutputReserve: 128,
  countingConfidence: "estimated",
} as const;

function response(text: string): AdapterResponse {
  return {
    text,
    toolCalls: undefined,
    usage: undefined,
    finishReason: "stop",
    responseId: "response-1",
    actualModelId: "model-1",
    transportRetries: 2,
  };
}

interface ParityHarness {
  readonly generate: (
    message: string,
    max?: number,
  ) => Promise<{ readonly steps: readonly { readonly request?: RequestReceipt }[] }>;
  readonly generateLinked: () => Promise<{
    readonly steps: readonly { readonly request?: RequestReceipt }[];
  }>;
  readonly providerCalls: ReturnType<typeof vi.fn>;
}

function coreOwnedHarness(
  confidence: "estimated" | "conservative" = "estimated",
): ParityHarness {
  const providerCalls = vi.fn();
  let loopCalls = 0;
  let loopMode = false;
  const spec: AdapterSpec<object, object> = {
    providerId: "parity",
    ...(confidence === "estimated" ? { capacity: () => capacity } : {}),
    async call() {
      providerCalls();
      loopCalls += 1;
      return {
        raw: {},
        extracted:
          loopMode && loopCalls === 1
            ? {
                ...response(""),
                toolCalls: [
                  { id: "tool-1", name: "lookup", args: { key: "a" } },
                ],
              }
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
  const runtime = adapter(spec)({});
  return {
    generate: (message, max) =>
      runtime.generate(parityPrompt, {
        model: "model-1",
        input: { message },
        ...(max !== undefined ? { inputBudget: { max } } : {}),
      }),
    generateLinked: () => {
      loopMode = true;
      return runtime.generate(parityLoopPrompt, {
        model: "model-1",
        input: { message: "look it up" },
        maxSteps: 2,
      });
    },
    providerCalls,
  };
}

function sdkOwnedHarness(
  confidence: "estimated" | "conservative" = "estimated",
): ParityHarness {
  const providerCalls = vi.fn();
  const runtime: LoopRuntimePort<string, object> = {
    id: "parity-sdk",
    capabilities: { requestPlanning: "per-step" },
    ...(confidence === "estimated" ? { capacity: () => capacity } : {}),
    describeModel: (model) => ({ provider: "parity", modelId: model }),
    mapSettings: (settings) => ({ ...settings }),
    async runTextLoop(request) {
      const first = await request.planStep!({
        model: request.model,
        modelInfo: request.modelInfo,
        system: request.system,
        systemBlocks: request.systemBlocks,
        messages: request.messages ?? [
          { role: "user", content: request.prompt ?? "" },
        ],
      });
      providerCalls();
      const linked =
        request.tools !== undefined
          ? await request.planStep!({
              model: request.model,
              modelInfo: request.modelInfo,
              system: request.system,
              systemBlocks: request.systemBlocks,
              messages: [
                ...(request.messages ?? []),
                {
                  role: "assistant",
                  content: "",
                  metadata: {
                    toolCalls: [
                      {
                        id: "tool-1",
                        name: "lookup",
                        args: { key: "a" },
                      },
                    ],
                  },
                },
                {
                  role: "tool",
                  content: "value:a",
                  metadata: { toolCallId: "tool-1", toolName: "lookup" },
                },
              ],
            })
          : undefined;
      if (linked) providerCalls();
      return {
        status: "complete",
        raw: {},
        response: response("done"),
        messages: [
          ...(request.messages ?? []),
          { role: "assistant", content: "done" },
        ],
        steps: linked ? 2 : 1,
        stepFacts: [
          {
            request: first.receipt,
            content: linked ? [] : [{ type: "text", text: "done" }],
            finishReason: linked ? "tool-calls" : "stop",
            responseId: "response-1",
            modelId: "model-1",
            transportRetries: 2,
          },
          ...(linked
            ? [
                {
                  request: linked.receipt,
                  content: [{ type: "text" as const, text: "done" }],
                  finishReason: "stop" as const,
                  responseId: "response-2",
                  modelId: "model-1",
                  transportRetries: 2,
                },
              ]
            : []),
        ],
        meta: {},
      };
    },
    async runStructuredAttempt() {
      throw new Error("not used");
    },
    async runStream() {
      throw new Error("not used");
    },
  };
  const executor = loopRuntimeAdapter(runtime);
  return {
    generate: (message, max) =>
      executor.generate(parityPrompt, {
        model: "model-1",
        input: { message },
        ...(max !== undefined ? { inputBudget: { max } } : {}),
      }),
    generateLinked: () =>
      executor.generate(parityLoopPrompt, {
        model: "model-1",
        input: { message: "look it up" },
        maxSteps: 2,
      }),
    providerCalls,
  };
}

const harnesses = [
  ["Core-owned", coreOwnedHarness],
  ["SDK-owned", sdkOwnedHarness],
] as const;

describe.each(harnesses)("%s request planning", (_name, createHarness) => {
  it("receipts a small exact request", async () => {
    const harness = createHarness();
    const result = await harness.generate("hello");

    expect(result.steps[0]?.request).toMatchObject({
      model: "model-1",
      maxInputTokens: 812,
      measurement: "estimated",
      adaptations: [],
    });
    expect(harness.providerCalls).toHaveBeenCalledOnce();
  });

  it("reuses one sealed receipt across reported transport retries", async () => {
    const harness = createHarness();
    const result = await harness.generate("hello");

    expect((await result.steps[0]!.request!.inspect()).retryCount).toBe(2);
    expect(harness.providerCalls).toHaveBeenCalledOnce();
  });

  it("rejects oversized exact input before provider dispatch", async () => {
    const harness = createHarness();
    const error = await harness.generate("private input", 1).catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(RequestCompositionError);
    expect(error).toMatchObject({ code: "REQUEST_TOO_LARGE" });
    expect(harness.providerCalls).not.toHaveBeenCalled();
  });

  it("links a fresh receipt for each semantic tool-loop request", async () => {
    const harness = createHarness();
    const result = await harness.generateLinked();

    expect(result.steps).toHaveLength(2);
    expect(result.steps[1]?.request?.previousRequestId).toBe(
      result.steps[0]?.request?.id,
    );
    expect(result.steps[1]?.request?.inputTokens).toBeGreaterThan(
      result.steps[0]?.request?.inputTokens ?? 0,
    );
    const inspection = await result.steps[0]!.request!.inspect();
    expect(inspection.breakdown.contributions).toContainEqual(
      expect.objectContaining({ contributor: "tools" }),
    );
    expect(harness.providerCalls).toHaveBeenCalledTimes(2);
  });
});

it.each(harnesses)(
  "%s reports conservative measurement without a capacity profile",
  async (_name, createHarness) => {
    const result = await createHarness("conservative").generate("hello");

    expect(result.steps[0]?.request?.measurement).toBe("conservative");
  },
);

it("merges definition and invocation input budgets per field", () => {
  expect(
    mergeInputBudget(
      { optimizeAt: 400, max: 800 },
      { optimizeAt: 300 },
    ),
  ).toEqual({ optimizeAt: 300, max: 800 });
});

describe("SDK request-planning capability", () => {
  it("fails preflight when a loop runtime cannot expose provider-call boundaries", async () => {
    const runTextLoop = vi.fn();
    const runtime: LoopRuntimePort<string, object> = {
      id: "opaque-sdk",
      describeModel: (model) => ({ provider: "opaque", modelId: model }),
      mapSettings: (settings) => ({ ...settings }),
      runTextLoop,
      async runStructuredAttempt() {
        throw new Error("not used");
      },
      async runStream() {
        throw new Error("not used");
      },
    };

    const error = await loopRuntimeAdapter(runtime)
      .generate(parityPrompt, {
        model: "model-1",
        input: { message: "hello" },
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RequestCompositionError);
    expect(error).toMatchObject({ code: "INVALID_COMPOSITION" });
    expect(error.diagnostics).toEqual([
      expect.objectContaining({ code: "SDK_STEP_BOUNDARY_UNAVAILABLE" }),
    ]);
    expect(runTextLoop).not.toHaveBeenCalled();
  });
});
