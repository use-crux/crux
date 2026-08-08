/**
 * Pure WebSocket → StreamItem lowering and open wrapper contract.
 */

import { describe, expect, it, vi } from "vitest";

import {
  lowerWebSocketItem,
  lowerWebSocketOpen,
} from "../../src/signal/transport/websocket-lower";
import type {
  StreamOpenContext,
  WebSocketItem,
  WebSocketOpen,
} from "../../src/signal/transport";

const samplePayload = {
  kind: "inline-base64url" as const,
  value: "YQ",
  byteLength: 1,
  sha256:
    "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
};

const sampleContext: StreamOpenContext = {
  cursor: null,
  signal: new AbortController().signal,
  configRef: { id: "config.ws", revision: "rev.1" },
};

describe("lowerWebSocketItem", () => {
  it("preserves envelope cursor and detaches payload/routing", () => {
    const routing = { source: "websocket" };
    const lowered = lowerWebSocketItem({
      kind: "envelope",
      accountId: "acct_1",
      eventId: "evt_1",
      authenticatedRouting: routing,
      payload: samplePayload,
      cursor: "ws:42",
    });

    expect(lowered).toEqual({
      kind: "envelope",
      accountId: "acct_1",
      eventId: "evt_1",
      authenticatedRouting: routing,
      payload: samplePayload,
      cursor: "ws:42",
    });
    if (lowered.kind === "envelope") {
      expect(Object.isFrozen(lowered)).toBe(true);
      expect(Object.isFrozen(lowered.authenticatedRouting)).toBe(true);
    }
  });

  it("preserves optional acknowledge function for post-accept seam", () => {
    const acknowledge = vi.fn(async () => undefined);
    const lowered = lowerWebSocketItem({
      kind: "envelope",
      accountId: "acct_1",
      eventId: "evt_ack",
      authenticatedRouting: {},
      payload: samplePayload,
      cursor: "ws:ack",
      acknowledge,
    });

    expect(lowered.kind).toBe("envelope");
    if (lowered.kind === "envelope") {
      expect(lowered.acknowledge).toBe(acknowledge);
      expect(lowered.cursor).toBe("ws:ack");
    }
  });

  it("maps cursor-only items", () => {
    expect(
      lowerWebSocketItem({
        kind: "cursor",
        cursor: "hb:9",
      }),
    ).toEqual({
      kind: "cursor",
      cursor: "hb:9",
    });
  });

  it("rejects non-function acknowledge", () => {
    expect(() =>
      lowerWebSocketItem({
        kind: "envelope",
        accountId: "acct_1",
        eventId: "evt_1",
        authenticatedRouting: {},
        payload: samplePayload,
        acknowledge: "not-a-function",
      }),
    ).toThrow(/acknowledge must be a function/);
  });
});

describe("lowerWebSocketOpen", () => {
  it("lowers each yield and forwards open context", async () => {
    const open: WebSocketOpen = async function* (context) {
      expect(context.cursor).toBeNull();
      expect(context.configRef).toEqual(sampleContext.configRef);
      yield {
        kind: "envelope",
        accountId: "acct_1",
        eventId: "evt_1",
        authenticatedRouting: { source: "ws" },
        payload: samplePayload,
        cursor: "c1",
      } satisfies WebSocketItem;
    };

    const loweredOpen = lowerWebSocketOpen(open);
    const items: unknown[] = [];
    for await (const item of await loweredOpen(sampleContext)) {
      items.push(item);
    }

    expect(items).toEqual([
      {
        kind: "envelope",
        accountId: "acct_1",
        eventId: "evt_1",
        authenticatedRouting: { source: "ws" },
        payload: samplePayload,
        cursor: "c1",
      },
    ]);
  });

  it("forwards iterator return for adapter cleanup", async () => {
    const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
    const open: WebSocketOpen = () => ({
      [Symbol.asyncIterator]() {
        let delivered = false;
        return {
          async next() {
            if (delivered) {
              return { done: true as const, value: undefined };
            }
            delivered = true;
            return {
              done: false as const,
              value: {
                kind: "cursor" as const,
                cursor: "c0",
              },
            };
          },
          return: returned,
        };
      },
    });

    const loweredOpen = lowerWebSocketOpen(open);
    const iterable = await loweredOpen(sampleContext);
    const iterator = iterable[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    expect(returned).toHaveBeenCalledOnce();
  });

  it("propagates a recovered throw result from the source iterator", async () => {
    const open: WebSocketOpen = () => ({
      [Symbol.asyncIterator]() {
        return {
          async next() {
            return { done: true as const, value: undefined };
          },
          async throw(_error?: unknown) {
            return {
              done: false as const,
              value: {
                kind: "cursor" as const,
                cursor: "ws:recovered",
              },
            };
          },
        };
      },
    });

    const loweredOpen = lowerWebSocketOpen(open);
    const iterable = await loweredOpen(sampleContext);
    const iterator = iterable[Symbol.asyncIterator]();

    await expect(iterator.throw?.(new Error("injected"))).resolves.toEqual({
      done: false,
      value: { kind: "cursor", cursor: "ws:recovered" },
    });
  });

  it("returns done when source throw completes", async () => {
    const open: WebSocketOpen = () => ({
      [Symbol.asyncIterator]() {
        return {
          async next() {
            return { done: true as const, value: undefined };
          },
          async throw(_error?: unknown) {
            return { done: true as const, value: undefined };
          },
        };
      },
    });

    const loweredOpen = lowerWebSocketOpen(open);
    const iterable = await loweredOpen(sampleContext);
    const iterator = iterable[Symbol.asyncIterator]();

    await expect(iterator.throw?.(new Error("injected"))).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it("calls return only for cleanup when throw is absent, then rethrows", async () => {
    const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
    const open: WebSocketOpen = () => ({
      [Symbol.asyncIterator]() {
        return {
          async next() {
            return { done: true as const, value: undefined };
          },
          return: returned,
        };
      },
    });

    const loweredOpen = lowerWebSocketOpen(open);
    const iterable = await loweredOpen(sampleContext);
    const iterator = iterable[Symbol.asyncIterator]();
    const error = new Error("no-throw-method");

    await expect(iterator.throw?.(error)).rejects.toBe(error);
    expect(returned).toHaveBeenCalledOnce();
  });
});
