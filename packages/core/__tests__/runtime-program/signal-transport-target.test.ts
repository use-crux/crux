/**
 * Signal transport targets are Signal ids, not Agent/Flow/task targets.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createRuntimeProgram,
  type RuntimeManagedTransportBinding,
} from "../../src/runtime/public";
import { signal } from "../../src/signal";
import { webhook } from "../../src/signal/transport";
import { signalProvider } from "../../src/signal/provider";

function binding(signalId: string): RuntimeManagedTransportBinding {
  return {
    _tag: "RuntimeManagedTransportBinding",
    id: "binding.orders",
    adapter: {
      _tag: "RuntimeManagedTransportAdapter",
      id: "orders.webhook",
      provider: "orders.webhook",
      acceptedEnvelopeVersion: 1,
    },
    configRef: { id: "config.orders", revision: "rev.1" },
    target: { kind: "signal", signalId },
  };
}

function ordersProvider() {
  return signalProvider({
    id: "orders.webhook",
    transport: webhook({
      async handle() {
        throw new Error("unused");
      },
    }),
    signals: {
      orderSubmitted: signal({
        id: "order.submitted",
        schema: z.object({ orderId: z.string() }),
      }),
    },
    async onEvent() {},
  });
}

describe("RuntimeProgram Signal transport targets", () => {
  it("accepts a Signal id that is not an Agent, Flow, or task target", () => {
    const program = createRuntimeProgram({
      targets: [{ name: "orders.flow", kind: "flow" }],
      providers: [ordersProvider()],
      transports: [binding("order.submitted")],
    });

    expect(program.transports).toEqual([binding("order.submitted")]);
    expect(program.manifestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("still rejects duplicate binding identities", () => {
    expect(() =>
      createRuntimeProgram({
        targets: [],
        providers: [ordersProvider()],
        transports: [binding("order.submitted"), binding("order.submitted")],
      }),
    ).toThrow(/TARGET_DUPLICATE/);
  });
});
