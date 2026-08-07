/**
 * signalProvider transport validation: discriminator plus matching handler.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { signal } from "../../src/signal";
import { polling, sse, stream, webhook } from "../../src/signal/transport";
import { signalProvider } from "../../src/signal/provider";

const orderSubmitted = signal({
  id: "order.submitted",
  schema: z.object({ orderId: z.string() }),
});

const TRANSPORT_REQUIRED =
  /signalProvider\(\{ transport \}\) requires a webhook\(\), polling\(\), stream\(\), or sse\(\) transport definition/;

function baseOptions() {
  return {
    id: "orders.provider",
    signals: { orderSubmitted },
    async onEvent() {},
  } as const;
}

describe("signalProvider transport validation", () => {
  it("accepts webhook transports with a callable handle", () => {
    const provider = signalProvider({
      ...baseOptions(),
      transport: webhook({
        async handle() {
          throw new Error("unused");
        },
      }),
    });

    expect(provider.transport._tag).toBe("WebhookTransport");
  });

  it("accepts polling transports with a callable poll", () => {
    const provider = signalProvider({
      ...baseOptions(),
      transport: polling({
        async poll() {
          return { events: [], nextCursor: null };
        },
      }),
    });

    expect(provider.transport._tag).toBe("PollingTransport");
  });

  it("accepts stream transports with a callable open", () => {
    const provider = signalProvider({
      ...baseOptions(),
      transport: stream({
        async *open() {
          yield { kind: "cursor" as const, cursor: null };
        },
      }),
    });

    expect(provider.transport._tag).toBe("StreamTransport");
    expect(provider.transport.kind).toBe("stream");
  });

  it("accepts sse transports with a callable open", () => {
    const provider = signalProvider({
      ...baseOptions(),
      transport: sse({
        async *open() {
          yield { kind: "cursor" as const, lastEventId: null };
        },
      }),
    });

    expect(provider.transport._tag).toBe("SseTransport");
    expect(provider.transport.kind).toBe("sse");
  });

  it("rejects WebhookTransport discriminators without a callable handle", () => {
    expect(() =>
      signalProvider({
        ...baseOptions(),
        transport: {
          _tag: "WebhookTransport",
          kind: "webhook",
        } as never,
      }),
    ).toThrow(TRANSPORT_REQUIRED);
  });

  it("rejects PollingTransport discriminators without a callable poll", () => {
    expect(() =>
      signalProvider({
        ...baseOptions(),
        transport: {
          _tag: "PollingTransport",
          kind: "polling",
        } as never,
      }),
    ).toThrow(TRANSPORT_REQUIRED);
  });

  it("rejects StreamTransport discriminators without a callable open", () => {
    expect(() =>
      signalProvider({
        ...baseOptions(),
        transport: {
          _tag: "StreamTransport",
          kind: "stream",
        } as never,
      }),
    ).toThrow(TRANSPORT_REQUIRED);
  });

  it("rejects SseTransport discriminators without a callable open", () => {
    expect(() =>
      signalProvider({
        ...baseOptions(),
        transport: {
          _tag: "SseTransport",
          kind: "sse",
        } as never,
      }),
    ).toThrow(TRANSPORT_REQUIRED);
  });

  it("rejects mismatched handlers for each transport discriminator", () => {
    expect(() =>
      signalProvider({
        ...baseOptions(),
        transport: {
          _tag: "WebhookTransport",
          kind: "webhook",
          poll: async () => ({ events: [], nextCursor: null }),
        } as never,
      }),
    ).toThrow(TRANSPORT_REQUIRED);

    expect(() =>
      signalProvider({
        ...baseOptions(),
        transport: {
          _tag: "PollingTransport",
          kind: "polling",
          handle: async () => {
            throw new Error("unused");
          },
        } as never,
      }),
    ).toThrow(TRANSPORT_REQUIRED);

    expect(() =>
      signalProvider({
        ...baseOptions(),
        transport: {
          _tag: "StreamTransport",
          kind: "stream",
          poll: async () => ({ events: [], nextCursor: null }),
        } as never,
      }),
    ).toThrow(TRANSPORT_REQUIRED);

    expect(() =>
      signalProvider({
        ...baseOptions(),
        transport: {
          _tag: "SseTransport",
          kind: "sse",
          poll: async () => ({ events: [], nextCursor: null }),
        } as never,
      }),
    ).toThrow(TRANSPORT_REQUIRED);
  });

  it("rejects non-function handlers even when the field is present", () => {
    expect(() =>
      signalProvider({
        ...baseOptions(),
        transport: {
          _tag: "WebhookTransport",
          kind: "webhook",
          handle: "not-a-function",
        } as never,
      }),
    ).toThrow(TRANSPORT_REQUIRED);

    expect(() =>
      signalProvider({
        ...baseOptions(),
        transport: {
          _tag: "PollingTransport",
          kind: "polling",
          poll: null,
        } as never,
      }),
    ).toThrow(TRANSPORT_REQUIRED);

    expect(() =>
      signalProvider({
        ...baseOptions(),
        transport: {
          _tag: "StreamTransport",
          kind: "stream",
          open: "not-a-function",
        } as never,
      }),
    ).toThrow(TRANSPORT_REQUIRED);

    expect(() =>
      signalProvider({
        ...baseOptions(),
        transport: {
          _tag: "SseTransport",
          kind: "sse",
          open: "not-a-function",
        } as never,
      }),
    ).toThrow(TRANSPORT_REQUIRED);
  });

  it("rejects non-transport values", () => {
    expect(() =>
      signalProvider({
        ...baseOptions(),
        transport: { _tag: "UnknownTransport" } as never,
      }),
    ).toThrow(TRANSPORT_REQUIRED);

    expect(() =>
      signalProvider({
        ...baseOptions(),
        transport: null as never,
      }),
    ).toThrow(TRANSPORT_REQUIRED);
  });
});
