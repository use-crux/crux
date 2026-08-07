/**
 * Pure WebSocket authoring → managed stream protocol lowering.
 *
 * @remarks Maps WebSocket items onto the canonical stream contract and reuses
 * {@link validateStreamItem} for immutable detachment of payload/routing.
 * Optional {@link import("./websocket").WebSocketEnvelopeItem.acknowledge}
 * is preserved as process-local code for the post-accept seam. No I/O, stores,
 * or worker ownership lives here — supervision wraps {@link lowerWebSocketOpen}
 * once at the fiber boundary.
 *
 * @module
 */

import { validateStreamItem } from "../../runtime/transport/stream-item";
import type { StreamItem, StreamOpen, StreamOpenContext } from "./stream";
import type { WebSocketItem, WebSocketOpen } from "./websocket";

/**
 * Lower one WebSocket protocol item to a validated {@link StreamItem}.
 *
 * @param item - Single WebSocket envelope or cursor item (no batches).
 * @returns A frozen, validated stream item (acknowledge preserved when present).
 * @throws {TypeError} When the item shape is invalid (same class as stream contract).
 * @throws {RangeError} When `cursor` exceeds the durable cursor byte limit.
 */
export function lowerWebSocketItem(item: unknown): StreamItem {
  // WebSocket authoring uses the same cursor vocabulary as stream items.
  // validateStreamItem also preserves optional acknowledge and detaches payload.
  return validateStreamItem(item);
}

/**
 * Wrap a WebSocket open handle so the stream fiber receives {@link StreamItem}s.
 *
 * @param open - Author-supplied WebSocket open function.
 * @returns A {@link StreamOpen} that lowers each yield and forwards iterator return.
 *
 * @remarks Supports both direct `AsyncIterable` and `Promise<AsyncIterable>`
 * results. Early consumer stop invokes the source iterator's `return` when
 * present so adapter cleanup (socket close, unsubscribe) runs.
 */
export function lowerWebSocketOpen(open: WebSocketOpen): StreamOpen {
  return (context: StreamOpenContext) => lowerWebSocketOpenIterable(open, context);
}

async function lowerWebSocketOpenIterable(
  open: WebSocketOpen,
  context: StreamOpenContext,
): Promise<AsyncIterable<StreamItem>> {
  const source = await open(context);
  return lowerWebSocketIterable(source);
}

function lowerWebSocketIterable(
  source: AsyncIterable<WebSocketItem>,
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
            value: lowerWebSocketItem(result.value),
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
            await sourceIterator.throw(error);
          } else if (typeof sourceIterator.return === "function") {
            await sourceIterator.return();
          }

          throw error;
        },
      };
    },
  };
}
