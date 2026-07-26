/**
 * Adapter mapping tests via `scriptedGateway` — no `vi.mock('ai')`.
 *
 * Covers: resolved prompt → SDK args, tool merging, structured output +
 * validation retry through core's executor factory, fallback dispatch,
 * OpenRouter cost extraction, provider quirks (Anthropic schema/cache),
 * stream metrics, and the typed `completion` promise.
 */

import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { prompt as makePrompt } from "@use-crux/core";
import { fallback } from "@use-crux/core";
import { ValidationExhaustedError } from "@use-crux/core";
import { assertCanonicalResult } from "@use-crux/core/adapter/testing";
import type {
  PublishedStreamEvent,
  StreamCompletion,
} from "@use-crux/core/adapter";
import { publishOrdinaryStream } from "@use-crux/core/adapter";
import { createCruxRunId } from "@use-crux/core/observability";
import type { SystemBlock } from "@use-crux/core";
import {
  createCruxSpanId,
  createCruxTraceId,
} from "@use-crux/core/observability";
import type { LanguageModel, StopCondition, ToolSet } from "ai";
import { createCruxAi } from "../src";
import { createUIMessageStreamResponse } from "../src";
import { scriptedGateway, objectGenerationError } from "./scripted-gateway";
import {
  buildSystemArg,
  aiSdkStructuredCapabilities,
  isAnthropicModel,
} from "../src/provider-profile";

function model(id = "gpt-4o", provider = "openai"): LanguageModel {
  return {
    provider,
    modelId: id,
    specificationVersion: "v3",
  } as unknown as LanguageModel;
}

const textPrompt = makePrompt({
  id: "map-text",
  system: "You are terse.",
  prompt: ({ input }) => (input as { message: string }).message,
  input: z.object({ message: z.string() }),
});

const objectPrompt = makePrompt({
  id: "map-object",
  system: "Return JSON.",
  prompt: ({ input }) => (input as { message: string }).message,
  input: z.object({ message: z.string() }),
  output: z.object({ title: z.string(), count: z.number() }),
});

describe("generate — text mapping", () => {
  it("maps resolved prompt and settings into generateText args", async () => {
    const scripted = scriptedGateway({ generateText: [{ text: "hi there" }] });
    const ai = createCruxAi({ gateway: scripted.gateway });

    const result = await ai.generate(textPrompt, {
      model: model(),
      input: { message: "Say hi" },
      temperature: 0.3,
      maxTokens: 64,
      extra: {
        maxRetries: 2,
        headers: { "x-test": "yes" },
        providerOptions: { openai: { store: false } },
      },
    });

    expect(result.text).toBe("hi there");
    const args = scripted.calls.generateText[0]!;
    expect(args.system).toBe("You are terse.");
    expect(args.prompt).toBe("Say hi");
    expect(args.temperature).toBe(0.3);
    expect(args.maxOutputTokens).toBe(64);
    expect(args.maxRetries).toBe(2);
    expect(args.headers).toEqual({ "x-test": "yes" });
    expect(args.providerOptions).toEqual({ openai: { store: false } });
    expect((args.model as { modelId: string }).modelId).toBe("gpt-4o");
  });

  it("attaches normalized _meta to the SDK result", async () => {
    const scripted = scriptedGateway({
      generateText: [
        {
          text: "metered",
          usage: { inputTokens: 7, outputTokens: 13, totalTokens: 20 },
          providerMetadata: { openrouter: { usage: { cost: 0.0042 } } },
        },
      ],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });

    const result = await ai.generate(textPrompt, {
      model: model("gpt-5", "openrouter"),
      input: { message: "go" },
    });
    const meta = (result as unknown as { _meta: Record<string, unknown> })
      ._meta;

    expect((meta.usage as { totalTokens: number }).totalTokens).toBe(20);
    expect(meta.cost).toBe(0.0042);
    expect(meta.finishReason).toBe("stop");
  });

  it("returns the canonical envelope and preserves the raw SDK result", async () => {
    const scripted = scriptedGateway({
      generateText: [
        {
          text: "enveloped",
          usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
          providerMetadata: { openrouter: { usage: { cost: 0.0025 } } },
          finishReason: "stop",
        },
      ],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });

    const result = await ai.generate(textPrompt, {
      model: model("gpt-5", "openrouter"),
      input: { message: "go" },
    });

    assertCanonicalResult(result, {
      steps: [
        {
          text: "enveloped",
          usage: {
            inputTokens: 4,
            outputTokens: 6,
            totalTokens: 10,
            inputTokenDetails: {},
            outputTokenDetails: {},
          },
          finishReason: "stop",
          responseId: "scripted-resp",
          modelId: "scripted-model",
        },
      ],
    });
    expect(result.raw).toMatchObject({ text: "enveloped" });
    expect(result.cost).toBe(0.0025);
  });

  it("merges prompt tools with call-site tools (call-site wins)", async () => {
    const tooledPrompt = makePrompt({
      id: "map-tools",
      system: "use tools",
      prompt: ({ input }) => (input as { message: string }).message,
      input: z.object({ message: z.string() }),
      tools: {
        search: { description: "from prompt", execute: async () => "p" },
      },
    });
    const scripted = scriptedGateway({ generateText: [{ text: "done" }] });
    const ai = createCruxAi({ gateway: scripted.gateway });

    await ai.generate(tooledPrompt, {
      model: model(),
      input: { message: "go" },
      tools: {
        calc: { description: "from call", execute: async () => "c" },
      } as never,
    });

    const args = scripted.calls.generateText[0]!;
    const tools = args.tools as Record<string, unknown>;
    const callerTools = Object.keys(tools).filter(
      (name) => !name.startsWith("__crux_"),
    );
    expect(callerTools.sort()).toEqual(["calc", "search"]);
    // The internal tool-error reporter exists for repair but is never
    // advertised to the provider (activeTools restricts to caller tools).
    expect(tools).toHaveProperty("__crux_tool_error__");
    expect((args.activeTools as string[]).sort()).toEqual(["calc", "search"]);
  });

  it("maps neutral toolChoice and preserves native stopWhen settings to the SDK", async () => {
    const scripted = scriptedGateway({ generateText: [{ text: "done" }] });
    const ai = createCruxAi({ gateway: scripted.gateway });
    const configuredStopWhen: StopCondition<ToolSet> = () => false;
    const tooledPrompt = makePrompt({
      id: "map-neutral-tool-control",
      system: "Use tools.",
      prompt: ({ input }) => (input as { message: string }).message,
      input: z.object({ message: z.string() }),
      settings: {
        toolChoice: { tool: "search" },
      },
      tools: {
        search: { description: "Search", execute: async () => "result" },
      },
    });

    await ai.generate(tooledPrompt, {
      model: model(),
      input: { message: "go" },
      extra: { stopWhen: configuredStopWhen },
    });

    const args = scripted.calls.generateText[0]!;
    expect(args.toolChoice).toEqual({ type: "tool", toolName: "search" });
    expect(args.stopWhen).toEqual(
      expect.arrayContaining([configuredStopWhen]),
    );
    expect(args.stopWhen).toHaveLength(3);
  });

  it("maps portable reasoning to AI SDK v6 provider options", async () => {
    const scripted = scriptedGateway({ generateText: [{ text: "reasoned" }] });
    const ai = createCruxAi({ gateway: scripted.gateway });

    await ai.generate(textPrompt, {
      model: model("gpt-5", "openai"),
      input: { message: "go" },
      reasoning: "high",
      extra: { providerOptions: { openai: { store: false } } },
    });
    expect(scripted.calls.generateText[0]!.providerOptions).toEqual({
      openai: { store: false, reasoningEffort: "high" },
    });

    await ai.generate(textPrompt, {
      model: model("claude-sonnet-4-5", "anthropic"),
      input: { message: "go" },
      reasoning: "medium",
    });
    expect(scripted.calls.generateText[1]!.providerOptions).toEqual({
      anthropic: { thinking: { type: "enabled", budgetTokens: 8000 } },
    });

    await ai.generate(textPrompt, {
      model: model("gemini-3-pro-preview", "google"),
      input: { message: "go" },
      reasoning: "low",
    });
    expect(scripted.calls.generateText[2]!.providerOptions).toEqual({
      google: { thinkingConfig: { thinkingLevel: "low" } },
    });
  });
});

describe("generate — structured output + validation retry", () => {
  it("returns the typed object from a single-step generateText + Output.object", async () => {
    const scripted = scriptedGateway({
      generateText: [{ output: { title: "ok", count: 1 } }],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });

    const result = await ai.generate(objectPrompt, {
      model: model(),
      input: { message: "json please" },
    });

    expect(result.object).toEqual({ title: "ok", count: 1 });
    expect(scripted.calls.generateText).toHaveLength(1);
    // The compiled wire schema is installed as an Output, never authored Zod.
    expect(scripted.calls.generateText[0]!.output).toBeDefined();
    expect(scripted.calls.generateText[0]!.schema).toBeUndefined();
  });

  it("retries with corrective messages when the SDK throws a validation error", async () => {
    const onRetry = vi.fn();
    const scripted = scriptedGateway({
      generateText: [
        objectGenerationError('{"title":1}'),
        { output: { title: "fixed", count: 2 } },
      ],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });

    const result = await ai.generate(objectPrompt, {
      model: model(),
      input: { message: "json please" },
      validationRetry: { maxRetries: 2, onRetry },
    });

    expect(result.object).toEqual({ title: "fixed", count: 2 });
    expect(onRetry).toHaveBeenCalledTimes(1);

    const retryArgs = scripted.calls.generateText[1]!;
    const messages = retryArgs.messages as Array<{
      role: string;
      content: unknown;
    }>;
    expect(
      messages.some(
        (m) =>
          m.role === "assistant" && String(m.content).includes('{"title":1}'),
      ),
    ).toBe(true);
    expect(
      messages.some(
        (m) =>
          m.role === "user" && String(m.content).includes("Validation failed"),
      ),
    ).toBe(true);
    // The original prompt was converted into the message history.
    expect(messages[0]).toMatchObject({ role: "user", content: "json please" });
  });

  it("throws ValidationExhaustedError when retries run out", async () => {
    const scripted = scriptedGateway({
      generateText: [
        objectGenerationError("bad"),
        objectGenerationError("still bad"),
      ],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });

    await expect(
      ai.generate(objectPrompt, {
        model: model(),
        input: { message: "json please" },
        validationRetry: { maxRetries: 1 },
      }),
    ).rejects.toThrow(ValidationExhaustedError);
    expect(scripted.calls.generateText).toHaveLength(2);
  });

  it("rethrows non-validation provider errors untouched", async () => {
    const scripted = scriptedGateway({
      generateText: [Object.assign(new Error("boom"), { status: 500 })],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });

    await expect(
      ai.generate(objectPrompt, {
        model: model(),
        input: { message: "json please" },
        validationRetry: { maxRetries: 3 },
      }),
    ).rejects.toThrow("boom");
    expect(scripted.calls.generateText).toHaveLength(1);
  });
});

describe("generate — routing", () => {
  it("falls back to the next model and records a routing receipt", async () => {
    const scripted = scriptedGateway({
      generateText: [
        Object.assign(new Error("rate limited"), { status: 429 }),
        { text: "from backup" },
      ],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });

    const result = await ai.generate(textPrompt, {
      model: fallback([model("primary"), model("backup")]),
      input: { message: "go" },
    });

    expect(result.text).toBe("from backup");
    expect(scripted.calls.generateText).toHaveLength(2);
    expect(result.routing).toMatchObject({
      model: "backup",
      trace: [
        {
          kind: "fallback",
          attempts: [
            { model: "primary", status: "error" },
            { model: "backup", status: "ok" },
          ],
        },
      ],
    });
  });
});

describe("generateTextFn — routing", () => {
  it("forwards canonical media messages through one native generation call", async () => {
    const scripted = scriptedGateway({ generateText: [{ text: "described" }] });
    const ai = createCruxAi({ gateway: scripted.gateway });

    await ai.generateTextFn({
      model: model("vision"),
      messages: [{ role: "user", content: [{ type: "image", source: new Uint8Array([1]), mediaType: "image/png" }] }],
      maxOutputTokens: 1000,
    });

    expect(scripted.calls.generateText).toHaveLength(1);
    expect(scripted.calls.generateText[0]).toMatchObject({ maxOutputTokens: 1000, messages: [{ role: "user" }] });
  });

  it("falls back to the next model and preserves the routing receipt", async () => {
    const scripted = scriptedGateway({
      generateText: [
        Object.assign(new Error("rate limited"), { status: 429 }),
        { text: "from backup" },
      ],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });

    const result = await ai.generateTextFn({
      model: fallback([model("primary"), model("backup")]),
      prompt: "go",
    });

    expect(result.text).toBe("from backup");
    expect(scripted.calls.generateText).toHaveLength(2);
    expect(scripted.calls.generateText.map((args) => (args.model as { modelId?: unknown }).modelId)).toEqual([
      "primary",
      "backup",
    ]);
    expect(result.routing?.trace).toMatchObject([
      {
        kind: "fallback",
        attempts: [
          { model: "primary", status: "error" },
          { model: "backup", status: "ok" },
        ],
      },
    ]);
  });
});

describe("stream — metrics and completion", () => {
  it("includes routing receipts on stream completion", async () => {
    const scripted = scriptedGateway({
      streamText: [
        {
          chunks: ["ok"],
          finish: {
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          },
        },
      ],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });

    const result = await ai.stream(textPrompt, {
      model: fallback([model("primary"), model("backup")]),
      input: { message: "stream" },
    });
    let streamed = "";
    for await (const delta of result.textStream) streamed += delta;
    const completion = await result.completion;

    expect(streamed).toBe("ok");
    expect(completion.routing).toMatchObject({
      model: "primary",
      trace: [
        {
          kind: "fallback",
          attempts: [{ model: "primary", status: "ok" }],
        },
      ],
    });
  });

  it("falls back when a stream misses the first-token deadline", async () => {
    const scripted = scriptedGateway({
      streamText: [
        {
          chunks: ["late"],
          firstChunkDelayMs: 30,
          finish: {
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          },
        },
        {
          chunks: ["back", "up"],
          finish: {
            usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
          },
        },
      ],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });

    const result = await ai.stream(textPrompt, {
      model: fallback([model("primary"), model("backup")]),
      input: { message: "stream" },
      timeout: { firstToken: 5 },
    });
    const chunks: string[] = [];
    for await (const delta of result.textStream) chunks.push(delta);
    const completion = await result.completion;

    expect(chunks).toEqual(["back", "up"]);
    expect(scripted.calls.streamText.map((args) => (args.model as { modelId?: unknown }).modelId)).toEqual([
      "primary",
      "backup",
    ]);
    expect(completion.routing).toMatchObject({
      model: "backup",
      firstTokenAt: expect.any(Number),
      trace: [
        {
          kind: "fallback",
          attempts: [
            { model: "primary", status: "error", errorCategory: "timeout" },
            { model: "backup", status: "ok" },
          ],
        },
      ],
    });
  });

  it("does not fall back after the first stream token reaches the caller", async () => {
    const scripted = scriptedGateway({
      streamText: [
        {
          chunks: ["first"],
          errorAfterChunks: Object.assign(new Error("stream broke"), {
            status: 500,
          }),
        },
        {
          chunks: ["backup"],
        },
      ],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });

    const result = await ai.stream(textPrompt, {
      model: fallback([model("primary"), model("backup")]),
      input: { message: "stream" },
      timeout: { firstToken: 50 },
    });
    const chunks: string[] = [];
    let streamError: unknown;
    try {
      for await (const delta of result.textStream) chunks.push(delta);
    } catch (error) {
      streamError = error;
    }

    expect(chunks).toEqual(["first"]);
    expect(scripted.calls.streamText).toHaveLength(1);
    expect(streamError).toMatchObject({
      message: "stream broke",
      routing: {
        model: "primary",
        firstTokenAt: expect.any(Number),
        trace: [
          {
            kind: "fallback",
            midStreamFailure: true,
            attempts: [{ model: "primary", status: "ok" }],
          },
        ],
      },
    });
    await expect(result.completion).rejects.toMatchObject({
      routing: {
        firstTokenAt: expect.any(Number),
        trace: [
          {
            kind: "fallback",
            midStreamFailure: true,
          },
        ],
      },
    });
  });

  it("returns the canonical stream envelope with no provider handle", async () => {
    const scripted = scriptedGateway({
      streamText: [
        {
          chunks: ["hel", "lo"],
          finish: {
            usage: { inputTokens: 3, outputTokens: 9, totalTokens: 12 },
          },
        },
      ],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });

    const result = await ai.stream(textPrompt, {
      model: model(),
      input: { message: "stream" },
    });
    let streamed = "";
    for await (const delta of result.textStream) streamed += delta;
    const completion = await result.completion;

    expect(streamed).toBe("hello");
    expect("raw" in result).toBe(false);
    expect(completion.text).toBe("hello");
    expect(completion.finalStep.usage?.outputTokens).toBe(9);
    expect(completion.usage?.totalTokens).toBe(12);
  });

  it("warns for each structured stream request whose tools cannot be observed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const scripted = scriptedGateway({
      streamText: [
        { chunks: ['{"title":"ok","count":1}'], finish: { object: { title: "ok", count: 1 } } },
        { chunks: ['{"title":"again","count":2}'], finish: { object: { title: "again", count: 2 } } },
      ],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });

    try {
      const tools = {
        lookup: { description: "lookup", execute: async () => "result" },
      } as never;

      const first = await ai.stream(objectPrompt, {
        model: model(),
        input: { message: "stream json" },
        tools,
      });
      await first.completion;

      const second = await ai.stream(objectPrompt, {
        model: model(),
        input: { message: "stream json again" },
        tools,
      });
      await second.completion;

      expect(scripted.calls.streamText).toHaveLength(2);
      expect(scripted.calls.streamText[0]!.tools).toBeUndefined();
      expect(scripted.calls.streamText[1]!.tools).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[0]![0]).toContain(
        "streaming structured output with tools is not observable",
      );
      expect(warn.mock.calls[1]![0]).toContain(
        "streaming structured output with tools is not observable",
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("rejects cascade models with a clear error", async () => {
    const { cascade } = await import("@use-crux/core/routing");
    const ai = createCruxAi({ gateway: scriptedGateway().gateway });
    const tiers = cascade({
      tiers: [{ model: model() as never, maxAttempts: 1 }],
      evaluate: () => true,
    } as never);

    await expect(
      ai.stream(textPrompt, {
        model: tiers as unknown as ReturnType<typeof model>,
        input: { message: "go" },
      }),
    ).rejects.toThrow(/cascade\(\) does not support stream\(\)/);
  });
});

describe("UI-message helpers", () => {
  it("creates an SSE response from the logical stream", async () => {
    const runId = createCruxRunId();
    const operation = {
      traceId: createCruxTraceId(),
      spanId: createCruxSpanId(),
    };
    async function* events(): AsyncIterable<PublishedStreamEvent<unknown>> {
      yield { type: "text-delta", text: "hi" };
    }
    // Built from the logical stream, so a discarded attempt is unrepresentable
    // in the helper's input rather than merely filtered out downstream.
    const result = publishOrdinaryStream<unknown, unknown>({
      runId,
      meta: operation,
      events: events(),
      completion: async () =>
        ({ runId, _meta: operation, text: "hi" }) as unknown as StreamCompletion<unknown>,
    });

    const response = createUIMessageStreamResponse(result);

    expect(response.headers.get("content-type")).toContain(
      "text/event-stream",
    );
    expect(await response.text()).toContain("hi");
  });
});

describe("embedding — gateway-backed", () => {
  it("embeds through the gateway and maps usage", async () => {
    const scripted = scriptedGateway({
      embedMany: [{ embeddings: [[0.5, 0.5]], tokens: 6 }],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });

    const dense = ai.embedding({
      name: "test-embed",
      model: "embed-model" as never,
      dimensions: 2,
      maxInputTokens: 128,
    });
    const out = await dense.embedMany(["hello"]);

    expect(out).toEqual([[0.5, 0.5]]);
    expect(scripted.calls.embedMany[0]!.values).toEqual(["hello"]);
  });
});

describe("provider profile (pure quirks)", () => {
  it("detects Anthropic models directly and via OpenRouter", () => {
    expect(
      isAnthropicModel({
        provider: "anthropic.messages",
        modelId: "claude-sonnet-4-5",
      }),
    ).toBe(true);
    expect(
      isAnthropicModel({
        provider: "openrouter",
        modelId: "anthropic/claude-sonnet-4-5",
      }),
    ).toBe(true);
    expect(isAnthropicModel({ provider: "openai", modelId: "gpt-4o" })).toBe(
      false,
    );
  });

  it("emits cache breakpoint at cacheBoundary only for Anthropic models", () => {
    const blocks: SystemBlock[] = [
      { source: "prompt", text: "identity", providerCache: true },
      { source: "context:cached-a", text: "cached a", providerCache: true },
      {
        source: "context:cached-b",
        text: "cached b",
        providerCache: true,
        cacheBoundary: true,
      },
      { source: "context:x", text: "dynamic part", providerCache: false },
    ];
    const anthropic = buildSystemArg(blocks, "joined", {
      provider: "anthropic.messages",
      modelId: "claude-sonnet-4-5",
    });
    expect(Array.isArray(anthropic)).toBe(true);
    const messages = anthropic as Array<{
      content: string;
      providerOptions?: unknown;
    }>;
    expect(messages[0]!.providerOptions).toBeUndefined();
    expect(messages[1]!.providerOptions).toBeUndefined();
    expect(messages[2]!.providerOptions).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
    expect(messages[3]!.providerOptions).toBeUndefined();

    const openai = buildSystemArg(blocks, "joined", {
      provider: "openai",
      modelId: "gpt-4o",
    });
    expect(openai).toBe("joined");
  });

  it("returns plain system text when no cacheBoundary is present", () => {
    const blocks = Array.from({ length: 6 }, (_, i) => ({
      source: `context:${i}`,
      text: `block ${i}`,
      providerCache: true,
    }));
    const result = buildSystemArg(blocks, "joined", {
      provider: "anthropic",
      modelId: "claude",
    });
    expect(result).toBe("joined");
  });

  it("resolves per-provider structured-output capabilities, undefined when unverified", () => {
    const openai = aiSdkStructuredCapabilities({
      provider: "openai",
      modelId: "gpt-4o",
    });
    expect(openai?.id).toBe("ai-sdk.openai");
    // OpenAI accepts array bounds; nothing is dropped from the wire schema.
    expect(openai?.unsupportedKeywords).toEqual([]);

    const anthropic = aiSdkStructuredCapabilities({
      provider: "anthropic",
      modelId: "claude",
    });
    expect(anthropic?.id).toBe("ai-sdk.anthropic");
    // Anthropic rejects several validation keywords; the compiler drops them.
    expect(anthropic?.unsupportedKeywords).toContain("maxItems");

    // A model whose structured-output semantics are not verified resolves to
    // undefined so core fails before transport instead of inventing a default.
    expect(
      aiSdkStructuredCapabilities({ provider: "cohere", modelId: "command" }),
    ).toBeUndefined();
  });
});
