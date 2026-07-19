import { afterEach, describe, expect, it } from "vitest";

import {
  createInMemoryObservabilityTransport,
  observe,
  orchestrateGenerate,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type GenerateResult,
  type OrchestrationSpec,
} from "@use-crux/core";
import {
  defineCompletedOperation,
  runCompletedMediaOperation,
} from "@use-crux/core/adapter";

describe("completed media result correlation", () => {
  afterEach(() => resetObservabilityRuntime());

  it("returns the exact media span identity", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    const result = await runCompletedMediaOperation({
      definition: valueOperation(),
      provider: "test",
      operation: "generateImage",
      model: "image-model",
      input: { value: "image" },
    });
    await observe.flush();

    const span = transport.records.find(
      (record) =>
        record.type === "span:start" &&
        record.primitive === "media.generate_image",
    );
    expect(span).toBeDefined();
    expect(result._meta).toEqual({
      traceId: span?.traceId,
      spanId: span?.spanId,
    });
  });

  it.each([
    ["generateImage", "media.generate_image"],
    ["transcribe", "media.transcribe"],
    ["generateSpeech", "media.generate_speech"],
  ] as const)("correlates %s through the common media runner", async (operation, primitive) => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    const result = await runCompletedMediaOperation({
      definition: valueOperation(),
      provider: "test",
      operation,
      model: "media-model",
      input: { value: operation },
    });
    await observe.flush();

    const span = transport.records.find(
      (record) => record.type === "span:start" && record.primitive === primitive,
    );
    expect(result._meta).toEqual({
      traceId: span?.traceId,
      spanId: span?.spanId,
    });
  });

  it("finalizes a frozen provider payload without mutation or lost facts", async () => {
    const raw = Object.freeze({ value: "image" });
    const providerMetadata = Object.freeze({ requestId: "request-1" });
    const warnings = Object.freeze(["provider-warning"] as const);
    const execution = Object.freeze({ kind: "native" as const, calls: 1 });
    const payload = Object.freeze({
      value: raw.value,
      warnings,
      providerMetadata,
      execution,
      raw,
    });
    let reported: unknown;
    const definition = defineCompletedOperation({
      normalize: (input: Readonly<{ value: string }>) => input,
      support: () => "supported" as const,
      invoke: (_input, context) =>
        context.call("image.generate", async () => raw),
      validate: () => payload,
      report: (result) => {
        reported = result;
        return { kind: "image" as const, count: 1 };
      },
      conformance: [],
    });

    const result = await runCompletedMediaOperation({
      definition,
      provider: "test",
      operation: "generateImage",
      model: "image-model",
      input: { value: "image" },
    });

    expect(result).not.toBe(payload);
    expect(Object.hasOwn(payload, "_meta")).toBe(false);
    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result).toMatchObject({
      warnings: ["provider-warning"],
      providerMetadata,
      execution: { kind: "native", calls: 1 },
      raw,
    });
    expect(reported).toBe(result);
  });

  it("keeps a composed child in the trace while each result points to its owner", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    let childResult: GenerateResult | undefined;
    const definition = defineCompletedOperation({
      normalize: (input: Readonly<{ value: string }>) => input,
      support: () => "supported" as const,
      invoke: (input, context) =>
        context.call("generation.call", async () =>
          (childResult = await orchestrateGenerate(
            generationSpec(),
            async () => ({ text: input.value }),
          ))),
      validate: (raw) => ({
        value: raw.text,
        warnings: [] as const,
        execution: {
          kind: "composed" as const,
          calls: 1,
          operations: ["generation.call"],
        },
        raw,
      }),
      report: () => ({ kind: "audio" as const }),
      conformance: [],
    });

    const result = await runCompletedMediaOperation({
      definition,
      provider: "test",
      operation: "transcribe",
      model: "audio-model",
      input: { value: "transcript" },
    });

    expect(childResult).toBeDefined();
    expect(childResult!._meta.traceId).toBe(result._meta.traceId);
    expect(childResult!._meta.spanId).not.toBe(result._meta.spanId);
  });

  it("does not observe normalized aliases outside the exact media vocabulary", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    const result = await runCompletedMediaOperation({
      definition: valueOperation(),
      provider: "test",
      operation: "generate-image",
      model: "image-model",
      input: { value: "image" },
    });
    await observe.flush();

    expect(result).not.toHaveProperty("_meta");
    expect(
      transport.records.some(
        (record) =>
          record.type === "span:start" &&
          record.primitive === "media.generate_image",
      ),
    ).toBe(false);
  });
});

function valueOperation() {
  return defineCompletedOperation({
    normalize: (input: Readonly<{ value: string }>) => input,
    support: () => "supported" as const,
    invoke: (input, context) =>
      context.call("image.generate", async () => ({ value: input.value })),
    validate: (raw) => ({
      value: raw.value,
      warnings: [] as const,
      providerMetadata: { requestId: "request-1" },
      execution: { kind: "native" as const, calls: 1 },
      raw,
    }),
    report: () => ({ kind: "image" as const, count: 1 }),
    conformance: [],
  });
}

function generationSpec(): OrchestrationSpec<Record<string, unknown>> {
  return {
    promptId: "completed-media-child",
    promptConfig: {} as OrchestrationSpec["promptConfig"],
    preparedArgs: { model: "child-model", messages: [] },
    model: "child-model",
    input: { value: "transcript" },
    operation: "generate",
    provider: "test",
    outputMode: "text",
  };
}
