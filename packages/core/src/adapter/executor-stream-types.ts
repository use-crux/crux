/** Provider and public stream contracts for loop-owning SDK adapters. */

import type { GenerationMeta } from "../generation/types";
import type { Message } from "../generation/messages";
import type {
  CruxRunId,
  OperationResultMeta,
  WithOperationResultMeta,
} from "../observability";
import type { RoutingReceipt } from "../routing/receipt";
import type { AssistantContentPart } from "../types/content";

/** Provider/SDK completion facts produced before core operation stamping. */
export interface ExecutorStreamCompletionPayload extends GenerationMeta {
  /** Final assistant text, when the stream produced text. */
  readonly text?: string;
  /** Parsed structured output, when the streamed prompt declares a schema. */
  readonly object?: unknown;
  /** Exact final assistant output buffered by the SDK stream. */
  readonly content?: readonly AssistantContentPart[];
  /** Complete canonical transcript buffered by the SDK stream. */
  readonly messages?: readonly Message[];
  /** Non-fatal native warnings reported when the stream completed. */
  readonly warnings?: readonly unknown[];
  /** Provider-owned completion metadata. */
  readonly providerMetadata?: unknown;
  /** Stream timing metrics measured by the executor. */
  readonly streaming?: {
    /** Time to first token in milliseconds. */
    readonly ttftMs?: number;
    /** Output tokens per second over the whole stream. */
    readonly tokensPerSecond?: number;
    /** Total chunks observed. */
    readonly totalChunks?: number;
  };
  /** Semantic-cache replay facts when this completion came from cache. */
  readonly semanticCache?: Record<string, unknown>;
}

/**
 * Provider handle returned by `LoopRuntimePort.runStream()`.
 *
 * The provider owns SDK completion facts, not Crux trace/span identity.
 */
export interface ExecutorProviderStreamHandle<TRawStream> {
  /** The SDK stream result object, untouched. */
  readonly raw: TRawStream;
  /** Routing receipt attached by core when a stream used routing wrappers. */
  readonly routing?: RoutingReceipt;
  /** Resolves with provider facts without consuming the stream. */
  completion: () => Promise<ExecutorStreamCompletionPayload | undefined>;
}

/** Completion facts observed under the owning `generation.stream`. */
export type ExecutorStreamMeta = WithOperationResultMeta<
  ExecutorStreamCompletionPayload
> & Readonly<{ runId: CruxRunId }>;

/** Public executor handle with immediate stream-operation identity. */
export interface ExecutorStreamHandle<TRawStream> {
  /** Authoritative logical run opened for this stream. */
  readonly runId: CruxRunId;
  /** The SDK stream result object, untouched. */
  readonly raw: TRawStream;
  /** Routing receipt attached by core when a stream used routing wrappers. */
  readonly routing?: RoutingReceipt;
  /** Identity of the owning `generation.stream`, available immediately. */
  readonly _meta: OperationResultMeta;
  /** Resolves with provider facts carrying the same operation identity. */
  completion: () => Promise<ExecutorStreamMeta | undefined>;
}
