/**
 * Compose the shared replay log into the public `StreamResult` (RFC #173, contract 06).
 *
 * The three public surfaces are projections of ONE log, so they cannot steal from each
 * other and cost one retained copy between them. The driving operation publishes into the
 * log and settles it; consumers are irrelevant to that progress, which is what makes
 * `completion` safe to await without reading a stream.
 *
 * This module also owns the callback laws, because callbacks are a projection of the
 * published sequence rather than a provider mechanism: they are logical, serialized, and
 * fire at most once for the terminal outcome.
 *
 * @internal
 * @module
 */

import type { CruxRunId, OperationResultMeta } from "../observability";
import { createLogicalEventLog } from "./logical-event-log";
import type {
  AsyncIterableStream,
  StreamEvent,
  StreamResult,
} from "./logical-stream";
import type { StreamCompletion } from "./stream-result-types";

/** Caller callbacks. All are logical: none is ever installed on a physical attempt. */
export interface LogicalStreamCallbacks<TOutput = never, TPartial = never> {
  /** Invoked for each PUBLISHED event, in order. */
  onChunk?(event: StreamEvent<TPartial>): void | Promise<void>;
  /** Invoked at most once, after successful logical completion. */
  onFinish?(completion: StreamCompletion<TOutput>): void | Promise<void>;
  /** Invoked at most once for any terminal rejection, including cancellation. */
  onError?(error: unknown): void | Promise<void>;
}

/** The driving side of a logical stream. */
export interface LogicalStreamPublisher<TOutput = never, TPartial = never> {
  /** Append one committed logical event. Never blocks on a consumer. */
  publish(event: StreamEvent<TPartial>): void;
  /** Close the log and resolve `completion`. */
  complete(completion: StreamCompletion<TOutput>): void;
  /** Fail the log and reject `completion` with this exact error. */
  fail(error: unknown): void;
  /** Whether this stream has already settled. */
  settled(): boolean;
}

export interface CreateLogicalStreamOptions<TOutput = never, TPartial = never>
  extends LogicalStreamCallbacks<TOutput, TPartial> {
  readonly runId: CruxRunId;
  readonly meta: OperationResultMeta;
  /** Invoked by `cancel()` so the active physical attempt is aborted. */
  onCancel?(reason: unknown): void;
  /** Report a callback exception without altering the operation. */
  onCallbackError?(error: unknown): void;
  /**
   * Caller signal with the same whole-operation authority as `cancel()`.
   *
   * An already-aborted signal settles the stream immediately; a later abort behaves
   * exactly like `cancel(reason)`. The listener is removed on settlement.
   */
  readonly signal?: AbortSignal;
}

/**
 * A serial observer queue.
 *
 * Publishing does not await it, so a slow callback never delays stream release; awaiting
 * `completion` does, so the terminal callback is guaranteed to have run by then.
 */
function createCallbackQueue(onCallbackError?: (error: unknown) => void) {
  let tail: Promise<void> = Promise.resolve();
  return {
    push(work: () => void | Promise<void>): void {
      tail = tail.then(async () => {
        try {
          await work();
        } catch (error) {
          // Diagnostic only: a callback bug must not become the operation's outcome,
          // error a surface, or recurse into `onError`. A throwing REPORTER must not
          // poison the queue either, or a later `onFinish`/`onError` would be skipped.
          try {
            onCallbackError?.(error);
          } catch {
            // ignored
          }
        }
      });
    },
    drain(): Promise<void> {
      return tail;
    },
  };
}

/** Create one logical stream and its publisher. */
export function createLogicalStream<TOutput = never, TPartial = never>(
  options: CreateLogicalStreamOptions<TOutput, TPartial>,
): {
  readonly result: StreamResult<TOutput, TPartial>;
  readonly publisher: LogicalStreamPublisher<TOutput, TPartial>;
} {
  const log = createLogicalEventLog<StreamEvent<TPartial>>();
  let detachSignal = (): void => {};
  const callbacks = createCallbackQueue(options.onCallbackError);
  let settled = false;
  /** Guards `cancelOperation` against synchronous re-entry through the signal seam. */
  let cancelling = false;

  let resolveCompletion!: (value: StreamCompletion<TOutput>) => void;
  let rejectCompletion!: (error: unknown) => void;
  const completion = new Promise<StreamCompletion<TOutput>>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  // A caller may read only a stream; completion rejection must not be "unhandled".
  void completion.catch(() => undefined);

  /** Memoized so repeated property access returns one stable stream object. */
  let textSurface: AsyncIterableStream<string> | undefined;
  let fullSurface: AsyncIterableStream<StreamEvent<TPartial>> | undefined;
  let partialSurface: AsyncIterableStream<TPartial> | undefined;

  /** Project the shared log, dropping events this surface does not represent. */
  const project = <T>(select: (event: StreamEvent<TPartial>) => T | undefined) => {
    // Pull-driven on purpose: an eager `start()` loop drains the log into THIS stream's
    // internal queue, giving one materialized copy per projection — exactly the
    // per-surface retention the contract forbids. Pulling leaves the single shared log as
    // the only place events live, so an unread surface costs a cursor.
    const source = log.surface()[Symbol.asyncIterator]();
    const stream = new ReadableStream<T>(
      {
        async pull(controller) {
          try {
            for (;;) {
              const next = await source.next();
              if (next.done) {
                controller.close();
                return;
              }
              const value = select(next.value);
              if (value !== undefined) {
                controller.enqueue(value);
                return;
              }
            }
          } catch (error) {
            // The same normalized identity every surface and `completion` receives.
            controller.error(error);
          }
        },
        async cancel(reason) {
          // Detach this reader only; other surfaces and the operation continue.
          await source.return?.(reason);
        },
      },
      // No prefetch here EITHER. The default high-water mark calls `pull()` once with no
      // reader attached, which advances the shared cursor and queues one event inside
      // this projection — so merely touching `result.textStream` would materialize a
      // per-surface copy even though the log itself never prefetches.
      { highWaterMark: 0 },
    );
    return attachAsyncIterator(stream);
  };

  /**
   * Settle the stream.
   *
   * @remarks
   * Surface settlement happens IMMEDIATELY and never queues behind callbacks: a hung
   * `onChunk` must not prevent surfaces from closing or erroring, or make a cancellation
   * unobservable. Only `completion` waits for the observer queue, which is what makes
   * "awaiting completion guarantees the terminal callback ran" true without giving
   * callbacks authority over publication.
   */
  const finishTerminal = (
    settleSurfaces: () => void,
    settleCompletion: () => void,
    callback: () => void,
  ): void => {
    if (settled) return;
    settled = true;
    detachSignal();
    settleSurfaces();
    callbacks.push(callback);
    void callbacks.drain().then(settleCompletion, settleCompletion);
  };

  /** Normalize any reason into a canonical abort. */
  const normalizeAbort = (reason: unknown): unknown =>
    reason instanceof Error ? reason : new DOMException("Aborted", "AbortError");

  const cancelOperation = (reason: unknown): void => {
    // A no-op after settlement: `onCancel` must not fire for an operation that already
    // finished, and cancellation is recorded as cancellation, never as a policy discard.
    if (settled || cancelling) return;
    // `onCancel` typically aborts a controller whose signal is ALSO the caller signal
    // wired below, which re-enters here synchronously before `fail()` has settled.
    // Without this the abort hook would run twice for one cancellation.
    cancelling = true;
    const normalized = normalizeAbort(reason);
    try {
      options.onCancel?.(normalized);
    } catch (error) {
      // A failing abort hook must not prevent the operation from becoming cancelled —
      // and neither may a failing REPORTER, or the throw would escape before
      // `publisher.fail()` and leave the operation permanently unsettled.
      try {
        options.onCallbackError?.(error);
      } catch {
        // ignored
      }
    }
    publisher.fail(normalized);
  };

  const publisher: LogicalStreamPublisher<TOutput, TPartial> = {
    publish(event) {
      if (settled) return;
      log.publish(event);
      if (options.onChunk) callbacks.push(() => options.onChunk?.(event));
    },
    complete(value) {
      finishTerminal(
        () => log.finish(),
        () => resolveCompletion(value),
        () => options.onFinish?.(value),
      );
    },
    fail(error) {
      finishTerminal(
        () => log.fail(error),
        () => rejectCompletion(error),
        () => options.onError?.(error),
      );
    },
    settled: () => settled,
  };

  const result: StreamResult<TOutput, TPartial> = {
    runId: options.runId,
    _meta: options.meta,
    get textStream() {
      return (textSurface ??= project((event) =>
        event.type === "text-delta" ? event.text : undefined,
      ));
    },
    get fullStream() {
      return (fullSurface ??= project((event) => event));
    },
    get partialOutputStream() {
      return (partialSurface ??= project((event) =>
        event.type === "partial-output" ? event.value : undefined,
      ));
    },
    completion,
    cancel(reason) {
      cancelOperation(reason);
    },
  };

  // The caller's signal has the same whole-operation authority as `cancel()`.
  if (options.signal) {
    const signal = options.signal;
    if (signal.aborted) {
      cancelOperation((signal as { reason?: unknown }).reason);
    } else {
      const onAbort = (): void =>
        cancelOperation((signal as { reason?: unknown }).reason);
      signal.addEventListener("abort", onAbort, { once: true });
      detachSignal = () => signal.removeEventListener("abort", onAbort);
    }
  }

  return { result, publisher };
}

/**
 * Attach async iteration when the runtime's `ReadableStream` lacks it.
 *
 * @remarks
 * Returning early CANCELS, matching native async iterators: releasing the lock
 * alone would leave this projection subscribed to the shared log, so abandoning
 * one surface would keep pulling for the rest of the operation.
 */
function attachAsyncIterator<T>(stream: ReadableStream<T>): AsyncIterableStream<T> {
  const candidate = stream as AsyncIterableStream<T>;
  if (typeof candidate[Symbol.asyncIterator] === "function") return candidate;
  Object.defineProperty(candidate, Symbol.asyncIterator, {
    configurable: true,
    value(): AsyncGenerator<T> {
      const reader = stream.getReader();
      let done = false;
      return (async function* () {
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) {
              done = true;
              return;
            }
            yield next.value;
          }
        } finally {
          if (!done) await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
      })();
    },
  });
  return candidate;
}
