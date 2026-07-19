import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  adapter,
  createInMemoryObservabilityTransport,
  observe,
  orchestrateGenerate,
  prompt,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type OrchestrationSpec,
} from "@use-crux/core";
import type {
  AdapterResponse,
  AdapterSpec,
  StreamHandle,
} from "@use-crux/core/adapter";
import { __setAlsForTesting } from "../../src/observability/observe";

describe("managed generation result correlation", () => {
  afterEach(() => {
    __setAlsForTesting("auto");
    resetObservabilityRuntime();
  });

  it("returns the exact generation.call span identity", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    const result = await createFakeAdapter().generate(textPrompt, {
      model: "model-1",
      input: { message: "Hello" },
    });
    await observe.flush();

    const span = transport.records.find(
      (record) =>
        record.type === "span:start" && record.primitive === "generation.call",
    );
    expect(span).toBeDefined();
    expect(result._meta).toMatchObject({
      traceId: span?.traceId,
      spanId: span?.spanId,
    });
  });

  it("correlates structured generation to its exact generation.call span", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    const result = await createFakeAdapter().generate(structuredPrompt, {
      model: "model-1",
      input: { message: "Hello" },
    });
    await observe.flush();

    const span = transport.records.find(
      (record) =>
        record.type === "span:start" && record.primitive === "generation.call",
    );
    expect(result.object).toEqual({ answer: 42 });
    expect(result._meta).toMatchObject({
      traceId: span?.traceId,
      spanId: span?.spanId,
    });
  });

  it("exposes the finalized pair to onGenerate before public return", async () => {
    const onGenerate = vi.fn();
    const spec = generationSpec("text");

    const result = await orchestrateGenerate(
      {
        ...spec,
        promptConfig: { hooks: { onGenerate } } as typeof spec.promptConfig,
      },
      async () => ({
        text: "hello",
        _meta: { responseId: "provider-response" },
      }),
    );

    expect(onGenerate).toHaveBeenCalledOnce();
    expect(onGenerate.mock.calls[0]?.[1]).toMatchObject({
      _meta: {
        responseId: "provider-response",
        traceId: result._meta.traceId,
        spanId: result._meta.spanId,
      },
    });
    expect(result._meta.responseId).toBe("provider-response");
    expect(result._meta.responseId).not.toBe(result._meta.traceId);
  });

  it("preserves exact IDs and provider metadata without AsyncLocalStorage", async () => {
    __setAlsForTesting(null);
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    const result = await orchestrateGenerate(generationSpec("text"), async () => ({
      text: "hello",
      _meta: {
        responseId: "provider-response",
        actualModelId: "provider-model",
      },
    }));
    await observe.flush();

    const span = transport.records.find(
      (record) =>
        record.type === "span:start" && record.primitive === "generation.call",
    );
    expect(result._meta).toEqual({
      responseId: "provider-response",
      actualModelId: "provider-model",
      traceId: span?.traceId,
      spanId: span?.spanId,
    });
  });

  it("finalizes a frozen accessor-bearing generation payload", async () => {
    let getterReads = 0;
    const payload = Object.defineProperties(
      {
        text: "hello",
        _meta: { responseId: "provider-response" },
      },
      {
        lazy: {
          enumerable: false,
          get: () => {
            getterReads += 1;
            return "lazy";
          },
        },
      },
    );
    Object.freeze(payload);

    const result = await orchestrateGenerate(
      generationSpec("text"),
      async () => payload,
    );

    expect(result).not.toBe(payload);
    expect(result._meta).toMatchObject({
      responseId: "provider-response",
      traceId: expect.any(String),
      spanId: expect.any(String),
    });
    expect(getterReads).toBe(0);
  });

  it("rejects a non-object managed generation result at the owning boundary", async () => {
    await expect(
      orchestrateGenerate(
        generationSpec("text"),
        async () => "invalid result" as never,
      ),
    ).rejects.toThrowError(/Crux operation result boundary/);
  });
});

const textPrompt = prompt({
  id: "text-result-correlation",
  input: z.object({ message: z.string() }),
  prompt: ({ input }) => input.message,
});

const structuredPrompt = prompt({
  id: "structured-result-correlation",
  input: z.object({ message: z.string() }),
  output: z.object({ answer: z.number() }),
  prompt: ({ input }) => input.message,
});

interface FakeRawResponse {
  readonly id: string;
  readonly text: string;
}

function createFakeAdapter() {
  const spec: AdapterSpec<object, FakeRawResponse, AsyncIterable<string>> = {
    providerId: "fake-correlation",
    async call(_client, args) {
      const raw = {
        id: args.schemaParams ? "structured-response" : "provider-response",
        text: args.schemaParams ? '{"answer":42}' : "hello",
      };
      return { raw, extracted: responseFrom(raw) };
    },
    async stream(): Promise<StreamHandle<AsyncIterable<string>>> {
      return {
        rawStream: emptyStream(),
        extractTextDelta: (chunk) =>
          typeof chunk === "string" ? chunk : undefined,
        completion: async () => ({}),
      };
    },
    appendToolRound(messages) {
      return messages;
    },
    mapSettings() {
      return {};
    },
    wrapOutputSchema() {
      return { response_format: "json" };
    },
  };

  return adapter(spec)({});
}

function responseFrom(raw: FakeRawResponse): AdapterResponse {
  return {
    text: raw.text,
    responseId: raw.id,
    finishReason: "stop",
  };
}

async function* emptyStream(): AsyncIterable<string> {}

function generationSpec(
  outputMode: "text" | "object",
): OrchestrationSpec<Record<string, unknown>> {
  return {
    promptId: "support.reply",
    promptConfig: {} as OrchestrationSpec["promptConfig"],
    preparedArgs: { model: "model-1", messages: [] },
    model: "model-1",
    input: { message: "Hello" },
    operation: "generate",
    provider: "provider",
    outputMode,
  };
}
