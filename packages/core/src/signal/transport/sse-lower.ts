/**
 * Pure SSE authoring → managed stream protocol lowering.
 *
 * @remarks Maps `lastEventId` onto the canonical stream `cursor` contract and
 * reuses {@link validateStreamItem} for immutable detachment. No I/O, stores,
 * or worker ownership lives here — supervision wraps {@link lowerSseOpen}
 * once at the fiber boundary.
 *
 * @module
 */

import { validateStreamItem } from "../../runtime/transport/stream-item";
import type { StreamItem, StreamOpen, StreamOpenContext } from "./stream";
import type { SseItem, SseOpen } from "./sse";

/**
 * Lower one SSE protocol item to a validated {@link StreamItem}.
 *
 * @param item - Single SSE envelope or cursor item (no batches).
 * @returns A frozen, validated stream item with `lastEventId` mapped to `cursor`.
 * @throws {TypeError} When the item shape is invalid (same class as stream contract).
 * @throws {RangeError} When `lastEventId` exceeds the durable cursor byte limit.
 */
export function lowerSseItem(item: unknown): StreamItem {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    // Route through the stream validator so batch/array messaging stays unified.
    return validateStreamItem(item);
  }

  const record = item as {
    readonly kind?: unknown;
    readonly lastEventId?: unknown;
    readonly cursor?: unknown;
  };

  if (record.kind === "cursor") {
    return validateStreamItem({
      kind: "cursor",
      cursor: mapLastEventIdField(record),
    });
  }

  if (record.kind === "envelope") {
    const envelope = item as {
      readonly accountId?: unknown;
      readonly eventId?: unknown;
      readonly authenticatedRouting?: unknown;
      readonly payload?: unknown;
      readonly lastEventId?: unknown;
    };

    if (!("lastEventId" in envelope) || envelope.lastEventId === undefined) {
      return validateStreamItem({
        kind: "envelope",
        accountId: envelope.accountId,
        eventId: envelope.eventId,
        authenticatedRouting: envelope.authenticatedRouting,
        payload: envelope.payload,
      });
    }

    return validateStreamItem({
      kind: "envelope",
      accountId: envelope.accountId,
      eventId: envelope.eventId,
      authenticatedRouting: envelope.authenticatedRouting,
      payload: envelope.payload,
      cursor: envelope.lastEventId as string | null,
    });
  }

  return validateStreamItem(item);
}

/**
 * Wrap an SSE open handle so the stream fiber receives {@link StreamItem}s.
 *
 * @param open - Author-supplied SSE open function.
 * @returns A {@link StreamOpen} that lowers each yield and forwards iterator control.
 *
 * @remarks Supports both direct `AsyncIterable` and `Promise<AsyncIterable>`
 * results. Early consumer stop invokes the source iterator's `return` when
 * present so adapter cleanup runs. Consumer `throw` propagates the source
 * `throw` result when present (done or recovered value); otherwise it runs
 * `return` for cleanup and rethrows.
 */
export function lowerSseOpen(open: SseOpen): StreamOpen {
  return (context: StreamOpenContext) => lowerSseOpenIterable(open, context);
}

async function lowerSseOpenIterable(
  open: SseOpen,
  context: StreamOpenContext,
): Promise<AsyncIterable<StreamItem>> {
  const source = await open(context);
  return lowerSseIterable(source);
}

function lowerSseIterable(
  source: AsyncIterable<SseItem>,
): AsyncIterable<StreamItem> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<StreamItem> {
      const sourceIterator = source[Symbol.asyncIterator]();

      return {
        async next(): Promise<IteratorResult<StreamItem>> {
          const result = await sourceIterator.next();
          if (result.done) {
            return { done: true, value: undefined };
          }

          return {
            done: false,
            value: lowerSseItem(result.value),
          };
        },

        async return(
          value?: unknown,
        ): Promise<IteratorResult<StreamItem>> {
          if (typeof sourceIterator.return === "function") {
            await sourceIterator.return(value as never);
          }

          return { done: true, value: undefined };
        },

        async throw(
          error?: unknown,
        ): Promise<IteratorResult<StreamItem>> {
          if (typeof sourceIterator.throw === "function") {
            // Propagate recovery/completion from the source throw result.
            const result = await sourceIterator.throw(error);
            if (result.done) {
              return { done: true, value: undefined };
            }

            return {
              done: false,
              value: lowerSseItem(result.value),
            };
          }

          // No source throw: best-effort cleanup only, then rethrow.
          if (typeof sourceIterator.return === "function") {
            await sourceIterator.return();
          }

          throw error;
        },
      };
    },
  };
}

/**
 * Read `lastEventId` for cursor-only items.
 *
 * @remarks Cursor-only SSE items require `lastEventId` (including `null`).
 * Missing fields are surfaced through the stream validator after mapping to
 * a candidate that lacks `cursor`, which rejects with the same contract code.
 */
function mapLastEventIdField(record: {
  readonly lastEventId?: unknown;
}): unknown {
  if (!("lastEventId" in record)) {
    // Produce a cursor item missing `cursor` so validateStreamItem rejects.
    return undefined;
  }

  return record.lastEventId;
}
