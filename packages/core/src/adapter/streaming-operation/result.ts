import type { CruxRunId, OperationResultMeta } from "../../observability";
import { createLogicalEventLog } from "../logical-event-log";
import type { AsyncIterableStream } from "../logical-stream";
import type { StreamingOperationResult } from "./runner-types";

/** Core-owned logical boundaries for every bounded media stream. */
export type StreamingOperationBoundaryEvent =
  | Readonly<{ type: "start" }>
  | Readonly<{ type: "finish" }>;

/** Core-owned publication seam for one managed bounded stream. */
export interface StreamingOperationPublisher<TEvent, TResult> {
  /** Publish one candidate, returning false after terminal settlement. */
  publish(event: TEvent): boolean;
  complete(result: TResult): void;
  fail(error: unknown): void;
  settled(): boolean;
  /** Whether a provider candidate reached the public logical log. */
  published(): boolean;
}

/** Create one replay log, public result, and its Core-owned publisher. */
export function createStreamingOperationResult<TEvent, TResult>(
  options: Readonly<{
    runId: CruxRunId;
    meta: OperationResultMeta;
    signal?: AbortSignal;
    onCancel(reason: Error): void;
    onSettle?(): void;
  }>,
): {
  readonly result: StreamingOperationResult<
    TEvent | StreamingOperationBoundaryEvent,
    TResult
  >;
  readonly publisher: StreamingOperationPublisher<TEvent, TResult>;
} {
  const log = createLogicalEventLog<TEvent | StreamingOperationBoundaryEvent>();
  let settled = false;
  let published = false;
  let cancelling = false;
  let detachSignal = (): void => {};
  let resolveCompletion!: (result: TResult) => void;
  let rejectCompletion!: (error: unknown) => void;
  const completion = new Promise<TResult>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  void completion.catch(() => undefined);

  const publisher: StreamingOperationPublisher<TEvent, TResult> = {
    publish(event) {
      if (settled) return false;
      log.publish(event);
      published = true;
      return true;
    },
    complete(value) {
      if (settled) return;
      settled = true;
      detachSignal();
      options.onSettle?.();
      log.publish(Object.freeze({ type: "finish" }));
      log.finish();
      resolveCompletion(value);
    },
    fail(error) {
      if (settled) return;
      settled = true;
      detachSignal();
      options.onSettle?.();
      log.fail(error);
      rejectCompletion(error);
    },
    settled: () => settled,
    published: () => published,
  };
  const cancelOperation = (reason: unknown): void => {
    if (settled || cancelling) return;
    cancelling = true;
    const normalized = normalizeAbort(reason);
    try {
      options.onCancel(normalized);
    } catch {
      // Cancellation remains authoritative if an internal abort hook misbehaves.
    } finally {
      publisher.fail(normalized);
    }
  };
  const result = Object.freeze({
    runId: options.runId,
    _meta: options.meta,
    fullStream: replaySurface(() => log.surface()),
    completion,
    cancel: cancelOperation,
  });

  log.publish(Object.freeze({ type: "start" }));
  if (options.signal) {
    const signal = options.signal;
    if (signal.aborted) {
      cancelOperation(signal.reason);
    } else {
      const onAbort = (): void => cancelOperation(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      detachSignal = () => signal.removeEventListener("abort", onAbort);
    }
  }
  return { result, publisher };
}

/** Preserve Error reasons and normalize all other cancellation values. */
function normalizeAbort(reason: unknown): Error {
  return reason instanceof Error
    ? reason
    : new DOMException("Aborted", "AbortError");
}

/**
 * Keep one stable `ReadableStream` while giving every async iterator a fresh
 * cursor into the shared replay log.
 */
function replaySurface<T>(
  createSurface: () => AsyncIterableStream<T>,
): AsyncIterableStream<T> {
  const surface = createSurface();
  Object.defineProperty(surface, Symbol.asyncIterator, {
    configurable: true,
    value: () => createSurface()[Symbol.asyncIterator](),
  });
  return surface;
}
