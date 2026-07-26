/**
 * The part stream behind a coordinated AI SDK stream (RFC #173, Fork A).
 *
 * A coordinated stream exposes several logical surfaces over one composed sequence of
 * SDK parts — `fullStream`, `textStream`, and the UI-message stream. Those surfaces must
 * be independent: reading one must not consume another, two may be read simultaneously,
 * and abandoning one must not stall the rest or the producer.
 *
 * Implemented as a multicast hub rather than repeated `tee()`. Teeing leaves the unread
 * branch buffering the entire stream a second time, which is exactly the retention this
 * must avoid; a hub only retains parts for surfaces that were actually created, and a
 * surface that is never created costs nothing.
 *
 * @internal
 * @module
 */

/** An AI SDK-shaped surface: a real `ReadableStream` that is also async-iterable. */
export type AsyncIterableStream<T> = ReadableStream<T> & AsyncIterable<T>;

/** A multi-surface, non-destructive stream of SDK parts. */
export interface CoordinatedPartStream {
  /** Publish one part to every live surface. */
  push(part: unknown): void;
  /** End the stream normally. */
  close(): void;
  /** End the stream with a terminal error delivered to every surface. */
  fail(error: unknown): void;
  /**
   * Create one independent surface.
   *
   * Surfaces never share a cursor, so reading one does not consume another. Cancelling a
   * surface detaches it and releases whatever it had buffered.
   */
  surface<T = unknown>(map?: (part: unknown) => T | undefined): AsyncIterableStream<T>;
}

/** Attach async iteration to a `ReadableStream` when the runtime does not provide it. */
function asAsyncIterable<T>(stream: ReadableStream<T>): AsyncIterableStream<T> {
  const candidate = stream as AsyncIterableStream<T>;
  if (typeof candidate[Symbol.asyncIterator] === "function") return candidate;
  Object.defineProperty(candidate, Symbol.asyncIterator, {
    configurable: true,
    value(): AsyncGenerator<T> {
      const reader = stream.getReader();
      return (async function* () {
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) return;
            yield next.value;
          }
        } finally {
          reader.releaseLock();
        }
      })();
    },
  });
  return candidate;
}

interface Subscriber {
  enqueue(part: unknown): void;
  close(): void;
  error(reason: unknown): void;
}

/** Create the multicast hub and its surface factory. */
export function createCoordinatedPartStream(): CoordinatedPartStream {
  const subscribers = new Set<Subscriber>();
  let settled: { readonly kind: "close" } | { readonly kind: "error"; readonly reason: unknown } | undefined;

  return {
    push(part) {
      if (settled) return;
      for (const subscriber of subscribers) subscriber.enqueue(part);
    },
    close() {
      if (settled) return;
      settled = { kind: "close" };
      for (const subscriber of subscribers) subscriber.close();
      subscribers.clear();
    },
    fail(error) {
      if (settled) return;
      const reason = error ?? new Error("stream failed");
      settled = { kind: "error", reason };
      for (const subscriber of subscribers) subscriber.error(reason);
      subscribers.clear();
    },
    surface<T>(map?: (part: unknown) => T | undefined): AsyncIterableStream<T> {
      let self: Subscriber;
      const stream = new ReadableStream<T>({
        start(controller) {
          self = {
            enqueue(part) {
              const value = map ? map(part) : (part as T);
              // A mapper returning `undefined` filters the part out of this surface.
              if (value !== undefined) controller.enqueue(value as T);
            },
            close: () => {
              try {
                controller.close();
              } catch {
                // already closed
              }
            },
            error: (reason) => {
              try {
                controller.error(reason);
              } catch {
                // already errored
              }
            },
          };
          // A surface created after the stream settled reflects that immediately.
          if (settled?.kind === "close") self.close();
          else if (settled?.kind === "error") self.error(settled.reason);
          else subscribers.add(self);
        },
        cancel() {
          // Detach so an abandoned surface stops retaining parts and stops costing the
          // producer anything.
          subscribers.delete(self);
        },
      });
      return asAsyncIterable(stream);
    },
  };
}
