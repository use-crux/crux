import {
  createGeneratedImageResult,
  type GenerateImageOptions,
  type ImageStreamEvent,
} from "../../src";
import {
  bindStreamingOperation,
  defineStreamingOperation,
} from "../../src/adapter";
import type {
  StreamingOperationContext,
  StreamingOperationOpenContext,
  StreamingOperationSource,
} from "../../src/adapter/streaming-operation/definition";

export const testImage = Object.freeze({
  type: "data" as const,
  data: new Uint8Array([1, 2, 3]),
  mediaType: "image/png",
});

export type TestNativeEvent = Readonly<{ sequence: number }>;
export type TestNativeResult = Readonly<{ requestId: string }>;

/** Bind a minimal image stream while leaving its native lifecycle configurable. */
export function createTestImageStream(
  options: Readonly<{
    normalize?: (
      input: GenerateImageOptions<string>,
      context: StreamingOperationContext<string>,
    ) => GenerateImageOptions<string> | Promise<GenerateImageOptions<string>>;
    open: (
      input: GenerateImageOptions<string>,
      context: StreamingOperationOpenContext<string>,
    ) =>
      | StreamingOperationSource<
          TestNativeEvent,
          TestNativeResult,
          Extract<ImageStreamEvent, { readonly type: "image-delta" }>
        >
      | Promise<
          StreamingOperationSource<
            TestNativeEvent,
            TestNativeResult,
            Extract<ImageStreamEvent, { readonly type: "image-delta" }>
          >
        >;
  }>,
) {
  const definition = defineStreamingOperation({
    normalize:
      options.normalize ?? ((input: GenerateImageOptions<string>) => input),
    support: () => "supported" as const,
    open: options.open,
    validate: (native: TestNativeResult) =>
      createGeneratedImageResult([testImage], {
        warnings: [],
        execution: { kind: "native", calls: 1 },
        raw: native,
      }),
    report: () => ({}),
    conformance: [],
  });
  return bindStreamingOperation({
    definition,
    provider: "test",
    operation: "streamImage",
  });
}

/** Map one native test event to a canonical progressive image delta. */
export function mapTestEvent(
  event: TestNativeEvent,
): Extract<ImageStreamEvent, { readonly type: "image-delta" }> {
  return {
    type: "image-delta",
    data: testImage.data,
    mediaType: testImage.mediaType,
    outputIndex: 0,
    sequence: event.sequence,
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}

export async function collectFailure<T>(
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
