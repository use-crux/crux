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
import {
  createRuntimeClient,
  createSingleTurnTestRuntime,
} from "./provider-runtime-fixtures";

const generatedImage = Object.freeze({
  type: "data" as const,
  data: new Uint8Array([1, 2, 3]),
  mediaType: "image/png",
});

describe("bounded streaming operation definitions", () => {
  it("maps one native event and resolves the exact completed result", async () => {
    const operation = imageStreamOperation(1);
    const streamImage = bindStreamingOperation({
      definition: operation,
      provider: "test",
      operation: "streamImage",
    });

    const result = await streamImage({
      model: "image-model",
      prompt: "A quiet canal",
    });

    await expect(toArray(result.fullStream)).resolves.toEqual([
      { type: "start" },
      {
        type: "image-preview",
        image: generatedImage,
        outputIndex: 0,
        sequence: 0,
      },
      { type: "image", image: generatedImage, outputIndex: 0 },
      { type: "finish" },
    ]);
    await expect(result.completion).resolves.toMatchObject({
      image: generatedImage,
      images: [generatedImage],
      raw: { requestId: "request-1" },
      providerMetadata: { requestId: "request-1" },
      _meta: result._meta,
    });
    expect(result.runId).toMatch(/^run_[0-9a-f]{24}$/u);
  });

  it("reuses one frozen definition with independent per-call mapper state", async () => {
    const operation = imageStreamOperation(2);
    const streamImage = bindStreamingOperation({
      definition: operation,
      provider: "test",
      operation: "streamImage",
    });

    const [first, second] = await Promise.all([
      streamImage({ model: "image-model", prompt: "First" }),
      streamImage({ model: "image-model", prompt: "Second" }),
    ]);
    const [firstEvents, secondEvents] = await Promise.all([
      toArray(first.fullStream),
      toArray(second.fullStream),
    ]);

    expect(Object.isFrozen(operation)).toBe(true);
    expect(firstEvents.flatMap(readSequence)).toEqual([0, 1]);
    expect(secondEvents.flatMap(readSequence)).toEqual([0, 1]);
  });

  it("adds only declared streams to a provider runtime", async () => {
    const provider = createSingleTurnTestRuntime("streaming-runtime", {
      streaming: {
        image: () => imageStreamOperation(1),
      },
    });
    const runtime = provider.create(createRuntimeClient());

    expect(runtime).toHaveProperty("streamImage");
    expect(runtime).not.toHaveProperty("streamSpeech");

    const result = await runtime.streamImage({
      model: "image-model",
      prompt: "A quiet canal",
    });
    await expect(toArray(result.fullStream)).resolves.toHaveLength(4);
  });
});

function imageStreamOperation(previewCount: number) {
  return defineStreamingOperation({
    normalize: (input: GenerateImageOptions<"image-model">) => input,
    support: () => "supported" as const,
    open: async (_input, context) => {
      const native = await context.call("image.generate", async () => ({
        requestId: "request-1",
      }));
      let sequence = 0;
      return {
        events: nativePreviews(previewCount),
        map: (event: { readonly image: typeof generatedImage }) =>
          ({
            type: "image-preview",
            image: event.image,
            outputIndex: 0,
            sequence: sequence++,
          }) satisfies ImageStreamEvent,
        completion: Promise.resolve(native),
      };
    },
    validate: (native) =>
      createGeneratedImageResult([generatedImage], {
        warnings: [],
        providerMetadata: { requestId: native.requestId },
        execution: { kind: "native", calls: 1 },
        raw: native,
      }),
    report: (result) => ({ imageCount: result.images.length }),
    conformance: [],
  });
}

async function* nativePreviews(count: number) {
  for (let index = 0; index < count; index += 1) {
    yield { image: generatedImage };
  }
}

function readSequence(event: ImageStreamEvent): readonly number[] {
  return event.type === "image-preview" ? [event.sequence] : [];
}

async function toArray<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}
