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

const generatedImage = Object.freeze({
  type: "data" as const,
  data: new Uint8Array([1, 2, 3]),
  mediaType: "image/png",
});

describe("managed streaming operation replay", () => {
  it("drives the source and settles completion without a reader", async () => {
    let sourceDriven = false;
    const operation = defineStreamingOperation({
      normalize: (input: GenerateImageOptions<"image-model">) => input,
      support: () => "supported" as const,
      open: async () => {
        let resolveNative!: (value: Readonly<{ requestId: string }>) => void;
        const completion = new Promise<Readonly<{ requestId: string }>>(
          (resolve) => {
            resolveNative = resolve;
          },
        );
        return {
          events: (async function* () {
            yield { image: generatedImage };
            sourceDriven = true;
            resolveNative({ requestId: "request-1" });
          })(),
          map: (event: { readonly image: typeof generatedImage }) =>
            ({
              type: "image-preview",
              image: event.image,
              outputIndex: 0,
              sequence: 0,
            }) satisfies ImageStreamEvent,
          completion,
        };
      },
      validate: (native) =>
        createGeneratedImageResult([generatedImage], {
          warnings: [],
          execution: { kind: "native", calls: 1 },
          raw: native,
        }),
      report: () => ({}),
      conformance: [],
    });
    const streamImage = bindStreamingOperation({
      definition: operation,
      provider: "test",
      operation: "streamImage",
    });

    const result = await streamImage({
      model: "image-model",
      prompt: "A quiet canal",
    });

    await expect(settlesSoon(result.completion)).resolves.toBe(true);
    expect(sourceDriven).toBe(true);
  });

  it("gives concurrent readers the same Core-framed event objects", async () => {
    const streamImage = createReplayableImageStream();
    const result = await streamImage({
      model: "image-model",
      prompt: "A quiet canal",
    });

    const [first, second] = await Promise.all([
      collect(result.fullStream),
      collect(result.fullStream),
    ]);

    expect(first.map(({ type }) => type)).toEqual([
      "start",
      "image-preview",
      "image",
      "finish",
    ]);
    expect(second).toEqual(first);
    expect(second[1]).toBe(first[1]);
    if (first[1]?.type !== "image-preview") {
      throw new Error("Expected one image preview.");
    }
    expect(first[1].image).toBe(generatedImage);
    expect(first[1].image.data).toBe(generatedImage.data);
  });

  it("replays the complete sequence to a reader joining after completion", async () => {
    const result = await createReplayableImageStream()({
      model: "image-model",
      prompt: "A quiet canal",
    });

    await result.completion;

    await expect(collect(result.fullStream)).resolves.toMatchObject([
      { type: "start" },
      { type: "image-preview" },
      { type: "image" },
      { type: "finish" },
    ]);
  });

  it("replays the committed prefix before one shared terminal failure", async () => {
    const failure = new Error("native stream failed");
    const operation = defineStreamingOperation({
      normalize: (input: GenerateImageOptions<"image-model">) => input,
      support: () => "supported" as const,
      open: async () => ({
        events: (async function* () {
          yield { image: generatedImage };
          throw failure;
        })(),
        map: (event: { readonly image: typeof generatedImage }) =>
          ({
            type: "image-preview",
            image: event.image,
            outputIndex: 0,
            sequence: 0,
          }) satisfies ImageStreamEvent,
        completion: new Promise<never>(() => {}),
      }),
      validate: () => {
        throw new Error("unreachable");
      },
      report: () => ({}),
      conformance: [],
    });
    const streamImage = bindStreamingOperation({
      definition: operation,
      provider: "test",
      operation: "streamImage",
    });
    const result = await streamImage({
      model: "image-model",
      prompt: "A quiet canal",
    });

    const first = await collectFailure(result.fullStream);
    await expect(result.completion).rejects.toBe(failure);
    const late = await collectFailure(result.fullStream);

    expect(first.values.map(({ type }) => type)).toEqual([
      "start",
      "image-preview",
    ]);
    expect(late.values).toEqual(first.values);
    expect(first.error).toBe(failure);
    expect(late.error).toBe(failure);
  });

  it("rejects a provider boundary before it enters the logical log", async () => {
    const operation = defineStreamingOperation({
      normalize: (input: GenerateImageOptions<"image-model">) => input,
      support: () => "supported" as const,
      open: async () => ({
        events: (async function* () {
          yield "provider-start";
        })(),
        map: () =>
          ({ type: "start" }) as unknown as Extract<
            ImageStreamEvent,
            { readonly type: "image-preview" }
          >,
        completion: Promise.resolve({ requestId: "request-1" }),
      }),
      validate: (native) =>
        createGeneratedImageResult([generatedImage], {
          warnings: [],
          execution: { kind: "native", calls: 1 },
          raw: native,
        }),
      report: () => ({}),
      conformance: [],
    });
    const result = await bindStreamingOperation({
      definition: operation,
      provider: "test",
      operation: "streamImage",
    })({ model: "image-model", prompt: "A quiet canal" });

    const outcome = await collectFailure(result.fullStream);
    const completionError = await result.completion.catch(
      (error: unknown) => error,
    );

    expect(outcome.values).toEqual([{ type: "start" }]);
    expect(outcome.error).toBeInstanceOf(TypeError);
    expect(completionError).toBe(outcome.error);
  });
});

async function settlesSoon(promise: Promise<unknown>): Promise<boolean> {
  return Promise.race([
    promise.then(() => true),
    new Promise<false>((resolve) => setTimeout(resolve, 50, false)),
  ]);
}

function createReplayableImageStream() {
  const operation = defineStreamingOperation({
    normalize: (input: GenerateImageOptions<"image-model">) => input,
    support: () => "supported" as const,
    open: async () => ({
      events: (async function* () {
        yield { image: generatedImage };
      })(),
      map: (event: { readonly image: typeof generatedImage }) =>
        ({
          type: "image-preview",
          image: event.image,
          outputIndex: 0,
          sequence: 0,
        }) satisfies ImageStreamEvent,
      completion: Promise.resolve({ requestId: "request-1" }),
    }),
    validate: (native) =>
      createGeneratedImageResult([generatedImage], {
        warnings: [],
        execution: { kind: "native", calls: 1 },
        raw: native,
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
