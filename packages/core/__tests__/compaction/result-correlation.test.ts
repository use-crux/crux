import { afterEach, describe, expect, it, vi } from "vitest";
import { countTokens } from "../../src";
import { compactConversation, summarizeMessages } from "../../src/compaction";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src/observability";
import { __setAlsForTesting } from "../../src/observability/observe";

describe("compaction result correlation", () => {
  afterEach(() => {
    __setAlsForTesting("auto");
    resetObservabilityRuntime();
    vi.restoreAllMocks();
  });

  it("uses the exact compaction.run span while accepting an ID-free generate result", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    const result = await summarizeMessages({
      messages: [{ role: "user", content: "Summarize this." }],
      generate: async () => ({ text: "A short summary." }),
      model: "summary-model",
    });
    await observe.flush();
    const span = transport.records.find(
      (record) =>
        record.type === "span:start" && record.primitive === "compaction.run",
    );

    expect(result._meta).toEqual({
      traceId: span?.traceId,
      spanId: span?.spanId,
    });
  });

  it("correlates the empty-message fast path without calling generate", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const generate = vi.fn(async () => ({ text: "unused" }));

    const result = await summarizeMessages({
      messages: [],
      generate,
      model: "summary-model",
    });
    await observe.flush();
    const span = transport.records.find(
      (record) =>
        record.type === "span:start" && record.primitive === "compaction.run",
    );

    expect(generate).not.toHaveBeenCalled();
    expect(result._meta).toEqual({
      traceId: span?.traceId,
      spanId: span?.spanId,
    });
  });

  it.each([
    { existingSummary: "", expectedSummary: "" },
    {
      existingSummary: "Existing summary.",
      expectedSummary: "Existing summary.",
    },
  ])(
    'correlates the zero-work conversation path for "$existingSummary"',
    async ({ existingSummary, expectedSummary }) => {
      const transport = createInMemoryObservabilityTransport();
      setObservabilityTransport(transport);
      const generate = vi.fn(async () => ({ text: "unused" }));

      const result = await compactConversation({
        evictedMessages: [],
        existingSummary,
        generate,
        model: "summary-model",
      });
      await observe.flush();
      const spans = transport.records.filter(
        (record) =>
          record.type === "span:start" && record.primitive === "compaction.run",
      );

      expect(generate).not.toHaveBeenCalled();
      const expectedTokens = existingSummary ? countTokens(existingSummary) : 0;
      expect(result).toMatchObject({
        summary: expectedSummary,
        tokensBefore: expectedTokens,
        tokensAfter: expectedTokens,
        ratio: 1,
      });
      expect(spans).toHaveLength(1);
      expect(result._meta).toEqual({
        traceId: spans[0]?.traceId,
        spanId: spans[0]?.spanId,
      });
    },
  );

  it("restamps an observed child summary with the outer conversation operation", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    const result = await compactConversation({
      evictedMessages: [{ role: "user", content: "Remember the launch date." }],
      existingSummary: "The project is approved.",
      generate: async () => ({ text: "The project is approved for launch." }),
      model: "summary-model",
    });
    await observe.flush();
    const spans = transport.records.filter(
      (record) =>
        record.type === "span:start" && record.primitive === "compaction.run",
    );
    const outer = spans.find(
      (record) => record.name === "conversation compaction",
    );
    const child = spans.find(
      (record) => record.name === "compaction.summarize",
    );

    expect(spans).toHaveLength(2);
    expect(child).toMatchObject({
      traceId: outer?.traceId,
      parentSpanId: outer?.spanId,
    });
    expect(child?.spanId).not.toBe(outer?.spanId);
    expect(result._meta).toEqual({
      traceId: outer?.traceId,
      spanId: outer?.spanId,
    });
  });

  it("uses the lexical conversation operation when AsyncLocalStorage is unavailable", async () => {
    __setAlsForTesting(null);
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    const result = await compactConversation({
      evictedMessages: [{ role: "user", content: "Remember this." }],
      existingSummary: "Existing summary.",
      generate: async () => ({ text: "Merged summary." }),
      model: "summary-model",
    });
    await observe.flush();
    const span = transport.records.find(
      (record) =>
        record.type === "span:start" &&
        record.primitive === "compaction.run" &&
        record.name === "conversation compaction",
    );

    expect(result._meta).toEqual({
      traceId: span?.traceId,
      spanId: span?.spanId,
    });
  });

  it("preserves generation failures and terminalizes the outer operation as an error", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const failure = new Error("summary failed");

    await expect(
      compactConversation({
        evictedMessages: [{ role: "user", content: "Summarize me." }],
        existingSummary: "",
        generate: async () => {
          throw failure;
        },
        model: "summary-model",
      }),
    ).rejects.toBe(failure);
    await observe.flush();
    const outerStart = transport.records.find(
      (record) =>
        record.type === "span:start" &&
        record.primitive === "compaction.run" &&
        record.name === "conversation compaction",
    );
    const outerEnd = transport.records.find(
      (record) =>
        record.type === "span:end" && record.spanId === outerStart?.spanId,
    );

    expect(outerEnd).toMatchObject({ status: "error" });
  });
});
