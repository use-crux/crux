/**
 * Internal AI SDK request/response codec.
 *
 * The codec turns fully prepared Crux executor requests into AI SDK call
 * plans. A plan is inert until the executor hands its `args` to the
 * configured {@link SdkGateway}; only then does the plan decode the raw SDK
 * result back into core's executor contracts.
 *
 * @internal
 * @module
 */

export { createAiSdkCodec, mapAiSdkSettings } from "./sdk-codec/index";
export type {
  AiSdkCallPlan,
  AiSdkCodec,
  AiSdkCodecDeps,
  AiSdkStreamPlan,
  AiSdkStructuredPlan,
  CachedStreamPayload,
  SdkLoopResultLike,
  SdkStreamResultLike,
} from "./sdk-codec/types";
