import type { CruxRunId, OperationResultMeta } from "../../observability";
import type { AsyncIterableStream } from "../logical-stream";

/**
 * One eagerly executing bounded operation with replayable canonical events.
 *
 * `fullStream` readers have independent cursors and may join late. Returning
 * from one reader detaches only that reader; {@link cancel} aborts the whole
 * logical operation and its active provider attempt. `completion` resolves to
 * the existing completed-operation result after terminal validation and
 * Safety. Crux retains events only in memory and never persists media.
 *
 * @typeParam TEvent - Closed provider-neutral event union for the operation.
 * @typeParam TResult - Exact completed result resolved after final validation.
 */
export interface StreamingOperationResult<TEvent, TResult> {
  /** Identity of the logical operation across all physical attempts. */
  readonly runId: CruxRunId;
  /** Correlation for the media-stream span that owns this result. */
  readonly _meta: OperationResultMeta;
  /**
   * Replayable canonical history retained once in memory.
   *
   * Every async iterator starts at `start`, including concurrent and late
   * readers. Returning from one iterator detaches only that reader.
   */
  readonly fullStream: AsyncIterableStream<TEvent>;
  /**
   * Exact completed result after terminal validation and Safety.
   *
   * Provider execution is eager, so this settles without reading
   * {@link fullStream}.
   */
  readonly completion: Promise<TResult>;
  /**
   * Abort the logical operation and its active physical attempt.
   *
   * Calling this method fails every event reader and `completion` with one
   * normalized error identity.
   */
  cancel(reason?: unknown): void;
}
