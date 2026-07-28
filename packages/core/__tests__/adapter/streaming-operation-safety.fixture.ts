import {
  createGeneratedImageResult,
  createGenerateSpeechResult,
  type GenerateImageOptions,
  type GenerateSpeechOptions,
  type ImageStreamEvent,
  type SpeechStreamEvent,
} from "../../src";
import {
  bindStreamingOperation,
  defineStreamingOperation,
} from "../../src/adapter";

export const imageChunk = new Uint8Array([1, 2]);
export const firstImage = Object.freeze({
  type: "data" as const,
  data: imageChunk,
  mediaType: "image/png",
});
export const secondImage = Object.freeze({
  type: "data" as const,
  data: new Uint8Array([3, 4]),
  mediaType: "image/png",
});
export const audioChunk = new Uint8Array([5, 6]);
export const finalAudio = Object.freeze({
  type: "data" as const,
  data: audioChunk,
  mediaType: "audio/mpeg",
});

export function imageDeltaStream(
  images: readonly [typeof firstImage, ...Array<typeof firstImage>] = [
    firstImage,
  ],
) {
  const operation = defineStreamingOperation({
    normalize: (input: GenerateImageOptions<"image-model">) => input,
    support: () => "supported" as const,
    open: async () => ({
      events: (async function* () {
        yield imageChunk;
      })(),
      map: (data: Uint8Array) =>
        ({
          type: "image-delta",
          data,
          mediaType: "image/png",
          outputIndex: 0,
          sequence: 0,
        }) satisfies ImageStreamEvent,
      completion: Promise.resolve({ requestId: "image-1" }),
    }),
    validate: (raw) =>
      createGeneratedImageResult(images, {
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

export function speechDeltaStream() {
  const operation = defineStreamingOperation({
    normalize: (input: GenerateSpeechOptions<"speech-model">) => input,
    support: () => "supported" as const,
    open: async () => ({
      events: (async function* () {
        yield audioChunk;
      })(),
      map: (data: Uint8Array) =>
        ({
          type: "audio-delta",
          data,
          mediaType: "audio/mpeg",
          sequence: 0,
        }) satisfies SpeechStreamEvent,
      completion: Promise.resolve({ requestId: "speech-1" }),
    }),
    validate: (raw) =>
      createGenerateSpeechResult(finalAudio, {
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
    operation: "streamSpeech",
  });
}

export async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}
