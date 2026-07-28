import { describe, expect, it } from "vitest";
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
import { boundary, guardrail, GuardrailBlockedError } from "../../src/safety";

const primaryImage = asset(1);
const backupImage = asset(2);
const providerFailure = Object.assign(new Error("primary failed"), {
  status: 503,
});

type NativeEvent =
  | Readonly<{ kind: "preview"; image: typeof primaryImage }>
  | Readonly<{ kind: "delta"; data: Uint8Array }>;

describe("streaming operation routing commitment", () => {
  it("falls back after open failure before any public provider event", async () => {
    const opened: string[] = [];
    const result = await createFallbackStream(
      [],
      opened,
    )({
      model: fallback(["primary", "backup"]),
      prompt: "A quiet canal",
    });

    const events = await collect(result.fullStream);

    expect(opened).toEqual(["primary", "backup"]);
    expect(events.map(({ type }) => type)).toEqual([
      "start",
      "image",
      "finish",
    ]);
    const completion = await result.completion;
    expect(completion.image).toBe(backupImage);
    expect(completion.routing).toMatchObject({
      model: "backup",
      trace: [
        {
          kind: "fallback",
          attempts: [
            { model: "primary", status: "error" },
            { model: "backup", status: "ok" },
          ],
        },
      ],
    });
  });

  it("does not commit a held delta", async () => {
    const opened: string[] = [];
    const result = await createFallbackStream(
      [{ kind: "delta", data: primaryImage.data }],
      opened,
    )({
      model: fallback(["primary", "backup"]),
      prompt: "A quiet canal",
      guardrails: [
        guardrail({
          id: "hold-primary-delta",
          on: boundary.output.media(),
          run: () => ({ action: "allow" }),
        }),
      ],
    });

    const events = await collect(result.fullStream);

    expect(opened).toEqual(["primary", "backup"]);
    expect(events.map(({ type }) => type)).toEqual([
      "start",
      "image",
      "finish",
    ]);
  });

  it("does not commit a stripped preview", async () => {
    const opened: string[] = [];
    const result = await createFallbackStream(
      [{ kind: "preview", image: primaryImage }],
      opened,
    )({
      model: fallback(["primary", "backup"]),
      prompt: "A quiet canal",
      guardrails: [
        guardrail({
          id: "strip-primary-preview",
          on: boundary.output.media(),
          run: (subject) =>
            subject.origin.operation === "streamImage" &&
            subject.origin.phase === "preview"
              ? { action: "strip", reason: "Suppress preview." }
              : { action: "allow" },
        }),
      ],
    });

    const events = await collect(result.fullStream);
    expect(opened).toEqual(["primary", "backup"]);
    expect(events.map(({ type }) => type)).toEqual([
      "start",
      "image",
      "finish",
    ]);
  });

  it.each([
    {
      name: "allowed preview",
      event: { kind: "preview", image: primaryImage } as const,
      guardrails: [
        guardrail({
          id: "allow-primary-preview",
          on: boundary.output.media(),
          run: () => ({ action: "allow" }),
        }),
      ],
      publishedType: "image-preview",
    },
    {
      name: "live delta",
      event: { kind: "delta", data: primaryImage.data } as const,
      guardrails: undefined,
      publishedType: "image-delta",
    },
  ])(
    "makes post-$name provider failure terminal",
    async ({ event, guardrails, publishedType }) => {
      const opened: string[] = [];
      const result = await createFallbackStream(
        [event],
        opened,
      )({
        model: fallback(["primary", "backup"]),
        prompt: "A quiet canal",
        ...(guardrails ? { guardrails } : {}),
      });

      const current = await collectFailure(result.fullStream);
      const completionError = await result.completion.catch(
        (error: unknown) => error,
      );

      expect(opened).toEqual(["primary"]);
      expect(current.values.map(({ type }) => type)).toEqual([
        "start",
        publishedType,
      ]);
      expect(current.error).toBe(providerFailure);
      expect(completionError).toBe(providerFailure);
      expect(
        (
          current.error as Error & {
            readonly routing?: {
              readonly trace: readonly Readonly<{
                midStreamFailure?: boolean;
              }>[];
            };
          }
        ).routing?.trace[0]?.midStreamFailure,
      ).toBe(true);
    },
  );

  it("never retries a Safety block before publication", async () => {
    const opened: string[] = [];
    const result = await createFallbackStream(
      [{ kind: "preview", image: primaryImage }],
      opened,
    )({
      model: fallback(["primary", "backup"]),
      prompt: "A quiet canal",
      guardrails: [
        guardrail({
          id: "block-primary-preview",
          on: boundary.output.media(),
          run: () => ({ action: "block", reason: "Unsafe preview." }),
        }),
      ],
    });

    const outcome = await collectFailure(result.fullStream);
    expect(opened).toEqual(["primary"]);
    expect(outcome.error).toBeInstanceOf(GuardrailBlockedError);
  });
});

function createFallbackStream(
  primaryEvents: readonly NativeEvent[],
  opened: string[],
) {
  const operation = defineStreamingOperation({
    normalize: (input: GenerateImageOptions<string>) => input,
    support: () => "supported" as const,
    open: async (input) => {
      const model = String(input.model);
      opened.push(model);
      return {
        events: (async function* () {
          if (model === "primary") {
            yield* primaryEvents;
            throw providerFailure;
          }
        })(),
        map: (event: NativeEvent) =>
          event.kind === "preview"
            ? ({
                type: "image-preview",
                image: event.image,
                outputIndex: 0,
                sequence: 0,
              } satisfies ImageStreamEvent)
            : ({
                type: "image-delta",
                data: event.data,
                mediaType: "image/png",
                outputIndex: 0,
                sequence: 0,
              } satisfies ImageStreamEvent),
        completion:
          model === "primary"
            ? new Promise<never>(() => {})
            : Promise.resolve({ model }),
      };
    },
    validate: (raw) =>
      createGeneratedImageResult(
        [raw.model === "backup" ? backupImage : primaryImage],
        {
          warnings: [],
          execution: { kind: "native", calls: 1 },
          raw,
        },
      ),
    report: () => ({}),
    conformance: [],
  });
  return bindStreamingOperation({
    definition: operation,
    provider: "test",
    operation: "streamImage",
  });
}

function asset(value: number) {
  return Object.freeze({
    type: "data" as const,
    data: new Uint8Array([value]),
    mediaType: "image/png",
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
