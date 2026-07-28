import { expectTypeOf } from "vitest";
import type {
  Asset,
  GenerateImageResult,
  GenerateSpeechResult,
  ImageStreamEvent,
  SpeechStreamEvent,
  StreamImage,
  StreamImageOptions,
  StreamImageResult,
  StreamSpeech,
  StreamSpeechOptions,
  StreamSpeechResult,
  StreamingOperationResult,
} from "@use-crux/core";
import { router, type RouteArgs } from "@use-crux/core/routing";
import {
  defineProviderRuntime,
  defineStreamingOperation,
  type ProviderStreamingOperationFactories,
  type SingleTurnRuntimeContract,
  type StreamingOperationSource,
} from "@use-crux/core/adapter";

interface RawResult {
  readonly requestId: string;
}

interface ProviderMetadata {
  readonly region: string;
}

interface ProviderWarning {
  readonly code: string;
}

declare const imageResult: StreamImageResult<
  RawResult,
  ProviderMetadata,
  ProviderWarning
>;
declare const speechResult: StreamSpeechResult<
  RawResult,
  ProviderMetadata,
  ProviderWarning
>;
declare const streamImage: StreamImage<
  "image-model",
  never,
  RawResult,
  ProviderMetadata,
  ProviderWarning
>;
declare const streamSpeech: StreamSpeech<
  "speech-model",
  "alloy" | "echo",
  never,
  RawResult,
  ProviderMetadata,
  ProviderWarning
>;

expectTypeOf(imageResult.completion).toEqualTypeOf<
  Promise<GenerateImageResult<RawResult, ProviderMetadata, ProviderWarning>>
>();
expectTypeOf(imageResult).toMatchTypeOf<
  StreamingOperationResult<
    ImageStreamEvent,
    GenerateImageResult<RawResult, ProviderMetadata, ProviderWarning>
  >
>();
expectTypeOf(speechResult.completion).toEqualTypeOf<
  Promise<GenerateSpeechResult<RawResult, ProviderMetadata, ProviderWarning>>
>();

const directImage = streamImage({
  model: "image-model",
  prompt: "A quiet canal",
});
expectTypeOf(directImage).toEqualTypeOf<
  Promise<StreamImageResult<RawResult, ProviderMetadata, ProviderWarning>>
>();

const directSpeech = streamSpeech({
  model: "speech-model",
  text: "Hello",
  voice: "alloy",
});
expectTypeOf(directSpeech).toEqualTypeOf<
  Promise<StreamSpeechResult<RawResult, ProviderMetadata, ProviderWarning>>
>();

const routedImageModel = router({
  classify: ({ context }: RouteArgs<{ readonly tier: "pro" | "free" }>) =>
    context.tier,
  routes: {
    pro: "image-model",
    free: "image-model",
    default: "image-model",
  },
});
void streamImage({
  model: routedImageModel,
  prompt: "A quiet canal",
  routing: { tier: "pro" },
  route: "pro",
});
// @ts-expect-error - routed media operations require classifier context.
void streamImage({ model: routedImageModel, prompt: "A quiet canal" });

declare const imageOptions: StreamImageOptions<"image-model">;
declare const speechOptions: StreamSpeechOptions<"speech-model", "alloy">;
// @ts-expect-error - call options are immutable.
imageOptions.model = "other-model";
// @ts-expect-error - call options are immutable.
speechOptions.text = "changed";

function visitImageEvent(event: ImageStreamEvent): void {
  switch (event.type) {
    case "start":
    case "finish":
      return;
    case "image-preview":
      expectTypeOf(event.sequence).toEqualTypeOf<number>();
      expectTypeOf(event.outputIndex).toEqualTypeOf<number>();
      return;
    case "image-delta":
      expectTypeOf(event.data).toEqualTypeOf<Uint8Array>();
      expectTypeOf(event.mediaType).toEqualTypeOf<string>();
      return;
    case "image":
      expectTypeOf(event.outputIndex).toEqualTypeOf<number>();
      return;
    default:
      return assertNever(event);
  }
}

function visitSpeechEvent(event: SpeechStreamEvent): void {
  switch (event.type) {
    case "start":
    case "finish":
      return;
    case "audio-delta":
      expectTypeOf(event.data).toEqualTypeOf<Uint8Array>();
      expectTypeOf(event.sequence).toEqualTypeOf<number>();
      return;
    case "audio":
      expectTypeOf(event.audio.mediaType).toEqualTypeOf<string>();
      return;
    default:
      return assertNever(event);
  }
}

declare const preview: Extract<
  ImageStreamEvent,
  { readonly type: "image-preview" }
>;
// @ts-expect-error - canonical event payloads are immutable.
preview.sequence = 1;

declare const audioDelta: Extract<
  SpeechStreamEvent,
  { readonly type: "audio-delta" }
>;
// @ts-expect-error - canonical byte views cannot be replaced by consumers.
audioDelta.data = new Uint8Array();

interface NativePreview {
  readonly bytes: Uint8Array;
}

interface NativeCompletion {
  readonly requestId: string;
}

declare const nativeEvents: AsyncIterable<NativePreview>;
declare const imageAsset: Asset;

const definition = defineStreamingOperation({
  normalize: (input: Readonly<{ model: "image-model"; prompt: string }>) => ({
    prompt: input.prompt.trim(),
  }),
  support: () => "supported" as const,
  open: async (_input, context) => {
    expectTypeOf(context.model).toEqualTypeOf<"image-model">();
    let sequence = 0;
    return {
      events: nativeEvents,
      map(event: NativePreview) {
        return {
          type: "image-delta" as const,
          data: event.bytes,
          mediaType: "image/png",
          outputIndex: 0,
          sequence: sequence++,
        };
      },
      completion: Promise.resolve({ requestId: "request-1" }),
    } satisfies StreamingOperationSource<
      NativePreview,
      NativeCompletion,
      Extract<ImageStreamEvent, { readonly type: "image-delta" }>
    >;
  },
  validate: (native: NativeCompletion) => ({
    images: [imageAsset] as const,
    image: imageAsset,
    warnings: [] as const,
    execution: { kind: "native" as const, calls: 1 },
    raw: native,
  }),
  report: (result) => ({ requestId: result.raw.requestId }),
  conformance: [],
});

expectTypeOf<Parameters<typeof definition.normalize>[0]>().toEqualTypeOf<
  Readonly<{ model: "image-model"; prompt: string }>
>();
expectTypeOf<
  Parameters<typeof definition.open>[1]["model"]
>().toEqualTypeOf<"image-model">();
expectTypeOf(definition.support).returns.toEqualTypeOf<
  "supported" | "unsupported" | "unknown"
>();

interface StreamingClient {
  readonly id: string;
}
interface StreamingRequest {
  readonly model: string;
}
interface StreamingRawResponse {
  readonly text: string;
}
interface StreamingTextStream extends AsyncIterable<unknown> {}

const streamingFactories = {
  image: (_client: StreamingClient) => definition,
} satisfies ProviderStreamingOperationFactories<StreamingClient>;

declare const streamingClient: StreamingClient;
declare const turnContract: SingleTurnRuntimeContract<
  StreamingClient,
  StreamingRequest,
  StreamingRawResponse,
  StreamingTextStream,
  Record<string, unknown>
>;

const imageStreamingProvider = defineProviderRuntime({
  id: "image-streaming-provider",
  turn: turnContract,
  streaming: streamingFactories,
});
const imageStreamingRuntime = imageStreamingProvider.create(streamingClient);
expectTypeOf(imageStreamingRuntime.streamImage).toBeFunction();
// @ts-expect-error - the provider declared no speech stream.
imageStreamingRuntime.streamSpeech;

const completedOnlyProvider = defineProviderRuntime({
  id: "completed-only-provider",
  turn: turnContract,
});
const completedOnlyRuntime = completedOnlyProvider.create(streamingClient);
// @ts-expect-error - providers without factories expose no streaming methods.
completedOnlyRuntime.streamImage;

function assertNever(value: never): never {
  throw new TypeError(`Unexpected event: ${String(value)}`);
}

void visitImageEvent;
void visitSpeechEvent;
void definition;
