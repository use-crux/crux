import {
  createInMemoryObservabilityTransport,
  observe,
  resetHooks,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "@use-crux/core";
import { withCostTracking } from "@use-crux/core/cost";
import { afterEach, describe, expect, it } from "vitest";

import { createCruxAi } from "../src";
import type { SdkGateway } from "../src/gateway";
import { scriptedGateway } from "./scripted-gateway";
import {
  cachedPrompt,
  cachedStructuredPrompt,
  generationStreamSpan,
  installPlugins,
  installSemanticCache,
  model,
  structuredPrompt,
  textPrompt,
} from "./stream-result-correlation.fixtures";

describe("AI SDK stream result correlation", () => {
  afterEach(() => {
    resetHooks();
    resetObservabilityRuntime();
  });

  it("copies the executor pair to the canonical text handle and completion", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const scripted = scriptedGateway({
      streamText: [
        {
          chunks: ["unchanged ", "chunks"],
          finish: {
            usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
            finishReason: "stop",
          },
        },
      ],
    });
    const result = await createCruxAi({ gateway: scripted.gateway }).stream(
      textPrompt,
      { model: model(), input: { message: "Stream" } },
    );
    await observe.flush();

    const span = generationStreamSpan(transport.records);
    expect(result._meta).toMatchObject({
      traceId: span?.traceId,
      spanId: span?.spanId,
    });

    const chunks: string[] = [];
    for await (const chunk of result.textStream) chunks.push(chunk);
    const completion = await result.completion;

    expect(chunks).toEqual(["unchanged ", "chunks"]);
    expect(chunks.every((chunk) => typeof chunk === "string")).toBe(true);
    expect(completion._meta).toMatchObject({
      ...result._meta,
      finishReason: "stop",
      responseId: "scripted-resp",
    });
    expect(completion.usage?.totalTokens).toBe(5);
    expect(
      (completion._meta as typeof completion._meta & {
        streaming?: { totalChunks?: number };
      }).streaming?.totalChunks,
    ).toBe(2);
  });

  it("keeps one pair for a structured SDK stream", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const scripted = scriptedGateway({
      streamText: [
        {
          chunks: ['{"answer":', "42}"],
          finish: {
            object: { answer: 42 },
            usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
          },
        },
      ],
    });
    const result = await createCruxAi({ gateway: scripted.gateway }).stream(
      structuredPrompt,
      { model: model(), input: { message: "Answer" } },
    );
    await observe.flush();

    const span = generationStreamSpan(transport.records);
    for await (const _chunk of result.textStream) {
      // Drain the public stream before reading its completion envelope.
    }
    const completion = await result.completion;

    expect(result._meta).toMatchObject({
      traceId: span?.traceId,
      spanId: span?.spanId,
    });
    expect(completion._meta).toMatchObject(result._meta);
    expect(completion.usage?.totalTokens).toBe(3);
    expect(completion.object).toEqual({ answer: 42 });
  });

  it("points legacy raw metadata at the observed completion promise", async () => {
    const scripted = scriptedGateway({
      streamText: [{ chunks: ["legacy"] }],
    });
    const result = await createCruxAi({ gateway: scripted.gateway }).stream(
      textPrompt,
      { model: model(), input: { message: "Stream" } },
    );
    const legacy = (result.raw as { _meta?: { _streamCompletion?: unknown } })
      ._meta?._streamCompletion;
    const publicLegacy = (
      result._meta as typeof result._meta & { _streamCompletion?: unknown }
    )._streamCompletion;

    for await (const _chunk of result.textStream) {
      // Drain to let both public completion projections settle.
    }
    const executorCompletion = await (legacy as Promise<{
      _meta: typeof result._meta;
    }>);
    const canonicalCompletion = await result.completion;

    expect(executorCompletion._meta).toMatchObject({
      traceId: result._meta.traceId,
      spanId: result._meta.spanId,
    });
    expect(publicLegacy).toBe(legacy);
    expect(canonicalCompletion._meta).toMatchObject(executorCompletion._meta);
  });

  it("restamps an SDK replay with the current stream pair", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    installSemanticCache();
    const scripted = scriptedGateway({
      generateText: [{ text: "cached SDK stream", finishReason: "stop" }],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });
    const fill = await ai.generate(cachedPrompt, {
      model: model(),
      input: { message: "Cache me" },
    });
    const replay = await ai.stream(cachedPrompt, {
      model: model(),
      input: { message: "Cache me" },
    });
    await observe.flush();

    const streamSpan = generationStreamSpan(transport.records);
    expect(replay._meta).toMatchObject({
      traceId: streamSpan?.traceId,
      spanId: streamSpan?.spanId,
    });
    expect(replay._meta).not.toEqual({
      traceId: fill._meta.traceId,
      spanId: fill._meta.spanId,
    });

    const chunks: string[] = [];
    for await (const chunk of replay.textStream) chunks.push(chunk);
    const completion = await replay.completion;

    expect(chunks.join("")).toBe("cached SDK stream");
    expect(completion._meta).toMatchObject(replay._meta);
    expect(
      (completion._meta as typeof completion._meta & {
        semanticCache?: { hit?: boolean; replay?: boolean };
      }).semanticCache,
    ).toMatchObject({ hit: true, replay: true });
    expect(scripted.calls.streamText).toHaveLength(0);
  });

  it("records SDK stream completion cost exactly once", async () => {
    const tracker = withCostTracking();
    installPlugins(tracker.asPlugin());
    const scripted = scriptedGateway({
      streamText: [
        {
          chunks: ["metered"],
          finish: {
            usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
            providerMetadata: { test: { cost: 0.25 } },
          },
        },
      ],
    });
    const result = await createCruxAi({ gateway: scripted.gateway }).stream(
      textPrompt,
      { model: model(), input: { message: "Meter" } },
    );
    await result.completion;
    await Promise.resolve();

    expect(tracker.getReport().total).toMatchObject({
      calls: 1,
      cost: 0.25,
      totalTokens: 10,
    });
  });

  it("preserves structured output through SDK cache replay", async () => {
    installSemanticCache();
    const scripted = scriptedGateway({
      generateText: [{ output: { answer: 42 }, finishReason: "stop" }],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });
    await ai.generate(cachedStructuredPrompt, {
      model: model(),
      input: { message: "Structured cache" },
    });
    const replay = await ai.stream(cachedStructuredPrompt, {
      model: model(),
      input: { message: "Structured cache" },
    });

    const chunks: string[] = [];
    for await (const chunk of replay.textStream) chunks.push(chunk);
    const completion = await replay.completion;

    expect(chunks.join("")).toBe('{"answer":42}');
    expect(completion.object).toEqual({ answer: 42 });
    expect(completion._meta).toMatchObject(replay._meta);
    expect(scripted.calls.streamText).toHaveLength(0);
  });

  it("keeps immutable raw legacy metadata from breaking the public stream", async () => {
    const scripted = scriptedGateway({
      streamText: [{ chunks: ["immutable"] }],
    });
    const result = await createCruxAi({
      gateway: immutableRawGateway(scripted.gateway),
    }).stream(textPrompt, {
      model: model(),
      input: { message: "Stream" },
    });
    const publicLegacy = (
      result._meta as typeof result._meta & {
        _streamCompletion?: Promise<{ _meta: typeof result._meta }>;
      }
    )._streamCompletion;

    const completion = await result.completion;
    expect(completion._meta).toMatchObject(result._meta);
    expect((await publicLegacy)?._meta).toMatchObject({
      traceId: result._meta.traceId,
      spanId: result._meta.spanId,
    });
  });
});

function immutableRawGateway(gateway: SdkGateway): SdkGateway {
  return {
    ...gateway,
    streamText(args) {
      const raw = gateway.streamText(args) as unknown as Record<string, unknown>;
      Object.defineProperty(raw, "_meta", {
        configurable: false,
        enumerable: true,
        writable: false,
        value: Object.freeze({
          _streamCompletion: Promise.resolve({ finishReason: "provider" }),
        }),
      });
      return Object.freeze(raw) as unknown as ReturnType<
        SdkGateway["streamText"]
      >;
    },
  };
}
