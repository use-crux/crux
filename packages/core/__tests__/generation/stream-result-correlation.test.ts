import { afterEach, describe, expect, it, vi } from "vitest";

import {
  adapter,
  createInMemoryObservabilityTransport,
  observe,
  resetHooks,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "@use-crux/core";
import {
  fakeLoopRuntime,
  loopRuntimeAdapter,
} from "@use-crux/core/adapter";
import { __setAlsForTesting } from "../../src/observability/observe";
import {
  createFakeAdapter,
  deferred,
  structuredPrompt,
  textPrompt,
} from "./stream-result-correlation.fixtures";

describe("managed stream result correlation", () => {
  afterEach(() => {
    __setAlsForTesting("auto");
    resetHooks();
    resetObservabilityRuntime();
    vi.restoreAllMocks();
  });

  it("uses one exact generation.stream pair for a text handle and completion", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const result = await createFakeAdapter().stream(textPrompt, {
      model: "model-1",
      input: { message: "Hello" },
    });
    await observe.flush();

    const span = transport.records.find(
      (record) =>
        record.type === "span:start" &&
        record.primitive === "generation.stream",
    );
    expect(span).toBeDefined();
    expect(result._meta).toEqual({
      traceId: span?.traceId,
      spanId: span?.spanId,
    });

    const chunks: string[] = [];
    for await (const chunk of result.textStream) chunks.push(chunk);
    const completion = await result.completion;

    expect(chunks).toEqual(["Hello", " stream"]);
    expect(completion._meta).toMatchObject({
      responseId: "provider-stream-response",
      finishReason: "stop",
      traceId: result._meta.traceId,
      spanId: result._meta.spanId,
    });
    expect(completion.usage?.totalTokens).toBe(3);
  });

  it("uses the same pair for a structured stream and parsed completion", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const result = await createFakeAdapter().stream(structuredPrompt, {
      model: "model-1",
      input: { message: "Answer" },
    });
    await observe.flush();

    const span = transport.records.find(
      (record) =>
        record.type === "span:start" &&
        record.primitive === "generation.stream",
    );
    const chunks: string[] = [];
    for await (const chunk of result.textStream) chunks.push(chunk);
    const completion = await result.completion;

    expect(chunks.join("")).toBe('{"answer":42}');
    expect(completion.object).toEqual({ answer: 42 });
    expect(result._meta).toEqual({
      traceId: span?.traceId,
      spanId: span?.spanId,
    });
    expect(completion._meta).toMatchObject(result._meta);
  });

  it("stamps the public SDK-loop handle without leaking IDs into the provider port", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const fake = fakeLoopRuntime({ streams: [["SDK", " loop"]] });
    const result = await loopRuntimeAdapter(fake.runtime).stream(textPrompt, {
      model: "fake:model-1",
      input: { message: "Hello" },
    });
    await observe.flush();

    const span = transport.records.find(
      (record) =>
        record.type === "span:start" &&
        record.primitive === "generation.stream",
    );
    expect(result._meta).toEqual({
      traceId: span?.traceId,
      spanId: span?.spanId,
    });

    const completion = await result.completion();
    expect(completion).toMatchObject({
      text: "SDK loop",
      streaming: { totalChunks: 2 },
      _meta: result._meta,
    });
    expect(fake.calls.runStream).toHaveLength(1);
    expect(fake.calls.runStream[0]).not.toHaveProperty("traceId");
    expect(fake.calls.runStream[0]).not.toHaveProperty("spanId");
  });

  it("keeps the pair when provider completion settles before stream drain", async () => {
    let providerSettled = false;
    const completion = Promise.resolve({
      text: "early",
      responseId: "early-response",
      finishReason: "stop",
    }).then((meta) => {
      providerSettled = true;
      return meta;
    });
    const result = await createFakeAdapter({
      chunks: ["ear", "ly"],
      completion,
    }).stream(textPrompt, {
      model: "model-1",
      input: { message: "Hello" },
    });
    const operation = result._meta;

    await completion;
    expect(providerSettled).toBe(true);
    expect(result._meta).toBe(operation);
    for await (const _chunk of result.textStream) {
      // Drain after provider completion has already settled.
    }

    expect((await result.completion)._meta).toMatchObject(operation);
  });

  it("keeps the pair when stream drain wins and completion facts arrive late", async () => {
    const late = deferred<{
      text: string;
      responseId: string;
      finishReason: string;
    }>();
    const result = await createFakeAdapter({
      chunks: ["stream", " first"],
      completion: late.promise,
    }).stream(textPrompt, {
      model: "model-1",
      input: { message: "Hello" },
    });
    const operation = result._meta;

    for await (const _chunk of result.textStream) {
      // Drain before releasing provider completion metadata.
    }
    expect(result._meta).toBe(operation);
    late.resolve({
      text: "stream first",
      responseId: "late-response",
      finishReason: "stop",
    });

    expect((await result.completion)._meta).toMatchObject({
      ...operation,
      responseId: "late-response",
    });
  });

  it("keeps immediate identity for partial and never-consumed streams", async () => {
    const partial = await createFakeAdapter({
      chunks: ["one", "two"],
    }).stream(textPrompt, {
      model: "model-1",
      input: { message: "Hello" },
    });
    const iterator = partial.textStream[Symbol.asyncIterator]();
    const partialOperation = partial._meta;
    expect(await iterator.next()).toEqual({ value: "one", done: false });
    expect(partial._meta).toBe(partialOperation);
    expect(partialOperation).toEqual({
      traceId: expect.any(String),
      spanId: expect.any(String),
    });
    await iterator.return?.();

    const neverConsumed = await createFakeAdapter().stream(textPrompt, {
      model: "model-1",
      input: { message: "Hello" },
    });
    expect(neverConsumed._meta).toEqual({
      traceId: expect.any(String),
      spanId: expect.any(String),
    });
  });

  it("leaves a failed stream navigable and preserves failure identity", async () => {
    const iterationError = new Error("iteration failed");
    const iterating = await createFakeAdapter({
      chunks: ["before failure"],
      iterationError,
    }).stream(textPrompt, {
      model: "model-1",
      input: { message: "Hello" },
    });

    await expect(drain(iterating.textStream)).rejects.toBe(iterationError);
    await expect(iterating.completion).rejects.toBe(iterationError);
    expect(iterating._meta).toEqual({
      traceId: expect.any(String),
      spanId: expect.any(String),
    });

    const completionError = new Error("completion failed");
    const completing = await createFakeAdapter({
      completion: Promise.reject(completionError),
    }).stream(textPrompt, {
      model: "model-1",
      input: { message: "Hello" },
    });
    await drain(completing.textStream);
    await expect(completing.completion).rejects.toBe(completionError);
    expect(completing._meta).toEqual({
      traceId: expect.any(String),
      spanId: expect.any(String),
    });
  });

  it("uses the lexical stream span when AsyncLocalStorage is unavailable", async () => {
    __setAlsForTesting(null);
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const result = await createFakeAdapter().stream(textPrompt, {
      model: "model-1",
      input: { message: "Hello" },
    });
    await observe.flush();
    const span = transport.records.find(
      (record) =>
        record.type === "span:start" &&
        record.primitive === "generation.stream",
    );

    expect(result._meta).toEqual({
      traceId: span?.traceId,
      spanId: span?.spanId,
    });
    await drain(result.textStream);
    expect((await result.completion)._meta).toMatchObject(result._meta);
  });

  it("observes frozen core-step and SDK-loop provider handles without mutation", async () => {
    const coreStep = await createFakeAdapter({ freezeHandle: true }).stream(
      textPrompt,
      { model: "model-1", input: { message: "Hello" } },
    );
    await drain(coreStep.textStream);
    expect((await coreStep.completion)._meta).toMatchObject(coreStep._meta);

    const fake = fakeLoopRuntime({ streams: [["frozen", " SDK"]] });
    const runtime = {
      ...fake.runtime,
      async runStream(request: Parameters<typeof fake.runtime.runStream>[0]) {
        return Object.freeze(await fake.runtime.runStream(request));
      },
    };
    const sdkLoop = await loopRuntimeAdapter(runtime).stream(textPrompt, {
      model: "fake:model-1",
      input: { message: "Hello" },
    });

    expect(sdkLoop._meta).toEqual({
      traceId: expect.any(String),
      spanId: expect.any(String),
    });
    expect((await sdkLoop.completion())._meta).toEqual(sdkLoop._meta);
  });
});

async function drain(stream: AsyncIterable<string>): Promise<void> {
  for await (const _chunk of stream) {
    // Consume the stream to its terminal signal.
  }
}
