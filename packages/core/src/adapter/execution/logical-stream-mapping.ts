/**
 * Map an ordinary (single-attempt) provider stream onto the logical port (RFC #173).
 *
 * The ordinary route has exactly one physical attempt, but its PUBLIC shape must already
 * be the logical one — a single `start`, published events in producer order, one `finish`,
 * and no provider-step framing. Both ordinary routes (native and loop-owning SDK) share
 * this adapter precisely so they cannot drift in what they publish: contract 06's
 * "identical result key set and behavior with no gates" is a property of one code path,
 * not of two implementations that happen to agree today.
 *
 * @internal
 * @module
 */

import type { CruxRunId, OperationResultMeta } from "../../observability";
import { createLogicalStream } from "../logical-stream-publisher";
import type { LogicalStreamCallbacks } from "../logical-stream-publisher";
import type { PublishedStreamEvent, StreamResult } from "../logical-stream";
import type { StreamCompletion } from "../stream-result-types";

export interface PublishOrdinaryStreamOptions<TOutput = never, TPartial = never>
  extends LogicalStreamCallbacks<TOutput, TPartial> {
  readonly runId: CruxRunId;
  readonly meta: OperationResultMeta;
  /**
   * ONE ordered sequence of Safety-final logical events.
   *
   * @remarks
   * Deliberately a single source. Draining text from one iterable and everything else
   * from another destroys the interleaving the caller actually observed — reasoning,
   * tool, media, source, and partial-output events would all be relocated after the last
   * text delta. Producers convert their native chunks to `text-delta` upstream, and
   * `textStream` is a projection of this same sequence rather than a parallel channel.
   *
   * `start` and `finish` are excluded by type: the seam owns logical framing.
   */
  readonly events: AsyncIterable<PublishedStreamEvent<TPartial>>;
  /** Resolve the canonical completion envelope once the attempt drains. */
  completion(): Promise<StreamCompletion<TOutput>>;
  /** Abort the physical attempt when the caller cancels the logical operation. */
  onCancel?(reason: unknown): void;
  onCallbackError?(error: unknown): void;
  /** Caller signal with the same whole-operation authority as `cancel()`. */
  readonly signal?: AbortSignal;
}

/**
 * Drive one ordinary provider stream into a logical `StreamResult`.
 *
 * @remarks
 * The drive loop runs detached: publication never waits for a consumer, so `completion`
 * settles whether or not a surface is read. A provider failure fails every surface with
 * the SAME error object and publishes no `finish`, matching the contract's rule that a
 * terminal failure is not a finish.
 */
export function publishOrdinaryStream<TOutput = never, TPartial = never>(
  options: PublishOrdinaryStreamOptions<TOutput, TPartial>,
): StreamResult<TOutput, TPartial> {
  const { result, publisher } = createLogicalStream<TOutput, TPartial>({
    runId: options.runId,
    meta: options.meta,
    ...(options.onChunk ? { onChunk: options.onChunk } : {}),
    ...(options.onFinish ? { onFinish: options.onFinish } : {}),
    ...(options.onError ? { onError: options.onError } : {}),
    ...(options.onCancel ? { onCancel: options.onCancel } : {}),
    ...(options.onCallbackError
      ? { onCallbackError: options.onCallbackError }
      : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const drive = async (): Promise<void> => {
    publisher.publish({ type: "start" });
    for await (const event of options.events) {
      if (publisher.settled()) return; // cancelled or failed mid-flight
      publisher.publish(event);
    }
    const completion = await options.completion();
    if (publisher.settled()) return;
    // The logical `finish` carries the operation's finish reason and AGGREGATE usage —
    // the facts the AI SDK terminal UI part needs, so UI helpers close from this event
    // rather than separately awaiting `completion`.
    const finishReason = completion.finalStep?.finishReason;
    publisher.publish({
      type: "finish",
      ...(finishReason !== undefined ? { finishReason } : {}),
      ...(completion.usage !== undefined ? { usage: completion.usage } : {}),
    });
    publisher.complete(completion);
  };

  void drive().catch((error: unknown) => {
    publisher.fail(error);
  });

  return result;
}
