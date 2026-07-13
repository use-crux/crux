import { afterEach, describe, expect, it } from "vitest";
import {
  defineCompletedOperation,
  runCompletedMediaOperation,
} from "../../src/adapter/completed-operation";
import { fallback } from "../../src/generation/fallback";
import {
  CRUX_CANONICAL_ARTIFACT_KINDS,
  CRUX_CANONICAL_EDGE_TYPES,
  CRUX_PRIMITIVE_FAMILIES,
  CRUX_PRIMITIVE_FAMILY_BY_NAME,
  CRUX_PRIMITIVE_NAMES,
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxGraphRecord,
} from "../../src/observability";
import { resetHooks, updateHooks } from "../../src/runtime/runtime";
import { expectBalancedGraph } from "./helpers/expect-balanced-graph";

const FORBIDDEN = [
  "SECRET_BYTES",
  "SECRET_URL",
  "SECRET_ID",
  "SECRET.png",
  "asset://SECRET",
  "data:image",
  "base64,",
] as const;

type NativeResult = Readonly<{
  images: readonly Uint8Array[];
  warnings: readonly string[];
  execution: Readonly<{ kind: "native"; calls: number }>;
  raw: Readonly<{ ok: true }>;
}>;

function imageDefinition(
  invoke?: (
    model: string,
    signal: AbortSignal,
    call: <T>(operation: string, start: () => Promise<T>) => Promise<T>,
  ) => Promise<Readonly<{ images: readonly Uint8Array[] }>>,
) {
  return defineCompletedOperation({
    normalize: (input: Readonly<{ model: string; prompt: string; image?: Uint8Array }>) =>
      Object.freeze({
        model: input.model,
        prompt: input.prompt,
        ...(input.image ? { image: input.image } : {}),
      }),
    support: () => "supported" as const,
    async invoke(input, context) {
      const raw =
        (await invoke?.(context.model, context.signal, context.call)) ??
        (await context.call("image.generate", async () => ({
          images: [new Uint8Array([1, 2, 3])],
        })));
      return raw;
    },
    validate(raw): NativeResult {
      return {
        images: raw.images,
        warnings: [],
        execution: { kind: "native", calls: 1 },
        raw: { ok: true },
      };
    },
    report(result) {
      return { kind: "image" as const, count: result.images.length };
    },
    conformance: [],
  });
}

function transcriptionDefinition(
  composed = false,
) {
  return defineCompletedOperation({
    normalize: (input: Readonly<{ model: string; audio: Uint8Array }>) =>
      Object.freeze({ model: input.model, audio: input.audio }),
    support: () => "supported" as const,
    async invoke(input, context) {
      if (composed) {
        return context.call("generation.call", async () => ({
          text: "hello speaker",
          segments: [
            { start: 0, end: 1.5, text: "hello", speaker: "A" },
            { start: 1.5, end: 3, text: "speaker", speaker: "B" },
          ],
        }));
      }
      return context.call("audio.transcribe", async () => ({
        text: "hello speaker",
        segments: [{ start: 0, end: 2, text: "hello speaker" }],
      }));
    },
    validate(raw) {
      return {
        text: raw.text,
        segments: raw.segments,
        warnings: [],
        execution: composed
          ? {
              kind: "composed" as const,
              calls: 1,
              operations: ["generation.call"],
            }
          : { kind: "native" as const, calls: 1 },
        raw,
      };
    },
    report(result) {
      return {
        kind: "audio" as const,
        segments: result.segments.length,
        durationSeconds: result.segments.at(-1)?.end,
      };
    },
    conformance: [],
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

describe("media operation observability graph", () => {
  afterEach(() => {
    resetObservabilityRuntime();
    resetHooks();
  });

  it("registers the four media primitives, media.report, and derived.from", () => {
    expect(CRUX_PRIMITIVE_FAMILIES).toContain("media");
    for (const name of [
      "media.generate_image",
      "media.transcribe",
      "media.generate_speech",
      "media.describe",
    ] as const) {
      expect(CRUX_PRIMITIVE_NAMES).toContain(name);
      expect(CRUX_PRIMITIVE_FAMILY_BY_NAME[name]).toBe("media");
    }
    expect(CRUX_CANONICAL_ARTIFACT_KINDS).toContain("media.report");
    expect(CRUX_CANONICAL_EDGE_TYPES).toContain("derived.from");
  });

  it("emits a native image graph with input, output, media.report, and derived.from", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport, { scheduledDelayMs: 0 });

    const secret = new Uint8Array([9, 9, 9]);
    const result = await runCompletedMediaOperation({
      definition: imageDefinition(),
      provider: "openai",
      operation: "generateImage",
      model: "gpt-image-1",
      input: {
        model: "gpt-image-1",
        prompt: "a cat",
        image: secret,
      },
    });
    await observe.flush();

    expect(result.execution).toEqual({ kind: "native", calls: 1 });
    expectBalancedGraph(transport.records);

    const spans = recordsOfType(transport.records, "span:start");
    expect(spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: "media",
          primitive: "media.generate_image",
          attributes: expect.objectContaining({
            provider: "openai",
            model: "gpt-image-1",
          }),
        }),
      ]),
    );

    const artifacts = recordsOfType(transport.records, "artifact");
    const kinds = artifacts.map((artifact) => artifact.kind).sort();
    expect(kinds).toEqual(["input", "media.report", "output"].sort());

    const report = artifacts.find((artifact) => artifact.kind === "media.report");
    expect(report?.preview).toEqual(
      expect.objectContaining({
        kind: "image",
        count: 1,
        execution: { kind: "native", calls: 1 },
      }),
    );

    const edges = recordsOfType(transport.records, "edge");
    expect(edges.map((edge) => edge.edgeType).sort()).toEqual(
      expect.arrayContaining(["consumed", "produced", "derived.from"].sort()),
    );
    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ edgeType: "derived.from" }),
      ]),
    );

    const serialized = JSON.stringify(transport.records);
    for (const token of FORBIDDEN) {
      expect(serialized).not.toContain(token);
    }
    expect(serialized).not.toContain(String.fromCharCode(9, 9, 9));
  });

  it("nests generation.call under composed transcription and preserves exact call counts", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport, { scheduledDelayMs: 0 });

    const result = await runCompletedMediaOperation({
      definition: transcriptionDefinition(true),
      provider: "google",
      operation: "transcribe",
      model: "gemini-2.5-flash",
      input: {
        model: "gemini-2.5-flash",
        audio: new Uint8Array([1, 2, 3, 4]),
      },
    });
    await observe.flush();

    expect(result.execution).toEqual({
      kind: "composed",
      calls: 1,
      operations: ["generation.call"],
    });

    const starts = recordsOfType(transport.records, "span:start");
    expect(starts.map((span) => span.primitive)).toEqual(
      expect.arrayContaining(["media.transcribe", "generation.call"]),
    );

    const media = starts.find((span) => span.primitive === "media.transcribe");
    const child = starts.find((span) => span.primitive === "generation.call");
    expect(child?.parentSpanId).toBe(media?.spanId);

    const edges = recordsOfType(transport.records, "edge");
    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ edgeType: "called" }),
        expect.objectContaining({ edgeType: "derived.from" }),
      ]),
    );

    const report = recordsOfType(transport.records, "artifact").find(
      (artifact) => artifact.kind === "media.report",
    );
    expect(report?.preview).toEqual(
      expect.objectContaining({
        kind: "audio",
        segments: 2,
        execution: {
          kind: "composed",
          calls: 1,
          operations: ["generation.call"],
        },
      }),
    );
  });

  it("records fallback attempts with exact status, provider, model, and call counts", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport, { scheduledDelayMs: 0 });

    let attempts = 0;
    const result = await runCompletedMediaOperation({
      definition: imageDefinition(async (model, _signal, call) => {
        attempts += 1;
        if (model === "primary") {
          return call("image.generate", async () => {
            throw Object.assign(new Error("primary failed"), { status: 503 });
          });
        }
        return call("image.generate", async () => ({
          images: [new Uint8Array([4, 5])],
        }));
      }),
      provider: "openai",
      operation: "generateImage",
      model: fallback(["primary", "secondary"]),
      input: {
        model: "primary",
        prompt: "recover",
      },
    });
    await observe.flush();

    expect(result.execution.calls).toBe(2);
    expect(attempts).toBe(2);

    const ends = recordsOfType(transport.records, "span:end");
    expect(ends.some((span) => span.status === "ok")).toBe(true);

    const mediaEnd = ends.find((span) => {
      const start = recordsOfType(transport.records, "span:start").find(
        (item) => item.spanId === span.spanId,
      );
      return start?.primitive === "media.generate_image";
    });
    expect(mediaEnd?.attributes).toEqual(
      expect.objectContaining({
        executionKind: "native",
        calls: 2,
        status: "ok",
      }),
    );
  });

  it("emits a failed media span without retaining secret media locators", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport, { scheduledDelayMs: 0 });

    await expect(
      runCompletedMediaOperation({
        definition: imageDefinition(async (_model, _signal, call) =>
          call("image.generate", async () => {
            throw Object.assign(new Error("provider boom"), {
              fileId: "SECRET_ID",
              url: "https://example.com/SECRET_URL",
            });
          }),
        ),
        provider: "openai",
        operation: "generateImage",
        model: "gpt-image-1",
        input: {
          model: "gpt-image-1",
          prompt: "fail",
          image: new Uint8Array([7, 7, 7]),
        },
      }),
    ).rejects.toThrow(/provider boom/);
    await observe.flush();

    const ends = recordsOfType(transport.records, "span:end");
    expect(ends.some((span) => span.status === "error")).toBe(true);
    const serialized = JSON.stringify(transport.records);
    for (const token of FORBIDDEN) {
      expect(serialized).not.toContain(token);
    }
  });

  it.each(["full", "safe", "evidence", "off"] as const)(
    "never retains raw media under capture level %s",
    async (level) => {
      const transport = createInMemoryObservabilityTransport();
      setObservabilityTransport(transport, { scheduledDelayMs: 0 });
      updateHooks({
        observabilityCapture: {
          capture: level,
          recordInputs: true,
          recordOutputs: true,
        },
      });

      await runCompletedMediaOperation({
        definition: transcriptionDefinition(false),
        provider: "openai",
        operation: "transcribe",
        model: "whisper-1",
        input: {
          model: "whisper-1",
          audio: new Uint8Array([8, 8, 8, 8]),
        },
      });
      await observe.flush();

      const serialized = JSON.stringify(transport.records);
      for (const token of [
        "SECRET",
        "data:",
        "asset://",
        String.fromCharCode(8, 8, 8, 8),
      ]) {
        expect(serialized).not.toContain(token);
      }
      expect(
        recordsOfType(transport.records, "artifact").some(
          (artifact) => artifact.kind === "media.report",
        ),
      ).toBe(true);
    },
  );
});
