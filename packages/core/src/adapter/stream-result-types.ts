/** Public managed-stream result contracts. */

import type {
  CruxRunId,
  OperationResultMeta,
  WithOperationResultMeta,
} from "../observability";
import type { GenerateResultPayload } from "./result-accumulator";

/**
 * Provider and policy facts assembled when a managed stream completes.
 *
 * This payload exists before the owning `generation.stream` operation adds
 * its trace/span identity.
 */
export type StreamCompletionPayload<TOutput = unknown> = Omit<
  GenerateResultPayload<never, TOutput>,
  "raw"
>;

/** Canonical observed completion resolved by managed `stream()` results. */
export type StreamCompletion<TOutput = unknown> = WithOperationResultMeta<
  StreamCompletionPayload<TOutput>
> & Readonly<{ runId: CruxRunId }>;

/**
 * Canonical managed `stream()` result shared by provider adapters.
 *
 * Core owns `_meta`, which is available as soon as `stream()` returns. The
 * completion envelope carries the same operation identity plus final provider
 * and policy facts; individual text chunks remain plain strings.
 *
 * @example
 * ```ts
 * const result = await adapter.stream(myPrompt, options)
 * console.log(result._meta.traceId, result._meta.spanId)
 * for await (const text of result.textStream) process.stdout.write(text)
 * console.log((await result.completion)._meta.responseId)
 * ```
 */
export interface StreamResult<TRawStream, TOutput = unknown> {
  /** Authoritative logical run opened for this stream. */
  readonly runId: CruxRunId;
  /** Provider-neutral text delta stream. */
  readonly textStream: AsyncIterable<string>;
  /** Raw provider or SDK stream handle. */
  readonly raw: TRawStream;
  /** Resolves to the canonical completion envelope when the stream finishes. */
  readonly completion: Promise<StreamCompletion<TOutput>>;
  /** Identity of the owning `generation.stream`, available immediately. */
  readonly _meta: OperationResultMeta;
}
