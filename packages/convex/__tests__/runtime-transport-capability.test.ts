/**
 * Convex Runtime store must not claim managed-transport capabilities it lacks.
 */

import { signal } from "@use-crux/core/signal";
import { managedTransportBinding, signalProvider } from "@use-crux/core/signal/provider";
import { webhook } from "@use-crux/core/signal/transport";
import {
  createRuntimeProgram,
  createRuntimeWorker,
  node,
} from "@use-crux/core/runtime";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import schema from "../src/component/schema";
import { convexRuntimeStore } from "../src/runtime";
import {
  runtimePublicWorkComponent,
  runtimePublicWorkCtx,
  runtimePublicWorkModules,
} from "./runtime-public-work-fixture";

describe("Convex managed-transport capability honesty", () => {
  it("does not expose a transports port and rejects managed-binding workers", () => {
    const test = convexTest({ schema, modules: runtimePublicWorkModules });
    const store = convexRuntimeStore({
      ctx: runtimePublicWorkCtx(test),
      component: runtimePublicWorkComponent(),
    });

    // Convex Runtime storage supports Work/events/leases, not managed transport
    // envelope accept, binding checkpoints, or transport statistics.
    expect(store.transports).toBeUndefined();
    expect("transports" in store ? store.transports : undefined).toBeUndefined();

    const orderSubmitted = signal({
      id: "order.submitted",
      schema: z.object({ orderId: z.string() }),
    });
    const provider = signalProvider({
      id: "orders.webhook",
      transport: webhook({
        async handle() {
          throw new Error("unused");
        },
      }),
      signals: { orderSubmitted },
      async onEvent() {},
    });
    const program = createRuntimeProgram({
      targets: [],
      providers: [provider],
      transports: [
        managedTransportBinding(provider, {
          id: "binding.orders",
          configRef: { id: "config.orders", revision: "rev.1" },
          signalId: "order.submitted",
        }),
      ],
    });

    expect(() =>
      createRuntimeWorker({
        runtime: node({
          store,
          namespace: "convex-no-transports",
          autoStartMaintenance: false,
        }),
        program,
      }),
    ).toThrow(/CAPABILITY_MISSING/);
  });
});
