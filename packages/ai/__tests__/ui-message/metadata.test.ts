import type {
  PublishedStreamEvent,
  StreamCompletion,
} from "@use-crux/core/adapter";
import { publishOrdinaryStream } from "@use-crux/core/adapter";
import {
  createCruxRunId,
  createCruxSpanId,
  createCruxTraceId,
} from "@use-crux/core/observability";
import { describe, expect, it, vi } from "vitest";
import { toUIMessageStream } from "../../src/ui-message";

describe("Crux UI-message metadata", () => {
  it("preserves user metadata while authoritatively stamping crux.runId", async () => {
    const runId = createCruxRunId();
    const messageMetadata = vi.fn(() => ({
      user: { tenant: "acme" },
      crux: { feature: "support", runId: "user-supplied" },
    }));

    const chunks = await collect(
      toUIMessageStream(streamResult(runId), { messageMetadata }),
    );

    // The caller's own fields survive; only `crux.runId` is authoritative.
    expect(metadataOf(chunks, "start")).toEqual({
      user: { tenant: "acme" },
      crux: { feature: "support", runId },
    });
  });

  it("adds Crux metadata when the user callback returns no metadata", async () => {
    const runId = createCruxRunId();

    const chunks = await collect(
      toUIMessageStream(streamResult(runId), {
        messageMetadata: () => undefined,
      }),
    );

    expect(metadataOf(chunks, "start")).toEqual({ crux: { runId } });
  });

  it("stamps the terminal part as well as the opening one", async () => {
    const runId = createCruxRunId();
    const messageMetadata = vi.fn(() => ({ source: "user" }));

    const chunks = await collect(
      toUIMessageStream(streamResult(runId), { messageMetadata }),
    );

    expect(metadataOf(chunks, "start")).toEqual({
      source: "user",
      crux: { runId },
    });
    expect(metadataOf(chunks, "finish")).toEqual({
      source: "user",
      crux: { runId },
    });
    expect(messageMetadata).toHaveBeenCalledTimes(2);
  });

  it("translates published text into one UI text block", async () => {
    const runId = createCruxRunId();

    const chunks = await collect(toUIMessageStream(streamResult(runId)));

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "start",
      "text-start",
      "text-delta",
      "text-delta",
      "text-end",
      "finish",
    ]);
  });

  it("forwards the logical finish facts to the terminal part and metadata", async () => {
    const runId = createCruxRunId();
    const seen: unknown[] = [];

    const chunks = await collect(
      toUIMessageStream(
        streamResult(
          runId,
          [{ type: "text-delta", text: "hi" }],
          { finishReason: "stop", usage: { totalTokens: 12 } },
        ),
        {
          messageMetadata: ({ part }) => {
            seen.push(part);
            return undefined;
          },
        },
      ),
    );

    // The terminal chunk carries what the UI protocol needs...
    expect(chunks.find((chunk) => chunk.type === "finish")).toMatchObject({
      finishReason: "stop",
      totalUsage: { totalTokens: 12 },
    });
    // ...and the caller's callback sees the SAME facts, not a synthetic stub.
    expect(seen.at(-1)).toMatchObject({
      type: "finish",
      finishReason: "stop",
      totalUsage: { totalTokens: 12 },
    });
  });

  it("renders published media as a UI file chunk", async () => {
    const runId = createCruxRunId();

    const chunks = await collect(
      toUIMessageStream(
        streamResult(runId, [
          {
            type: "media",
            part: {
              type: "image",
              source: new Uint8Array([1, 2, 3]),
              mediaType: "image/png",
            },
          },
        ]),
      ),
    );

    const file = chunks.find((chunk) => chunk.type === "file");
    expect(file).toMatchObject({
      type: "file",
      mediaType: "image/png",
      url: "data:image/png;base64,AQID",
    });
  });

  it("omits media it cannot render rather than emitting a broken attachment", async () => {
    const runId = createCruxRunId();

    const chunks = await collect(
      toUIMessageStream(
        streamResult(runId, [
          {
            type: "media",
            part: {
              type: "file",
              // A provider-hosted reference carries no inline bytes.
              source: { type: "provider-file", provider: "openai", fileId: "f_1" },
              mediaType: "application/pdf",
            },
          },
        ]),
      ),
    );

    expect(chunks.some((chunk) => chunk.type === "file")).toBe(false);
  });

  it("frames reasoning as its own block, never merged into the answer", async () => {
    const runId = createCruxRunId();

    const chunks = await collect(
      toUIMessageStream(
        streamResult(runId, [
          { type: "reasoning-delta", text: "thinking" },
          { type: "text-delta", text: "answer" },
        ]),
      ),
    );

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "start",
      "reasoning-start",
      "reasoning-delta",
      "text-start",
      "text-delta",
      "reasoning-end",
      "text-end",
      "finish",
    ]);
    // Distinct ids: a shared one would render private reasoning as the answer.
    const reasoningId = chunks.find((c) => c.type === "reasoning-delta")?.id;
    const textId = chunks.find((c) => c.type === "text-delta")?.id;
    expect(reasoningId).not.toBe(textId);
  });
});

function metadataOf(
  chunks: readonly Record<string, unknown>[],
  type: "start" | "finish",
): unknown {
  return chunks.find((chunk) => chunk.type === type)?.messageMetadata;
}

async function collect(
  stream: ReadableStream<unknown>,
): Promise<Record<string, unknown>[]> {
  const chunks: Record<string, unknown>[] = [];
  const reader = stream.getReader();
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value as Record<string, unknown>);
  }
  return chunks;
}

/** A real logical stream, so the helper is exercised through the public seam. */
function streamResult(
  runId: ReturnType<typeof createCruxRunId>,
  published: readonly PublishedStreamEvent<unknown>[] = [
    { type: "text-delta", text: "he" },
    { type: "text-delta", text: "llo" },
  ],
  terminal: { finishReason?: string; usage?: unknown } = {},
) {
  const meta = { traceId: createCruxTraceId(), spanId: createCruxSpanId() };
  async function* events(): AsyncIterable<PublishedStreamEvent<unknown>> {
    yield* published;
  }
  return publishOrdinaryStream<unknown, unknown>({
    runId,
    meta,
    events: events(),
    completion: async () =>
      ({
        runId,
        _meta: meta,
        text: "hello",
        ...(terminal.finishReason !== undefined
          ? { finalStep: { finishReason: terminal.finishReason } }
          : {}),
        ...(terminal.usage !== undefined ? { usage: terminal.usage } : {}),
      }) as unknown as StreamCompletion<unknown>,
  });
}
