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

describe("managed streaming operation cancellation", () => {
  it("detaches an early reader without stopping the operation", async () => {
    const releaseSource = deferred<void>();
    const nativeCompletion = deferred<Readonly<{ requestId: string }>>();
    const streamImage = createStreamImage({
      events: (async function* () {
        yield { image: generatedImage };
        await releaseSource.promise;
        nativeCompletion.resolve({ requestId: "request-1" });
      })(),
      completion: nativeCompletion.promise,
    });
    const result = await streamImage({
      model: "image-model",
      prompt: "A quiet canal",
    });
    const early = result.fullStream[Symbol.asyncIterator]();

    await expect(early.next()).resolves.toMatchObject({
      value: { type: "start" },
    });
    await early.return?.();
    releaseSource.resolve();

    await expect(result.completion).resolves.toBeDefined();
    await expect(collectTypes(result.fullStream)).resolves.toEqual([
      "start",
      "image-preview",
      "image",
      "finish",
    ]);
  });

  it("cancel settles a source that does not cooperate with abort", async () => {
    const { streamImage, previewPublished, sourceAborted } =
      createUncooperativeStream();
    const result = await streamImage({
      model: "image-model",
      prompt: "A quiet canal",
    });
    await previewPublished.promise;
    const firstReader = collectFailure(result.fullStream);
    const secondReader = collectFailure(result.fullStream);

    result.cancel("stop");

    const [first, second, completionError, sourceError] = await Promise.all([
      firstReader,
      secondReader,
      result.completion.catch((error: unknown) => error),
      sourceAborted.promise,
    ]);

    expect(first.values).toEqual(["start", "image-preview"]);
    expect(second.values).toEqual(first.values);
    expect(first.error).toBeInstanceOf(DOMException);
    expect((first.error as DOMException).name).toBe("AbortError");
    expect(second.error).toBe(first.error);
    expect(completionError).toBe(first.error);
    expect(sourceError).toBe(first.error);
  });

  it("gives caller abort the same whole-operation authority", async () => {
    const controller = new AbortController();
    const reason = new Error("caller stopped");
    const { streamImage, previewPublished, sourceAborted } =
      createUncooperativeStream();
    const result = await streamImage({
      model: "image-model",
      prompt: "A quiet canal",
      abortSignal: controller.signal,
    });
    await previewPublished.promise;
    const currentReader = collectFailure(result.fullStream);

    controller.abort(reason);

    const [current, late, completionError, sourceError] = await Promise.all([
      currentReader,
      collectFailure(result.fullStream),
      result.completion.catch((error: unknown) => error),
      sourceAborted.promise,
    ]);
    expect(current.values).toEqual(["start", "image-preview"]);
    expect(late.values).toEqual(current.values);
    expect(current.error).toBe(reason);
    expect(late.error).toBe(reason);
    expect(completionError).toBe(reason);
    expect(sourceError).toBe(reason);
  });
});

function createStreamImage(source: {
  readonly events: AsyncIterable<Readonly<{ image: typeof generatedImage }>>;
  readonly completion: Promise<Readonly<{ requestId: string }>>;
}) {
  const operation = defineStreamingOperation({
    normalize: (input: GenerateImageOptions<"image-model">) => input,
    support: () => "supported" as const,
    open: async () => ({
      ...source,
      map: (event: { readonly image: typeof generatedImage }) =>
        ({
          type: "image-preview",
          image: event.image,
          outputIndex: 0,
          sequence: 0,
        }) satisfies ImageStreamEvent,
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

function createUncooperativeStream() {
  const previewPublished = deferred<void>();
  const sourceAborted = deferred<unknown>();
  const operation = defineStreamingOperation({
    normalize: (input: GenerateImageOptions<"image-model">) => input,
    support: () => "supported" as const,
    open: async (_input, { signal }) => {
      signal.addEventListener(
        "abort",
        () => sourceAborted.resolve(signal.reason),
        { once: true },
      );
      return {
        events: (async function* () {
          yield { image: generatedImage };
          await new Promise<never>(() => {});
        })(),
        map: (event: { readonly image: typeof generatedImage }) => {
          previewPublished.resolve();
          return {
            type: "image-preview" as const,
            image: event.image,
            outputIndex: 0,
            sequence: 0,
          };
        },
        completion: new Promise<never>(() => {}),
      };
    },
    validate: () => {
      throw new Error("unreachable");
    },
    report: () => ({}),
    conformance: [],
  });
  return {
    streamImage: bindStreamingOperation({
      definition: operation,
      provider: "test",
      operation: "streamImage",
    }),
    previewPublished,
    sourceAborted,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function collectTypes(
  stream: AsyncIterable<ImageStreamEvent>,
): Promise<string[]> {
  const types: string[] = [];
  for await (const event of stream) types.push(event.type);
  return types;
}

async function collectFailure(
  stream: AsyncIterable<ImageStreamEvent>,
): Promise<Readonly<{ values: readonly string[]; error: unknown }>> {
  const values: string[] = [];
  try {
    for await (const event of stream) values.push(event.type);
  } catch (error) {
    return { values, error };
  }
  throw new Error("Expected stream to fail.");
}
