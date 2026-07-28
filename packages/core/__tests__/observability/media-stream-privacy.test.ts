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
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxGraphRecord,
} from "../../src/observability";
import { resetHooks, updateHooks } from "../../src/runtime/runtime";

const FORBIDDEN = [
  "SECRET_PROMPT",
  "SECRET_NATIVE_EVENT",
  "SECRET_BASE64",
  "SECRET_URL",
  "SECRET_FILENAME",
  "SECRET_HASH",
  "https://",
  "data:image",
] as const;

describe("media stream observability privacy", () => {
  afterEach(() => {
    resetObservabilityRuntime();
    resetHooks();
  });

  it("passes only safe descriptors through records, hooks, and reports", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport, { scheduledDelayMs: 0 });
    const hookRecords: CruxGraphRecord[] = [];
    updateHooks({
      observabilityCapture: {
        capture: "full",
        redactRecord: (record) => {
          hookRecords.push(record);
          return record;
        },
      },
    });
    const reports: unknown[] = [];
    const secretBytes = new TextEncoder().encode("SECRET_BASE64");
    const operation = defineStreamingOperation({
      normalize: (input: GenerateImageOptions<string>) => input,
      support: () => "supported" as const,
      open: async () => ({
        events: (async function* () {
          yield {
            secret: "SECRET_NATIVE_EVENT",
            url: "https://example.test/SECRET_URL",
          };
        })(),
        map: () =>
          ({
            type: "image-delta",
            data: secretBytes,
            mediaType: "image/png",
            outputIndex: 0,
            sequence: 0,
          }) satisfies ImageStreamEvent,
        completion: Promise.resolve({
          requestId: "SECRET_NATIVE_EVENT",
          url: "https://example.test/SECRET_URL",
        }),
      }),
      validate: (raw) =>
        createGeneratedImageResult(
          [
            {
              type: "data",
              data: secretBytes,
              mediaType: "image/png",
              filename: "SECRET_FILENAME.png",
              sha256: "SECRET_HASH",
            },
          ],
          {
            warnings: [],
            execution: { kind: "native", calls: 1 },
            raw,
          },
        ),
      report: () => ({
        kind: "image",
        count: 1,
        url: "https://example.test/SECRET_URL",
        filename: "SECRET_FILENAME.png",
        hash: "SECRET_HASH",
        payload: "data:image/png;base64,SECRET_BASE64",
      }),
      conformance: [],
    });
    const streamImage = bindStreamingOperation({
      definition: operation,
      provider: "test",
      operation: "streamImage",
      onReport: (report) => reports.push(report),
    });

    const result = await streamImage({
      model: "image-model",
      prompt: "SECRET_PROMPT",
    });
    await collect(result.fullStream);
    const completion = await result.completion;
    await observe.flush();

    expect(reports).toEqual([{ kind: "image", count: 1 }]);
    const observable = JSON.stringify({
      records: transport.records,
      hooks: hookRecords,
      reports,
      decisions: completion.safety,
    });
    for (const value of FORBIDDEN) expect(observable).not.toContain(value);
    expect(observable).not.toContain(JSON.stringify([...secretBytes]));
  });

  it("classifies a terminal error without sending its secret object to telemetry", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport, { scheduledDelayMs: 0 });
    const failure = Object.assign(
      new Error("provider failed at https://example.test/SECRET_URL"),
      {
        filename: "SECRET_FILENAME.png",
        hash: "SECRET_HASH",
        native: { payload: "SECRET_NATIVE_EVENT" },
      },
    );
    const operation = defineStreamingOperation({
      normalize: (input: GenerateImageOptions<string>) => input,
      support: () => "supported" as const,
      open: async () => ({
        events: (async function* () {
          throw failure;
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
    const result = await bindStreamingOperation({
      definition: operation,
      provider: "test",
      operation: "streamImage",
    })({ model: "image-model", prompt: "SECRET_PROMPT" });

    await expect(collect(result.fullStream)).rejects.toBe(failure);
    await observe.flush();

    const serialized = JSON.stringify(transport.records);
    for (const value of FORBIDDEN) expect(serialized).not.toContain(value);
    expect(serialized).toContain('"terminal":"error"');
  });
});

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}
