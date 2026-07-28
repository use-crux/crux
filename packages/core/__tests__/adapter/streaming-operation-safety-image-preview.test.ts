import { describe, expect, it, vi } from "vitest";
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
  boundary,
  guardrail,
  GuardrailBlockedError,
  type MediaPartSubject,
} from "../../src/safety";

const preview = Object.freeze({
  type: "data" as const,
  data: new Uint8Array([1, 2, 3]),
  mediaType: "image/png",
});

describe("streaming operation Safety — image previews", () => {
  it("guards a closed preview before publishing it", async () => {
    let subject: MediaPartSubject | undefined;
    const run = vi.fn((value: MediaPartSubject, context) => {
      if (
        value.origin.kind === "operation" &&
        value.origin.operation === "streamImage" &&
        value.origin.phase === "preview"
      ) {
        subject = value;
        expect(context.stream?.media).toEqual({
          phase: "preview",
          outputIndex: 2,
          sequence: 7,
        });
      }
      return { action: "allow" as const };
    });
    const result = await createPreviewStream()({
      model: "image-model",
      prompt: "A quiet canal",
      guardrails: [
        guardrail({
          id: "allow-stream-image-preview",
          on: boundary.output.media(),
          run,
        }),
      ],
    });

    await expect(collect(result.fullStream)).resolves.toMatchObject([
      { type: "start" },
      { type: "image-preview", outputIndex: 2, sequence: 7 },
      { type: "image", outputIndex: 0 },
      { type: "finish" },
    ]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(subject?.part.source).toBe(preview);
    expect(subject?.origin).toEqual({
      kind: "operation",
      operation: "streamImage",
      phase: "preview",
      field: "images",
      outputIndex: 2,
      sequence: 7,
    });
  });

  it("publishes warnings with findings and payload-free audit provenance", async () => {
    const result = await createPreviewStream()({
      model: "image-model",
      prompt: "A quiet canal",
      guardrails: [
        guardrail({
          id: "warn-stream-image-preview",
          on: boundary.output.media(),
          run: (_subject, context) => {
            context.findings.add({ type: "review", category: "uncertain" });
            return { action: "warn", reason: "Review this preview." };
          },
        }),
      ],
    });

    await expect(collect(result.fullStream)).resolves.toHaveLength(4);
    const completion = await result.completion;
    const entry = completion.safety?.guardrails?.applied.find(
      ({ location }) =>
        location?.origin.kind === "operation" &&
        location.origin.operation === "streamImage" &&
        location.origin.phase === "preview",
    );
    expect(entry).toMatchObject({
      guard: "warn-stream-image-preview",
      action: "warn",
      findings: [{ type: "review", category: "uncertain" }],
      location: {
        origin: {
          operation: "streamImage",
          phase: "preview",
          outputIndex: 2,
          sequence: 7,
        },
        partType: "image",
      },
    });
    expect(JSON.stringify(entry)).not.toContain("source");
    expect(JSON.stringify(entry)).not.toContain("mediaType");
    expect(JSON.stringify(entry)).not.toContain("1,2,3");
  });

  it("suppresses one stripped preview while allowing a later occurrence", async () => {
    const result = await createPreviewStream([
      { image: preview, outputIndex: 2, sequence: 7 },
      { image: preview, outputIndex: 2, sequence: 8 },
    ])({
      model: "image-model",
      prompt: "A quiet canal",
      guardrails: [
        guardrail({
          id: "strip-stream-image-preview",
          on: boundary.output.media(),
          run: (subject) =>
            subject.origin.operation === "streamImage" &&
            subject.origin.phase === "preview" &&
            subject.origin.sequence === 7
              ? { action: "strip", reason: "Suppress first preview." }
              : { action: "allow" },
        }),
      ],
    });

    const events = await collect(result.fullStream);
    expect(events.map(({ type }) => type)).toEqual([
      "start",
      "image-preview",
      "image",
      "finish",
    ]);
    expect(events[1]).toMatchObject({ sequence: 8 });
  });

  it("fails every surface when an enforcing preview policy blocks", async () => {
    const result = await createPreviewStream()({
      model: "image-model",
      prompt: "A quiet canal",
      guardrails: [
        guardrail({
          id: "block-stream-image-preview",
          on: boundary.output.media(),
          run: () => ({ action: "block", reason: "Unsafe preview." }),
        }),
      ],
    });

    const first = await collectFailure(result.fullStream);
    const completionError = await result.completion.catch(
      (error: unknown) => error,
    );
    const late = await collectFailure(result.fullStream);

    expect(first.values).toEqual([{ type: "start" }]);
    expect(first.error).toBeInstanceOf(GuardrailBlockedError);
    expect(completionError).toBe(first.error);
    expect(late.error).toBe(first.error);
    expect(
      JSON.stringify((first.error as GuardrailBlockedError).decisions),
    ).not.toContain("source");
  });

  it.each(["strip", "block"] as const)(
    "publishes and records report-mode %s",
    async (action) => {
      const result = await createPreviewStream()({
        model: "image-model",
        prompt: "A quiet canal",
        guardrails: [
          guardrail({
            id: `report-${action}-stream-image-preview`,
            mode: "report",
            on: boundary.output.media(),
            run: () => ({ action, reason: `Would ${action} preview.` }),
          }),
        ],
      });

      await expect(collect(result.fullStream)).resolves.toHaveLength(4);
      const completion = await result.completion;
      expect(completion.safety?.guardrails?.applied).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action, mode: "report" }),
        ]),
      );
    },
  );
});

type NativePreview = Readonly<{
  image: typeof preview;
  outputIndex: number;
  sequence: number;
}>;

function createPreviewStream(
  previews: readonly NativePreview[] = [
    { image: preview, outputIndex: 2, sequence: 7 },
  ],
) {
  const operation = defineStreamingOperation({
    normalize: (input: GenerateImageOptions<"image-model">) => input,
    support: () => "supported" as const,
    open: async () => ({
      events: (async function* () {
        yield* previews;
      })(),
      map: (event: NativePreview) =>
        ({
          type: "image-preview",
          image: event.image,
          outputIndex: event.outputIndex,
          sequence: event.sequence,
        }) satisfies ImageStreamEvent,
      completion: Promise.resolve({ requestId: "image-1" }),
    }),
    validate: (raw) =>
      createGeneratedImageResult([preview], {
        warnings: [],
        execution: { kind: "native", calls: 1 },
        raw,
      }),
    report: () => ({}),
    conformance: [],
  });
  return bindStreamingOperation({
    definition: operation,
    provider: "test",
    operation: "streamImage",
  });
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}

async function collectFailure<T>(
  stream: AsyncIterable<T>,
): Promise<Readonly<{ values: readonly T[]; error: unknown }>> {
  const values: T[] = [];
  try {
    for await (const value of stream) values.push(value);
  } catch (error) {
    return { values, error };
  }
  throw new Error("Expected stream to fail.");
}
