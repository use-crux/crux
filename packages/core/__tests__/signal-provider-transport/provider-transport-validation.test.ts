/**
 * signalProvider transport validation: discriminator plus matching handler.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { signal } from "../../src/signal";
import { polling, webhook } from "../../src/signal/transport";
import { signalProvider } from "../../src/signal/provider";

const orderSubmitted = signal({
  id: "order.submitted",
  schema: z.object({ orderId: z.string() }),
});

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

  it("rejects WebhookTransport discriminators without a callable handle", () => {
    expect(() =>
      signalProvider({
        ...baseOptions(),
        transport: {
          _tag: "WebhookTransport",
          kind: "webhook",
        } as never,
      }),
    ).toThrow(
      /signalProvider\(\{ transport \}\) requires a webhook\(\) or polling\(\) transport definition/,
    );
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
    ).toThrow(
      /signalProvider\(\{ transport \}\) requires a webhook\(\) or polling\(\) transport definition/,
    );
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
    ).toThrow(
      /signalProvider\(\{ transport \}\) requires a webhook\(\) or polling\(\) transport definition/,
    );

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
    ).toThrow(
      /signalProvider\(\{ transport \}\) requires a webhook\(\) or polling\(\) transport definition/,
    );
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
    ).toThrow(
      /signalProvider\(\{ transport \}\) requires a webhook\(\) or polling\(\) transport definition/,
    );

    expect(() =>
      signalProvider({
        ...baseOptions(),
        transport: {
          _tag: "PollingTransport",
          kind: "polling",
          poll: null,
        } as never,
      }),
    ).toThrow(
      /signalProvider\(\{ transport \}\) requires a webhook\(\) or polling\(\) transport definition/,
    );
  });
});
