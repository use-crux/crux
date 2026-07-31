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
import type { LogicalBillingTotals } from "./types";
import type { ThreadCommit } from "../thread/types";

/** Provider/SDK completion facts produced before core operation stamping. */
export interface ExecutorStreamCompletionPayload extends GenerationMeta {
  /**
   * Scalar totals across every billable physical attempt (RFC #173, law 7).
   *
   * Present only when the operation ran more than one billable attempt. Carried
   * separately from `usage`/`cost` because those describe the ACCEPTED attempt
   * and feed the public step facts; a discarded attempt contributes money but no
   * step. A field is omitted when some billable attempt did not report it.
   */
  readonly logicalTotals?: LogicalBillingTotals;
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
  /** Atomic canonical Thread publication produced by this invocation. */
  readonly threadCommit?: ThreadCommit;
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
  /**
   * The SDK stream result object. Untouched on the ordinary single-attempt path.
   *
   * On a coordinated stream (a commit gate can reject an attempt, RFC #173) it is
   * SDK-SHAPED but may be a runtime-composed logical stream spanning attempts rather
   * than object-identical to one provider attempt — a rejected attempt is discarded
   * and never surfaces here. It still preserves the supported result surface:
   * `textStream`, `fullStream`, the completion promises/getters Crux reads, structured
   * output/object, usage, finish reason, response messages, warnings, provider
   * metadata, cancellation, and error propagation.
   */
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
  /**
   * The SDK stream result object. Untouched on the ordinary single-attempt path; on a
   * coordinated stream it is SDK-shaped but may be a Crux-composed logical stream
   * spanning attempts (see {@link ExecutorProviderStreamHandle.raw}).
   */
  readonly raw: TRawStream;
  /** Routing receipt attached by core when a stream used routing wrappers. */
  readonly routing?: RoutingReceipt;
  /**
   * Whether this operation has an authored output schema.
   *
   * The public seam needs it before the first delta to know that released text is
   * canonical `z.input` JSON and therefore projects into `partialOutputStream`.
   */
  readonly structured?: boolean;
  /**
   * Whether a terminal stage can still rewrite or remove published output.
   *
   * True when a composite `model.output` or output-media guard is bound. Media
   * then publishes from the guarded completion rather than progressively, so a
   * part a guard was about to strip never reaches a public surface.
   */
  readonly deferMedia?: boolean;
  /**
   * Whether a terminal stage can still rewrite or block REASONING.
   *
   * True when a `model.output.text` (or composite) binding is active: the live
   * text transform gates only text deltas, so reasoning would otherwise stream
   * ungated and then be redacted at completion.
   */
  readonly deferReasoning?: boolean;
  /**
   * Abort the physical attempt, so `result.cancel()` reaches the provider rather
   * than only detaching readers.
   */
  readonly abort?: (reason: unknown) => void;
  /** The caller signal, which has whole-operation authority over the result. */
  readonly signal?: AbortSignal;
  /** Identity of the owning `generation.stream`, available immediately. */
  readonly _meta: OperationResultMeta;
  /** Resolves with provider facts carrying the same operation identity. */
  completion: () => Promise<ExecutorStreamMeta | undefined>;
}
