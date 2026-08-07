/**
 * Managed polling supervision isolation: construction filters and per-binding
 * error containment.
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
  createRuntimeProgram,
  createWorkerTransportSupervision,
  CruxRuntimeError,
  inMemoryRuntimeStore,
  type RuntimeManagedTransportBinding,
  type RuntimeProgram,
} from "../../src/runtime/public";
import { createNamedPollingFixture } from "./polling-supervision-helpers";


describe("Runtime worker polling supervision isolation", () => {
  it("constructs supervision when a webhook-only binding has no in-process provider", () => {
    const webhookBinding: RuntimeManagedTransportBinding = {
      _tag: "RuntimeManagedTransportBinding",
      id: "binding.orders.webhook",
      adapter: {
        _tag: "RuntimeManagedTransportAdapter",
        id: "orders.webhook",
        provider: "orders.webhook",
        acceptedEnvelopeVersion: 1,
      },
      configRef: { id: "config.orders.webhook", revision: "rev.1" },
      target: { kind: "signal", signalId: "order.submitted" },
    };
    const empty = createRuntimeProgram({
      targets: [],
      providers: [],
      transports: [],
    });
    const program = {
      ...empty,
      transports: [webhookBinding],
      providers: [],
    } as RuntimeProgram;
    const store = inMemoryRuntimeStore();

    expect(() =>
      createWorkerTransportSupervision({
        program,
        store,
        namespace: "webhook-only",
      }),
    ).not.toThrow();
    expect(
      createWorkerTransportSupervision({
        program,
        store,
        namespace: "webhook-only",
      }),
    ).toBeUndefined();
  });

  it("keeps CAPABILITY_MISSING when a program declares a binding without its provider", () => {
    const binding: RuntimeManagedTransportBinding = {
      _tag: "RuntimeManagedTransportBinding",
      id: "binding.orders.poll.missing",
      adapter: {
        _tag: "RuntimeManagedTransportAdapter",
        id: "orders.poll.missing",
        provider: "orders.poll.missing",
        acceptedEnvelopeVersion: 1,
      },
      configRef: { id: "config.orders.poll.missing", revision: "rev.1" },
      target: { kind: "signal", signalId: "order.submitted" },
    };

    expect(() =>
      createRuntimeProgram({
        targets: [],
        providers: [],
        transports: [binding],
      }),
    ).toThrow(CruxRuntimeError);
    expect(() =>
      createRuntimeProgram({
        targets: [],
        providers: [],
        transports: [binding],
      }),
    ).toThrow(/CAPABILITY_MISSING/);
  });

  it("skips webhook transports that have an in-process provider", () => {
    const orderSubmitted = signal({
      id: "order.submitted",
      schema: z.object({ orderId: z.string() }),
    });
    const provider = signalProvider({
      id: "orders.webhook.skip",
      transport: webhook({
        async handle() {
          throw new Error("unused");
        },
      }),
      signals: { orderSubmitted },
      async onEvent() {},
    });
    const binding = managedTransportBinding(provider, {
      id: "binding.orders.webhook.skip",
      configRef: { id: "config.orders.webhook.skip", revision: "rev.1" },
      signalId: "order.submitted",
    });
    const program = createRuntimeProgram({
      targets: [],
      providers: [provider],
      transports: [binding],
    });
    const store = inMemoryRuntimeStore();

    expect(
      createWorkerTransportSupervision({
        program,
        store,
        namespace: "webhook-skip",
      }),
    ).toBeUndefined();
  });

  it("continues later bindings when claim throws for an earlier binding", async () => {
    const first = createNamedPollingFixture("bind-a", {
      events: ["evt_a"],
      next: "cursor:a",
    });
    const second = createNamedPollingFixture("bind-b", {
      events: ["evt_b"],
      next: "cursor:b",
    });
    const program = createRuntimeProgram({
      targets: [],
      providers: [first.provider, second.provider],
      transports: [first.binding, second.binding],
    });
    const base = inMemoryRuntimeStore();
    const store = {
      ...base,
      leases: {
        ...base.leases,
        async claim(
          resource: string,
          options: Parameters<typeof base.leases.claim>[1],
        ) {
          if (resource.includes(first.binding.id)) {
            throw new Error("claim unavailable");
          }
          return base.leases.claim(resource, options);
        },
      },
    };
    const runner = createWorkerTransportSupervision({
      program,
      store: store as typeof base,
      namespace: "poll-claim-isolate",
      ownerId: "worker-a",
    })!;
    const signalAbort = new AbortController().signal;

    try {
      const outcome = await runner.runOnce(
        signalAbort,
        new Date("2026-08-07T12:00:00.000Z"),
      );
      expect(outcome.failed).toBeGreaterThanOrEqual(1);
      expect(outcome.accepted).toBe(1);
      expect(second.pollCalls).toHaveLength(1);

      const secondCheckpoint = await base.transports!.getBindingCheckpoint!({
        namespace: "poll-claim-isolate",
        bindingId: second.binding.id,
      });
      expect(secondCheckpoint?.cursor).toBe("cursor:b");
    } finally {
      await runner.dispose();
    }
  });

  it("continues later bindings when checkpoint read throws for an earlier binding", async () => {
    const first = createNamedPollingFixture("ckpt-a", {
      events: ["evt_a"],
      next: "cursor:a",
    });
    const second = createNamedPollingFixture("ckpt-b", {
      events: ["evt_b"],
      next: "cursor:b",
    });
    const program = createRuntimeProgram({
      targets: [],
      providers: [first.provider, second.provider],
      transports: [first.binding, second.binding],
    });
    const base = inMemoryRuntimeStore();
    const store = {
      ...base,
      transports: {
        ...base.transports!,
        async getBindingCheckpoint(input: {
          readonly namespace: string;
          readonly bindingId: string;
        }) {
          if (input.bindingId === first.binding.id) {
            throw new Error("checkpoint read failed");
          }
          return base.transports!.getBindingCheckpoint!(input);
        },
      },
    };
    const runner = createWorkerTransportSupervision({
      program,
      store: store as typeof base,
      namespace: "poll-ckpt-isolate",
      ownerId: "worker-a",
    })!;
    const signalAbort = new AbortController().signal;

    try {
      const outcome = await runner.runOnce(
        signalAbort,
        new Date("2026-08-07T12:00:00.000Z"),
      );
      expect(outcome.failed).toBeGreaterThanOrEqual(1);
      expect(outcome.accepted).toBe(1);
      expect(second.pollCalls).toHaveLength(1);

      const secondCheckpoint = await base.transports!.getBindingCheckpoint!({
        namespace: "poll-ckpt-isolate",
        bindingId: second.binding.id,
      });
      expect(secondCheckpoint?.cursor).toBe("cursor:b");
    } finally {
      await runner.dispose();
    }
  });

  it("continues later bindings when failure recording throws for an earlier binding", async () => {
    const first = createNamedPollingFixture("fail-a", {
      events: ["evt_a"],
      next: "cursor:a",
      failPoll: true,
    });
    const second = createNamedPollingFixture("fail-b", {
      events: ["evt_b"],
      next: "cursor:b",
    });
    const program = createRuntimeProgram({
      targets: [],
      providers: [first.provider, second.provider],
      transports: [first.binding, second.binding],
    });
    const base = inMemoryRuntimeStore();
    const store = {
      ...base,
      transports: {
        ...base.transports!,
        async putBindingCheckpoint(
          input: Parameters<
            NonNullable<typeof base.transports>["putBindingCheckpoint"]
          >[0],
        ) {
          if (
            input.checkpoint.bindingId === first.binding.id &&
            input.checkpoint.lastErrorCode !== undefined
          ) {
            throw new Error("failure record write failed");
          }
          return base.transports!.putBindingCheckpoint!(input);
        },
      },
    };
    const runner = createWorkerTransportSupervision({
      program,
      store: store as typeof base,
      namespace: "poll-failrec-isolate",
      ownerId: "worker-a",
    })!;
    const signalAbort = new AbortController().signal;

    try {
      const outcome = await runner.runOnce(
        signalAbort,
        new Date("2026-08-07T12:00:00.000Z"),
      );
      expect(outcome.failed).toBeGreaterThanOrEqual(1);
      expect(outcome.accepted).toBe(1);
      expect(second.pollCalls).toHaveLength(1);

      const secondCheckpoint = await base.transports!.getBindingCheckpoint!({
        namespace: "poll-failrec-isolate",
        bindingId: second.binding.id,
      });
      expect(secondCheckpoint?.cursor).toBe("cursor:b");
    } finally {
      await runner.dispose();
    }
  });
});
