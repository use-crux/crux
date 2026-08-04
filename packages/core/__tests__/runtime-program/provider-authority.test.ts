/**
 * RuntimeProgram executable Signal-provider authority and binding resolution.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { signal } from "../../src/signal";
import { webhook } from "../../src/signal/transport";
import {
  managedTransportBinding,
  signalProvider,
} from "../../src/signal/provider";
import {
  CruxRuntimeError,
  createRuntimeProgram,
  createRuntimeWorker,
  inMemoryRuntimeStore,
  node,
  type RuntimeManagedTransportBinding,
} from "../../src/runtime/public";

function inertBinding(
  id: string,
  adapterId: string,
  provider = adapterId,
): RuntimeManagedTransportBinding {
  return {
    _tag: "RuntimeManagedTransportBinding",
    id,
    adapter: {
      _tag: "RuntimeManagedTransportAdapter",
      id: adapterId,
      provider,
      acceptedEnvelopeVersion: 1,
    },
    configRef: { id: `config.${id}`, revision: "rev.1" },
    target: { kind: "signal", signalId: "order.submitted" },
  };
}

function ordersProvider(id = "orders.webhook") {
  return signalProvider({
    id,
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

describe("RuntimeProgram provider authority", () => {
  it("retains executable providers beside inert bindings without hashing callbacks", () => {
    const provider = ordersProvider();
    const binding = managedTransportBinding(provider, {
      id: "binding.orders",
      configRef: { id: "config.orders", revision: "rev.1" },
      signalId: "order.submitted",
    });
    const first = createRuntimeProgram({
      targets: [],
      providers: [provider],
      transports: [binding],
    });
    const second = createRuntimeProgram({
      targets: [],
      providers: [
        signalProvider({
          id: "orders.webhook",
          transport: webhook({
            async handle() {
              throw new Error("different live handle");
            },
          }),
          signals: provider.signals,
          async onEvent() {
            throw new Error("different onEvent");
          },
        }),
      ],
      transports: [binding],
    });

    expect(first.providers).toHaveLength(1);
    expect(first.providers[0]).toBe(provider);
    expect(first.manifestHash).toBe(second.manifestHash);
    expect(Object.isFrozen(first.providers)).toBe(true);
    expect(
      Object.getOwnPropertyNames(first.transports[0]!).includes("onEvent"),
    ).toBe(false);
  });

  it("rejects a transport binding without a matching executable provider", () => {
    expect(() =>
      createRuntimeProgram({
        targets: [],
        providers: [],
        transports: [inertBinding("binding.orders", "orders.webhook")],
      }),
    ).toThrow(CruxRuntimeError);
    expect(() =>
      createRuntimeProgram({
        targets: [],
        providers: [],
        transports: [inertBinding("binding.orders", "orders.webhook")],
      }),
    ).toThrow(/CAPABILITY_MISSING/);
  });

  it("rejects mismatched provider identities for a binding", () => {
    expect(() =>
      createRuntimeProgram({
        targets: [],
        providers: [ordersProvider("other.provider")],
        transports: [inertBinding("binding.orders", "orders.webhook")],
      }),
    ).toThrow(/CAPABILITY_MISSING/);
  });

  it("rejects duplicate provider identities", () => {
    const provider = ordersProvider();
    expect(() =>
      createRuntimeProgram({
        targets: [],
        providers: [provider, ordersProvider(provider.id)],
        transports: [
          managedTransportBinding(provider, {
            id: "binding.orders",
            configRef: { id: "config.orders", revision: "rev.1" },
            signalId: "order.submitted",
          }),
        ],
      }),
    ).toThrow(/TARGET_DUPLICATE/);
  });

  it("resolves a binding by adapter id when the provider system name differs", () => {
    const provider = ordersProvider("orders.webhook");
    const binding = managedTransportBinding(provider, {
      id: "binding.orders",
      configRef: { id: "config.orders", revision: "rev.1" },
      signalId: "order.submitted",
      provider: "github",
      adapterId: "orders.webhook",
    });
    const program = createRuntimeProgram({
      targets: [],
      providers: [provider],
      transports: [binding],
    });
    expect(program.providers[0]?.id).toBe("orders.webhook");
    expect(program.transports[0]?.adapter.provider).toBe("github");
  });

  it("rejects worker start when transport authority is incomplete", () => {
    // Simulate a program object that bypassed createRuntimeProgram validation.
    const incomplete = createRuntimeProgram({
      targets: [],
      providers: [ordersProvider()],
      transports: [
        managedTransportBinding(ordersProvider(), {
          id: "binding.orders",
          configRef: { id: "config.orders", revision: "rev.1" },
          signalId: "order.submitted",
        }),
      ],
    });
    const stripped = Object.freeze({
      ...incomplete,
      providers: Object.freeze([]),
    });

    expect(() =>
      createRuntimeWorker({
        runtime: node({
          store: inMemoryRuntimeStore(),
          namespace: "provider-authority",
          autoStartMaintenance: false,
        }),
        program: stripped,
      }),
    ).toThrow(/CAPABILITY_MISSING/);
  });
});
