/**
 * The shared logical replay log behind every public stream surface (RFC #173).
 *
 * All three public streams — `textStream`, `fullStream`, `partialOutputStream` — project
 * ONE append-only log of committed logical events. This is what makes the contract's
 * surface guarantees possible: independent cursors, concurrent readers, late readers that
 * replay from logical `start`, and a terminal failure that reaches every surface with the
 * same normalized error identity.
 *
 * Two properties drive the design:
 *
 * - **Publication never waits for a consumer.** `publish()` is synchronous and total, so
 *   the operation drives to completion whether or not anything is being read. A
 *   rendezvous handoff here would let an unread surface deadlock `completion`.
 * - **Events are retained once.** One shared array backs every cursor, so N surfaces cost
 *   one copy — not one queue per projection, and not a `tee()` branch whose unread half
 *   silently retains a second copy.
 *
 * Only canonical, committed logical events belong here. A discarded physical attempt must
 * never reach the log.
 *
 * @internal
 * @module
 */

import type { AsyncIterableStream } from "./logical-stream";

/** Terminal state of one logical operation. */
type Settlement =
  | { readonly kind: "open" }
  | { readonly kind: "finished" }
  | { readonly kind: "failed"; readonly error: unknown };

/** An append-only log of committed logical events with independent replay cursors. */
export interface LogicalEventLog<T> {
  /** Append one committed event and wake every waiting cursor. Never blocks. */
  publish(event: T): void;
  /** Close every surface normally. Idempotent. */
  finish(): void;
  /**
   * Fail every current and future surface with this exact error object.
   *
   * Surfaces replay their committed prefix first, so a reader sees what was genuinely
   * published before the failure and then the identical error every other surface and
   * `completion` receives. Idempotent: the first error wins.
   */
  fail(error: unknown): void;
  /**
   * Create one independent surface over the log.
   *
   * @remarks
   * Starts at index 0, so a surface created mid-flight or after settlement replays the
   * whole committed sequence and then continues live. Cancelling or returning early
   * detaches only this reader.
   */
  surface(): AsyncIterableStream<T>;
}

/**
 * Attach async iteration when the runtime's `ReadableStream` does not provide it.
 *
 * @remarks
 * Returning early must CANCEL the stream, not merely release the lock. Releasing
 * alone leaves this surface attached to the shared log with a parked waiter that
 * only settlement can clear, so an abandoned reader would keep a cursor alive for
 * the rest of the operation. Native `ReadableStream` async iterators cancel by
 * default; this fallback matches them.
 */
function asAsyncIterable<T>(stream: ReadableStream<T>): AsyncIterableStream<T> {
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

/** Create the shared log. */
export function createLogicalEventLog<T>(): LogicalEventLog<T> {
  const events: T[] = [];
  let settlement: Settlement = { kind: "open" };
  // Cursors parked waiting for more input; woken on publish/finish/fail.
  const waiters = new Set<() => void>();

  const wake = (): void => {
    for (const waiter of waiters) waiter();
    waiters.clear();
  };

  return {
    publish(event) {
      if (settlement.kind !== "open") return;
      events.push(event);
      wake();
    },
    finish() {
      if (settlement.kind !== "open") return;
      settlement = { kind: "finished" };
      wake();
    },
    fail(error) {
      if (settlement.kind !== "open") return;
      settlement = { kind: "failed", error };
      wake();
    },
    surface(): AsyncIterableStream<T> {
      // Each surface owns only a cursor into the shared array.
      let cursor = 0;
      let detached = false;
      // The waiter THIS surface is parked on, so cancellation can drop it instead of
      // leaving it retained until some later event happens to wake everyone.
      let parked: (() => void) | undefined;
      const stream = new ReadableStream<T>(
        {
          async pull(controller) {
            for (;;) {
              if (detached) return;
              if (cursor < events.length) {
                controller.enqueue(events[cursor] as T);
                cursor += 1;
                return;
              }
              // Caught up: settle, or park until the producer moves.
              if (settlement.kind === "finished") {
                controller.close();
                return;
              }
              if (settlement.kind === "failed") {
                // The committed prefix has been replayed; now the shared error identity.
                controller.error(settlement.error);
                return;
              }
              await new Promise<void>((resolve) => {
                parked = resolve;
                waiters.add(resolve);
              });
              parked = undefined;
            }
          },
          cancel() {
            detached = true;
            // Wake and drop this surface's own waiter so cancelling while parked settles
            // immediately rather than waiting for an unrelated publish.
            if (parked) {
              waiters.delete(parked);
              parked();
              parked = undefined;
            }
          },
        },
        // No prefetch: a surface must not pull events before a reader asks for them, or
        // an untouched projection would materialize its own copy of the log.
        { highWaterMark: 0 },
      );
      return asAsyncIterable(stream);
    },
  };
}
