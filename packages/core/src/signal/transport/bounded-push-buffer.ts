/**
 * Bounded push → pull bridge for managed WebSocket (and similar) adapters.
 *
 * @remarks Runtime stream fibers pull one item at a time. Push sockets must not
 * grow an unbounded queue. This helper stores at most `capacity` items; when a
 * push would exceed capacity it **fails the consumer** (transient reconnect)
 * instead of silently dropping messages. Overflow reconnect resumes from the
 * durable cursor through the existing stream fiber.
 *
 * @module
 */

/** Options for {@link createBoundedPushBuffer}. */
export interface BoundedPushBufferOptions {
  /**
   * Maximum number of buffered items awaiting Runtime pull.
   *
   * @remarks Must be a positive integer. There is no unlimited mode.
   */
  readonly capacity: number;
  /**
   * Optional abort signal that fails the buffer when aborted.
   *
   * @remarks Use the Runtime `open` context signal so lease loss / worker stop
   * unblocks the pull loop and lets the adapter close the socket.
   */
  readonly signal?: AbortSignal;
}

/**
 * Bounded queue that is push-writable and pull-consumable as an async iterable.
 *
 * @typeParam T - Item type (typically a WebSocket/stream protocol item).
 */
export interface BoundedPushBuffer<T> {
  /** Configured maximum size. */
  readonly capacity: number;
  /** Current buffered item count. */
  readonly size: number;
  /** True after {@link close} or a terminal {@link fail}. */
  readonly closed: boolean;
  /**
   * Enqueue one item for the pull consumer.
   *
   * @throws When the buffer is closed/failed, or when the push would exceed
   *   {@link capacity} (overflow — never drops).
   */
  push(item: T): void;
  /**
   * Signal clean producer completion (consumer sees EOF after draining).
   */
  close(): void;
  /**
   * Fail the consumer with `error` after draining already-buffered items is
   * skipped — the next pull rejects (or immediately if waiting).
   *
   * @remarks Use for socket errors and for overflow after closing the socket.
   */
  fail(error: unknown): void;
  /** Async iterable consumed under Runtime pull backpressure. */
  readonly items: AsyncIterable<T>;
}

/** Stable overflow error code for checkpoint / classification helpers. */
export const TRANSPORT_PUSH_BUFFER_OVERFLOW =
  "TRANSPORT_PUSH_BUFFER_OVERFLOW" as const;

/**
 * Create a bounded push buffer for adapter-owned WebSocket (or similar) fans-in.
 *
 * @param options - Required positive capacity and optional abort signal.
 * @returns A buffer that never silently drops items.
 *
 * @example
 * ```ts
 * const buffer = createBoundedPushBuffer<WebSocketItem>({
 *   capacity: 32,
 *   signal,
 * });
 * socket.onmessage = (event) => {
 *   try {
 *     buffer.push(mapFrame(event));
 *   } catch {
 *     socket.close();
 *     // buffer already failed on overflow; open() consumer will throw.
 *   }
 * };
 * socket.onclose = () => buffer.close();
 * return buffer.items;
 * ```
 */
export function createBoundedPushBuffer<T>(
  options: BoundedPushBufferOptions,
): BoundedPushBuffer<T> {
  const capacity = options.capacity;
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new TypeError(
      "createBoundedPushBuffer({ capacity }) requires a positive integer capacity.",
    );
  }

  const queue: T[] = [];
  let closed = false;
  let failure: unknown;
  let waitResolve: ((value: IteratorResult<T>) => void) | null = null;
  let waitReject: ((reason: unknown) => void) | null = null;

  const abort = options.signal;
  const onAbort = () => {
    // Cooperative cancel: reject waiters without inventing a durable fault code.
    const error =
      abort?.reason instanceof Error
        ? abort.reason
        : Object.assign(new Error("Bounded push buffer aborted."), {
            name: "AbortError",
          });
    failInternal(error);
  };

  if (abort) {
    if (abort.aborted) {
      onAbort();
    } else {
      abort.addEventListener("abort", onAbort, { once: true });
    }
  }

  function clearWait(): void {
    waitResolve = null;
    waitReject = null;
  }

  function failInternal(error: unknown): void {
    if (closed && failure !== undefined) {
      return;
    }
    closed = true;
    failure = error;
    abort?.removeEventListener("abort", onAbort);
    if (waitReject) {
      const reject = waitReject;
      clearWait();
      reject(error);
    }
  }

  function push(item: T): void {
    if (closed) {
      if (failure !== undefined) {
        throw failure instanceof Error
          ? failure
          : Object.assign(new Error(String(failure)), { cause: failure });
      }
      throw new Error("Bounded push buffer is closed.");
    }

    if (waitResolve) {
      const resolve = waitResolve;
      clearWait();
      resolve({ done: false, value: item });
      return;
    }

    if (queue.length >= capacity) {
      const overflow = Object.assign(
        new Error(
          `${TRANSPORT_PUSH_BUFFER_OVERFLOW}: push buffer capacity ${capacity} exceeded; close and reconnect from the durable cursor instead of dropping.`,
        ),
        { code: TRANSPORT_PUSH_BUFFER_OVERFLOW },
      );
      failInternal(overflow);
      throw overflow;
    }

    queue.push(item);
  }

  function close(): void {
    if (closed) {
      return;
    }
    closed = true;
    abort?.removeEventListener("abort", onAbort);
    if (waitResolve) {
      const resolve = waitResolve;
      clearWait();
      resolve({ done: true, value: undefined });
    }
  }

  function fail(error: unknown): void {
    failInternal(error);
  }

  const items: AsyncIterable<T> = {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        async next(): Promise<IteratorResult<T>> {
          if (queue.length > 0) {
            return { done: false, value: queue.shift() as T };
          }

          if (failure !== undefined) {
            throw failure;
          }

          if (closed) {
            return { done: true, value: undefined };
          }

          return new Promise<IteratorResult<T>>((resolve, reject) => {
            waitResolve = resolve;
            waitReject = reject;
          });
        },

        async return(): Promise<IteratorResult<T>> {
          close();
          queue.length = 0;
          return { done: true, value: undefined };
        },
      };
    },
  };

  return {
    get capacity() {
      return capacity;
    },
    get size() {
      return queue.length;
    },
    get closed() {
      return closed;
    },
    push,
    close,
    fail,
    items,
  };
}
