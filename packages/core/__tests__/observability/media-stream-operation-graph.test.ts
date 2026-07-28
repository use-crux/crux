import { afterEach, describe, expect, it } from "vitest";
import {
  createGeneratedImageResult,
  type GenerateImageOptions,
  type ImageStreamEvent,
} from "../../src";
import {
  bindStreamingOperation,
  defineStreamingOperation,
} from "../../src/adapter";
import { fallback } from "../../src/generation/fallback";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxGraphRecord,
} from "../../src/observability";
import { boundary, guardrail } from "../../src/safety";
import { resetHooks } from "../../src/runtime/runtime";
import { expectBalancedGraph } from "./helpers/expect-balanced-graph";

const image = Object.freeze({
  type: "data" as const,
  data: new Uint8Array([1, 2, 3]),
  mediaType: "image/png",
});

describe("media stream operation observability graph", () => {
  afterEach(() => {
    resetObservabilityRuntime();
    resetHooks();
  });

  it("correlates one logical stream with safe physical attempt children", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport, { scheduledDelayMs: 0 });
    const reportSink: unknown[] = [];
    let reportCalls = 0;
    const primaryFailure = Object.assign(new Error("primary unavailable"), {
      status: 503,
    });
    const operation = defineStreamingOperation({
      normalize: (input: GenerateImageOptions<string>) => input,
      support: () => "supported" as const,
      open: async (input, context) =>
        context.call("image.generate", async () => {
          const model = String(input.model);
          return {
            events: (async function* () {
              if (model === "primary") {
                yield { sequence: 0 };
                throw primaryFailure;
              }
            })(),
            map: (event: { readonly sequence: number }) =>
              ({
                type: "image-delta",
                data: image.data,
                mediaType: image.mediaType,
                outputIndex: 0,
                sequence: event.sequence,
              }) satisfies ImageStreamEvent,
            completion:
              model === "primary"
                ? new Promise<never>(() => {})
                : Promise.resolve({ requestId: "request-1" }),
          };
        }),
      validate: (raw) =>
        createGeneratedImageResult([image], {
          warnings: [],
          execution: { kind: "native", calls: 1 },
          raw,
        }),
      report: (result) => {
        reportCalls += 1;
        return { kind: "image" as const, count: result.images.length };
      },
      conformance: [],
    });
    const streamImage = bindStreamingOperation({
      definition: operation,
      provider: "test",
      operation: "streamImage",
      onReport: (report) => reportSink.push(report),
    });

    const result = await streamImage({
      model: fallback(["primary", "backup"]),
      prompt: "A quiet canal",
      guardrails: [
        guardrail({
          id: "hold-deltas",
          on: boundary.output.media(),
          run: () => ({ action: "allow" }),
        }),
      ],
    });
    const events = await collect(result.fullStream);
    const completion = await result.completion;
    await observe.flush();

    expect(reportCalls).toBe(1);
    expect(reportSink).toEqual([{ kind: "image", count: 1 }]);
    expect(events.map(({ type }) => type)).toEqual([
      "start",
      "image",
      "finish",
    ]);
    expectBalancedGraph(transport.records);

    const starts = recordsOfType(transport.records, "span:start").filter(
      (span) => span.primitive === "media.generate_image",
    );
    const logical = starts.find(
      (span) => span.attributes?.streamingRole === "logical",
    );
    const attempts = starts.filter(
      (span) => span.attributes?.streamingRole === "attempt",
    );
    expect(logical).toBeDefined();
    expect(attempts).toHaveLength(2);
    expect(attempts.map(({ parentSpanId }) => parentSpanId)).toEqual([
      logical?.spanId,
      logical?.spanId,
    ]);
    expect(completion._meta).toEqual({
      traceId: logical?.traceId,
      spanId: logical?.spanId,
    });
    expect(result._meta).toEqual(completion._meta);

    const ends = recordsOfType(transport.records, "span:end");
    const logicalEnd = ends.find((span) => span.spanId === logical?.spanId);
    expect(logicalEnd?.attributes).toMatchObject({
      committed: true,
      previewCount: 0,
      deltaCount: 0,
      finalCount: 1,
      byteCount: 3,
      mediaTypes: ["image/png"],
      firstEventMs: expect.any(Number),
      durationMs: expect.any(Number),
      terminal: "ok",
    });
    const attemptEnds = attempts.map((attempt) =>
      ends.find((end) => end.spanId === attempt.spanId),
    );
    expect(attemptEnds[0]?.attributes).toMatchObject({
      deltaCount: 1,
      finalCount: 0,
      committed: false,
      terminal: "error",
    });
    expect(attemptEnds[1]?.attributes).toMatchObject({
      deltaCount: 0,
      finalCount: 1,
      terminal: "ok",
    });

    const reports = recordsOfType(transport.records, "artifact").filter(
      (artifact) => artifact.kind === "media.report",
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]?.preview).toMatchObject({
      kind: "image",
      count: 1,
      streaming: {
        attemptCount: 2,
        previewCount: 0,
        deltaCount: 0,
        finalCount: 1,
        byteCount: 3,
      },
    });
  });

  it.each(["cancelled", "timeout"] as const)(
    "records a payload-free %s terminal classification",
    async (terminal) => {
      const transport = createInMemoryObservabilityTransport();
      setObservabilityTransport(transport, { scheduledDelayMs: 0 });
      const result = await pendingStream()({
        model: "image-model",
        prompt: "A quiet canal",
        ...(terminal === "timeout" ? { timeout: { stepMs: 5 } } : {}),
      });
      if (terminal === "cancelled") result.cancel("stop");

      await result.completion.catch(() => undefined);
      await observe.flush();

      const starts = recordsOfType(transport.records, "span:start");
      const logical = starts.find(
        (span) => span.attributes?.streamingRole === "logical",
      );
      const end = recordsOfType(transport.records, "span:end").find(
        (span) => span.spanId === logical?.spanId,
      );
      expect(end?.attributes).toMatchObject({
        terminal,
        committed: false,
      });
    },
  );

  it("keeps report and sink failures diagnostic-only", async () => {
    for (const report of [
      () => {
        throw new Error("report failed");
      },
      () => ({ kind: "image" as const, count: 1 }),
    ]) {
      const streamImage = successfulStream(report, () => {
        throw new Error("sink failed");
      });
      const result = await streamImage({
        model: "image-model",
        prompt: "A quiet canal",
      });
      await expect(result.completion).resolves.toMatchObject({ image });
    }
  });
});

function successfulStream(
  report: () => unknown,
  onReport: (value: unknown) => void,
) {
  const operation = defineStreamingOperation({
    normalize: (input: GenerateImageOptions<string>) => input,
    support: () => "supported" as const,
    open: async () => ({
      events: (async function* () {})(),
      map: (_event: never) => undefined,
      completion: Promise.resolve({ requestId: "request-1" }),
    }),
    validate: (raw) =>
      createGeneratedImageResult([image], {
        warnings: [],
        execution: { kind: "native", calls: 1 },
        raw,
      }),
    report,
    conformance: [],
  });
  return bindStreamingOperation({
    definition: operation,
    provider: "test",
    operation: "streamImage",
    onReport,
  });
}

function pendingStream() {
  const operation = defineStreamingOperation({
    normalize: (input: GenerateImageOptions<string>) => input,
    support: () => "supported" as const,
    open: async () => ({
      events: (async function* () {
        await new Promise<never>(() => {});
      })(),
      map: (_event: never) => undefined,
      completion: new Promise<never>(() => {}),
    }),
    validate: () => {
      throw new Error("unreachable");
    },
    report: () => ({ kind: "image" }),
    conformance: [],
  });
  return bindStreamingOperation({
    definition: operation,
    provider: "test",
    operation: "streamImage",
  });
}

function recordsOfType<T extends CruxGraphRecord["type"]>(
  records: readonly CruxGraphRecord[],
  type: T,
): Extract<CruxGraphRecord, { type: T }>[] {
  return records.filter(
    (record): record is Extract<CruxGraphRecord, { type: T }> =>
      record.type === type,
  );
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}
