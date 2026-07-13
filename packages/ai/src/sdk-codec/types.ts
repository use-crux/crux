import type { LanguageModel } from "ai";
import type { z } from "zod";
import type { GenerationSettings, ModelInfo } from "@use-crux/core";
import type {
  ExecutorOutcome,
  ExecutorRequest,
  ExecutorStreamHandle,
  StructuredAttempt,
  StructuredRequest,
} from "@use-crux/core/adapter";
import type { SdkGateway } from "../gateway";
import type { SdkUsageLike } from "../meta";

/**
 * A deferred AI SDK call.
 *
 * Executors use the plan in three simple steps: inspect the target gateway
 * method, pass `args` to that method, then feed the raw SDK result into
 * `decode()`.
 *
 * @typeParam TMethod - Gateway method the plan targets.
 * @typeParam TDecoded - Core-facing result produced from the raw SDK result.
 * @internal
 */
export interface AiSdkCallPlan<TMethod extends keyof SdkGateway, TDecoded> {
  /** Gateway method to call. */
  readonly method: TMethod;
  /** Arguments ready to pass to the selected gateway method. */
  readonly args: Parameters<SdkGateway[TMethod]>[0];
  /** Decode the gateway result into the corresponding Crux contract. */
  decode(
    raw: Awaited<ReturnType<SdkGateway[TMethod]>>,
  ): TDecoded | Promise<TDecoded>;
}

/** Internal AI SDK call-plan codec. */
export interface AiSdkCodec {
  /** Executor identifier used in observability and provider matching. */
  readonly executorId: "ai-sdk";
  /** Extract provider/model identity from an AI SDK model reference. */
  describeModel(model: LanguageModel): ModelInfo;
  /** Map canonical generation settings to AI SDK-native settings. */
  mapSettings(
    settings: GenerationSettings,
    model: ModelInfo,
  ): Record<string, unknown>;
  /** Plan one SDK-owned text/tool loop. */
  loop(
    request: ExecutorRequest<LanguageModel>,
  ): AiSdkCallPlan<"generateText", ExecutorOutcome<SdkLoopResultLike>>;
  /** Plan one SDK structured-output attempt. */
  structured(
    request: StructuredRequest<LanguageModel>,
  ): Promise<AiSdkStructuredPlan>;
  /** Plan one SDK stream call, text or structured. */
  stream(
    request: ExecutorRequest<LanguageModel> & { readonly schema?: z.ZodType },
  ): Promise<AiSdkStreamPlan>;
  /** Recreate an SDK-shaped stream handle from a cached result. */
  replayStream(
    cached: CachedStreamPayload,
  ): ExecutorStreamHandle<SdkStreamResultLike>;
}

/**
 * A structured-output call plan.
 *
 * `decodeError()` returns `undefined` for provider/transport failures that
 * should still throw, and returns `status: 'invalid'` for AI SDK validation
 * or parse failures that core can retry.
 *
 * @internal
 */
export interface AiSdkStructuredPlan extends AiSdkCallPlan<
  "generateObject",
  StructuredAttempt<SdkLoopResultLike>
> {
  /** Decode SDK validation/parse errors into core's invalid-attempt variant. */
  decodeError(
    error: unknown,
  ): Promise<StructuredAttempt<SdkLoopResultLike> | undefined>;
}

/** A cached stream payload captured by core's semantic-cache middleware. */
export interface CachedStreamPayload {
  readonly text?: string;
  readonly object?: unknown;
  readonly meta?: Record<string, unknown>;
}

/**
 * A streaming call plan.
 *
 * `attach()` preserves the SDK's own stream object as `raw` and wires the
 * completion promise from the callbacks installed on `args`.
 *
 * @internal
 */
export type AiSdkStreamPlan =
  | {
      readonly method: "streamText";
      readonly args: Parameters<SdkGateway["streamText"]>[0];
      attach(
        raw: ReturnType<SdkGateway["streamText"]>,
      ): ExecutorStreamHandle<SdkStreamResultLike>;
    }
  | {
      readonly method: "streamObject";
      readonly args: Parameters<SdkGateway["streamObject"]>[0];
      attach(
        raw: ReturnType<SdkGateway["streamObject"]>,
      ): ExecutorStreamHandle<SdkStreamResultLike>;
    };

/** Optional dependencies for deterministic codec tests. */
export interface AiSdkCodecDeps {
  /** Clock used for stream timing metrics. Defaults to `Date.now`. */
  readonly clock?: () => number;
}

/** Structural shape of the AI SDK generate results the codec reads. */
export interface SdkLoopResultLike {
  text?: string;
  object?: unknown;
  content?: Array<
    Record<string, unknown> & {
      type?: string;
      approvalId?: string;
      toolCall?: { toolCallId?: string; toolName?: string; input?: unknown };
    }
  >;
  steps?: ReadonlyArray<SdkStepResultLike>;
  toolCalls?: Array<{
    toolCallId: string;
    toolName: string;
    input?: unknown;
    args?: unknown;
  }>;
  usage?: SdkUsageLike;
  totalUsage?: SdkUsageLike;
  finishReason?: string;
  response?: {
    id?: string;
    modelId?: string;
    messages?: ReadonlyArray<unknown>;
  };
  warnings?: readonly unknown[];
  providerMetadata?: unknown;
  _meta?: Record<string, unknown>;
}

/** Structural shape of one AI SDK step result the codec reads. */
export interface SdkStepResultLike {
  text?: string;
  toolCalls?: Array<{
    toolCallId: string;
    toolName: string;
    input?: unknown;
    args?: unknown;
  }>;
  content?: Array<Record<string, unknown>>;
  usage?: SdkUsageLike;
  finishReason?: string;
  response?: { id?: string; modelId?: string };
}

/** Structural shape of AI SDK stream results this executor returns. */
export interface SdkStreamResultLike {
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Structural shapes of stream callbacks/events we forward. */
export interface SdkStreamChunkEvent {
  chunk?: { type?: string; textDelta?: string };
}

export interface SdkStreamFinishEvent extends SdkLoopResultLike {}
