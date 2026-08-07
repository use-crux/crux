/**
 * Managed polling supervision hardening: lease deadlines and checkpoint fences.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { signal } from "../../src/signal";
import { polling } from "../../src/signal/transport";
import {
  managedTransportBinding,
  signalProvider,
} from "../../src/signal/provider";
import {
  bindingLeaseResource,
  createRuntimeProgram,
  createWorkerTransportSupervision,
  inMemoryRuntimeStore,
  type Lease,
  type LeaseToken,
} from "../../src/runtime/public";
import {
  createPollingFixture,
  inlinePayload,
  sampleCheckpoint,
} from "./polling-supervision-helpers";

describe("Runtime worker polling supervision hardening", () => {
  it("aborts in-flight poll acquisition and releases the binding lease on dispose", async () => {
    const orderSubmitted = signal({
      id: "order.submitted",
      schema: z.object({ orderId: z.string() }),
    });
    let pollEntered: (() => void) | undefined;
    const pollStarted = new Promise<void>((resolve) => {
      pollEntered = resolve;
    });
    let sawAbort = false;
    const provider = signalProvider({
      id: "orders.poll.abort",
      transport: polling({
        async poll({ signal }) {
          pollEntered?.();
          await new Promise<void>((resolve, reject) => {
            if (signal.aborted) {
              reject(new DOMException("aborted", "AbortError"));
              return;
            }
            signal.addEventListener(
              "abort",
              () => {
                sawAbort = true;
                reject(new DOMException("aborted", "AbortError"));
              },
              { once: true },
            );
          });
          return { events: [], nextCursor: null };
        },
      }),
      signals: { orderSubmitted },
      async onEvent() {},
    });
    const binding = managedTransportBinding(provider, {
      id: "binding.orders.poll.abort",
      configRef: { id: "config.orders.poll.abort", revision: "rev.1" },
      signalId: "order.submitted",
    });
    const program = createRuntimeProgram({
      targets: [],
      providers: [provider],
      transports: [binding],
    });
    const store = inMemoryRuntimeStore();
    const runner = createWorkerTransportSupervision({
      program,
      store,
      namespace: "poll-abort",
      ownerId: "worker-a",
    })!;
    const controller = new AbortController();

    const runPromise = runner.runOnce(
      controller.signal,
      new Date("2026-08-07T12:00:00.000Z"),
    );
    await pollStarted;
    controller.abort();
    const outcome = await runPromise;
    expect(sawAbort).toBe(true);
    expect(outcome.checkpointed).toBe(0);
    expect(outcome.accepted).toBe(0);

    await runner.dispose();

    const reclaim = await store.leases.claim(
      bindingLeaseResource("poll-abort", binding.id),
      { ttlMs: 1_000, ownerId: "replacement" },
    );
    expect(reclaim).not.toBeNull();
    await store.leases.release(reclaim!);
  });

  it("aborts in-flight poll when the active binding lease expires", async () => {
    const orderSubmitted = signal({
      id: "order.submitted",
      schema: z.object({ orderId: z.string() }),
    });
    let pollEntered: (() => void) | undefined;
    const pollStarted = new Promise<void>((resolve) => {
      pollEntered = resolve;
    });
    let sawAbort = false;
    let pollSignal: AbortSignal | undefined;
    const provider = signalProvider({
      id: "orders.poll.lease-deadline",
      transport: polling({
        async poll({ signal }) {
          pollSignal = signal;
          pollEntered?.();
          await new Promise<void>((resolve, reject) => {
            if (signal.aborted) {
              reject(new DOMException("aborted", "AbortError"));
              return;
            }
            signal.addEventListener(
              "abort",
              () => {
                sawAbort = true;
                reject(new DOMException("aborted", "AbortError"));
              },
              { once: true },
            );
          });
          return { events: [], nextCursor: null };
        },
      }),
      signals: { orderSubmitted },
      async onEvent() {},
    });
    const binding = managedTransportBinding(provider, {
      id: "binding.orders.poll.lease-deadline",
      configRef: { id: "config.orders.poll.lease-deadline", revision: "rev.1" },
      signalId: "order.submitted",
    });
    const program = createRuntimeProgram({
      targets: [],
      providers: [provider],
      transports: [binding],
    });
    const base = inMemoryRuntimeStore();
    // Force a short lease so poll must race the active binding deadline.
    const store = {
      ...base,
      leases: {
        ...base.leases,
        async claim(
          resource: string,
          options: Parameters<typeof base.leases.claim>[1],
        ) {
          return base.leases.claim(resource, { ...options, ttlMs: 30 });
        },
        async extend(lease: Lease, _ttlMs: number) {
          return base.leases.extend(lease, 30);
        },
      },
    };
    const runner = createWorkerTransportSupervision({
      program,
      store: store as typeof base,
      namespace: "poll-lease-deadline",
      ownerId: "worker-a",
    })!;
    const parent = new AbortController();

    try {
      const runPromise = runner.runOnce(
        parent.signal,
        new Date("2026-08-07T12:00:00.000Z"),
      );
      await pollStarted;
      expect(pollSignal).toBeDefined();
      expect(pollSignal).not.toBe(parent.signal);
      expect(parent.signal.aborted).toBe(false);

      await expect
        .poll(() => sawAbort, { timeout: 2_000 })
        .toBe(true);
      expect(parent.signal.aborted).toBe(false);

      const outcome = await runPromise;
      expect(outcome.accepted).toBe(0);
      expect(outcome.checkpointed).toBe(0);
      expect(outcome.failed).toBe(0);

      await expect(
        base.transports!.getBindingCheckpoint!({
          namespace: "poll-lease-deadline",
          bindingId: binding.id,
        }),
      ).resolves.toBeNull();
    } finally {
      await runner.dispose();
    }
  });

  it("rejects a stale poll result after the binding lease deadline", async () => {
    const orderSubmitted = signal({
      id: "order.submitted",
      schema: z.object({ orderId: z.string() }),
    });
    let pollEntered: (() => void) | undefined;
    const pollStarted = new Promise<void>((resolve) => {
      pollEntered = resolve;
    });
    const provider = signalProvider({
      id: "orders.poll.stale-after-deadline",
      transport: polling({
        async poll({ signal }) {
          pollEntered?.();
          // Ignore cooperative abort and return after the lease deadline so the
          // supervisor must drop the stale page rather than accept/checkpoint.
          await new Promise<void>((resolve) => {
            if (signal.aborted) {
              resolve();
              return;
            }
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          await new Promise((resolve) => setTimeout(resolve, 5));
          return {
            events: [
              {
                accountId: "acct_1",
                eventId: "evt_stale",
                authenticatedRouting: { source: "polling" },
                payload: inlinePayload(
                  JSON.stringify({ orderId: "ord_stale" }),
                ),
              },
            ],
            nextCursor: "cursor:stale",
          };
        },
      }),
      signals: { orderSubmitted },
      async onEvent() {},
    });
    const binding = managedTransportBinding(provider, {
      id: "binding.orders.poll.stale-after-deadline",
      configRef: {
        id: "config.orders.poll.stale-after-deadline",
        revision: "rev.1",
      },
      signalId: "order.submitted",
    });
    const program = createRuntimeProgram({
      targets: [],
      providers: [provider],
      transports: [binding],
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
          return base.leases.claim(resource, { ...options, ttlMs: 30 });
        },
        async extend(lease: Lease, _ttlMs: number) {
          return base.leases.extend(lease, 30);
        },
      },
    };
    const runner = createWorkerTransportSupervision({
      program,
      store: store as typeof base,
      namespace: "poll-stale-deadline",
      ownerId: "worker-a",
    })!;
    const parent = new AbortController().signal;

    try {
      const runPromise = runner.runOnce(
        parent,
        new Date("2026-08-07T12:00:00.000Z"),
      );
      await pollStarted;
      const outcome = await runPromise;
      expect(outcome.accepted).toBe(0);
      expect(outcome.checkpointed).toBe(0);
      expect(outcome.failed).toBe(0);

      await expect(
        base.transports!.getBindingCheckpoint!({
          namespace: "poll-stale-deadline",
          bindingId: binding.id,
        }),
      ).resolves.toBeNull();

      const claimed = await base.transports!.claim({
        namespace: "poll-stale-deadline",
        limit: 10,
        now: new Date("2026-08-07T12:00:01.000Z"),
        leaseMs: 30_000,
        leaseToken: "lease_test",
      });
      expect(claimed).toEqual([]);
    } finally {
      await runner.dispose();
    }
  });

  it("does not poll when the active binding lease is already expired", async () => {
    const orderSubmitted = signal({
      id: "order.submitted",
      schema: z.object({ orderId: z.string() }),
    });
    const pollCalls: string[] = [];
    const provider = signalProvider({
      id: "orders.poll.already-expired",
      transport: polling({
        async poll() {
          pollCalls.push("polled");
          return {
            events: [
              {
                accountId: "acct_1",
                eventId: "evt_expired",
                authenticatedRouting: { source: "polling" },
                payload: inlinePayload(
                  JSON.stringify({ orderId: "ord_expired" }),
                ),
              },
            ],
            nextCursor: "cursor:expired",
          };
        },
      }),
      signals: { orderSubmitted },
      async onEvent() {},
    });
    const binding = managedTransportBinding(provider, {
      id: "binding.orders.poll.already-expired",
      configRef: {
        id: "config.orders.poll.already-expired",
        revision: "rev.1",
      },
      signalId: "order.submitted",
    });
    const program = createRuntimeProgram({
      targets: [],
      providers: [provider],
      transports: [binding],
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
          const lease = await base.leases.claim(resource, {
            ...options,
            ttlMs: 1,
          });
          if (!lease) {
            return null;
          }
          // Simulate a held lease that already lost its deadline before poll.
          return Object.freeze({
            ...lease,
            expiresAt: new Date(Date.now() - 1),
          });
        },
      },
    };
    const runner = createWorkerTransportSupervision({
      program,
      store: store as typeof base,
      namespace: "poll-already-expired",
      ownerId: "worker-a",
    })!;
    const parent = new AbortController().signal;

    try {
      const outcome = await runner.runOnce(
        parent,
        new Date("2026-08-07T12:00:00.000Z"),
      );
      expect(pollCalls).toEqual([]);
      expect(outcome.accepted).toBe(0);
      expect(outcome.checkpointed).toBe(0);
      expect(outcome.polled).toBe(1);
      expect(outcome.failed).toBe(0);

      await expect(
        base.transports!.getBindingCheckpoint!({
          namespace: "poll-already-expired",
          bindingId: binding.id,
        }),
      ).resolves.toBeNull();
    } finally {
      await runner.dispose();
    }
  });

  it("fences putBindingCheckpoint on the active binding lease owner and token", async () => {
    const store = inMemoryRuntimeStore();
    const namespace = "poll-fence";
    const bindingId = "binding.orders.poll.fence";
    const resource = bindingLeaseResource(namespace, bindingId);
    const lease = await store.leases.claim(resource, {
      ttlMs: 30_000,
      ownerId: "worker-a",
    });
    expect(lease).not.toBeNull();

    const accepted = await store.transports!.putBindingCheckpoint!({
      checkpoint: sampleCheckpoint({
        namespace,
        bindingId,
        cursor: "cursor:1",
        lastOwnerId: "worker-a",
      }),
      lease: lease!,
    });
    expect(accepted).toEqual({ kind: "accepted" });
    await expect(
      store.transports!.getBindingCheckpoint!({ namespace, bindingId }),
    ).resolves.toMatchObject({ cursor: "cursor:1" });

    const wrongToken: Lease = Object.freeze({
      ...lease!,
      token: "lease_stale" as LeaseToken,
    });
    expect(
      await store.transports!.putBindingCheckpoint!({
        checkpoint: sampleCheckpoint({
          namespace,
          bindingId,
          cursor: "cursor:stale-token",
          lastOwnerId: "worker-a",
        }),
        lease: wrongToken,
      }),
    ).toEqual({ kind: "rejected" });

    const wrongOwner: Lease = Object.freeze({
      ...lease!,
      ownerId: "worker-intruder",
    });
    expect(
      await store.transports!.putBindingCheckpoint!({
        checkpoint: sampleCheckpoint({
          namespace,
          bindingId,
          cursor: "cursor:stale-owner",
          lastOwnerId: "worker-intruder",
        }),
        lease: wrongOwner,
      }),
    ).toEqual({ kind: "rejected" });

    await store.leases.release(lease!);

    // No held lease and no checkpoint row: still reject instead of inserting.
    const missingBindingId = "binding.orders.poll.missing";
    const missingResource = bindingLeaseResource(namespace, missingBindingId);
    expect(
      await store.transports!.putBindingCheckpoint!({
        checkpoint: sampleCheckpoint({
          namespace,
          bindingId: missingBindingId,
          cursor: "cursor:no-row",
          lastOwnerId: "worker-a",
        }),
        lease: Object.freeze({
          resource: missingResource,
          token: "lease_missing" as LeaseToken,
          expiresAt: new Date(Date.now() + 30_000),
          ownerId: "worker-a",
        }),
      }),
    ).toEqual({ kind: "rejected" });
    await expect(
      store.transports!.getBindingCheckpoint!({
        namespace,
        bindingId: missingBindingId,
      }),
    ).resolves.toBeNull();

    // Expired lease object against a re-claimed resource is rejected.
    const short = await store.leases.claim(resource, {
      ttlMs: 1,
      ownerId: "worker-a",
    });
    expect(short).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(
      await store.transports!.putBindingCheckpoint!({
        checkpoint: sampleCheckpoint({
          namespace,
          bindingId,
          cursor: "cursor:expired",
          lastOwnerId: "worker-a",
        }),
        lease: short!,
      }),
    ).toEqual({ kind: "rejected" });

    await expect(
      store.transports!.getBindingCheckpoint!({ namespace, bindingId }),
    ).resolves.toMatchObject({ cursor: "cursor:1" });
  });

  it("stops supervision checkpointing when putBindingCheckpoint rejects the lease fence", async () => {
    const { binding, program } = createPollingFixture();
    const base = inMemoryRuntimeStore();
    let rejectCheckpoint = false;
    const store = {
      ...base,
      transports: {
        ...base.transports!,
        async putBindingCheckpoint(
          input: Parameters<
            NonNullable<typeof base.transports>["putBindingCheckpoint"]
          >[0],
        ) {
          if (rejectCheckpoint) {
            return { kind: "rejected" as const };
          }
          return base.transports!.putBindingCheckpoint!(input);
        },
      },
    };
    const runner = createWorkerTransportSupervision({
      program,
      store: store as typeof base,
      namespace: "poll-reject-fence",
      ownerId: "worker-a",
    })!;
    const signalAbort = new AbortController().signal;

    try {
      rejectCheckpoint = true;
      const outcome = await runner.runOnce(
        signalAbort,
        new Date("2026-08-07T12:00:00.000Z"),
      );
      expect(outcome.polled).toBe(1);
      expect(outcome.checkpointed).toBe(0);
      expect(outcome.failed).toBe(1);
      await expect(
        base.transports!.getBindingCheckpoint!({
          namespace: "poll-reject-fence",
          bindingId: binding.id,
        }),
      ).resolves.toBeNull();
    } finally {
      await runner.dispose();
    }
  });

  it("records TRANSPORT_POLL_CONTRACT_INVALID for malformed PollResult without ingest or cursor advance", async () => {
    const orderSubmitted = signal({
      id: "order.submitted",
      schema: z.object({ orderId: z.string() }),
    });
    const provider = signalProvider({
      id: "orders.poll.contract",
      transport: polling({
        async poll() {
          return {
            events: "not-an-array",
            nextCursor: null,
          } as never;
        },
      }),
      signals: { orderSubmitted },
      async onEvent() {},
    });
    const binding = managedTransportBinding(provider, {
      id: "binding.orders.poll.contract",
      configRef: { id: "config.orders.poll.contract", revision: "rev.1" },
      signalId: "order.submitted",
    });
    const program = createRuntimeProgram({
      targets: [],
      providers: [provider],
      transports: [binding],
    });
    const store = inMemoryRuntimeStore();
    const runner = createWorkerTransportSupervision({
      program,
      store,
      namespace: "poll-contract",
      ownerId: "worker-a",
    })!;
    const signalAbort = new AbortController().signal;

    try {
      const outcome = await runner.runOnce(
        signalAbort,
        new Date("2026-08-07T12:00:00.000Z"),
      );
      expect(outcome.failed).toBe(1);
      expect(outcome.accepted).toBe(0);
      expect(outcome.checkpointed).toBe(0);

      const checkpoint = await store.transports!.getBindingCheckpoint!({
        namespace: "poll-contract",
        bindingId: binding.id,
      });
      expect(checkpoint?.cursor).toBeNull();
      expect(checkpoint?.lastErrorCode).toBe("TRANSPORT_POLL_CONTRACT_INVALID");

      const claimed = await store.transports!.claim({
        namespace: "poll-contract",
        limit: 10,
        now: new Date("2026-08-07T12:00:01.000Z"),
        leaseMs: 30_000,
        leaseToken: "lease_test",
      });
      expect(claimed).toEqual([]);
    } finally {
      await runner.dispose();
    }
  });

  it("rejects oversized PollResult batches without truncating or advancing the cursor", async () => {
    const orderSubmitted = signal({
      id: "order.submitted",
      schema: z.object({ orderId: z.string() }),
    });
    const events = Array.from({ length: 65 }, (_, index) => ({
      accountId: "acct_1",
      eventId: `evt_${index}`,
      authenticatedRouting: { source: "polling" },
      payload: inlinePayload(JSON.stringify({ orderId: `ord_${index}` })),
    }));
    const provider = signalProvider({
      id: "orders.poll.oversize",
      transport: polling({
        async poll() {
          return {
            events,
            nextCursor: "cursor:oversize",
          };
        },
      }),
      signals: { orderSubmitted },
      async onEvent() {},
    });
    const binding = managedTransportBinding(provider, {
      id: "binding.orders.poll.oversize",
      configRef: { id: "config.orders.poll.oversize", revision: "rev.1" },
      signalId: "order.submitted",
    });
    const program = createRuntimeProgram({
      targets: [],
      providers: [provider],
      transports: [binding],
    });
    const store = inMemoryRuntimeStore();
    const runner = createWorkerTransportSupervision({
      program,
      store,
      namespace: "poll-oversize",
      ownerId: "worker-a",
    })!;
    const signalAbort = new AbortController().signal;

    try {
      const outcome = await runner.runOnce(
        signalAbort,
        new Date("2026-08-07T12:00:00.000Z"),
      );
      expect(outcome.failed).toBe(1);
      expect(outcome.accepted).toBe(0);

      const checkpoint = await store.transports!.getBindingCheckpoint!({
        namespace: "poll-oversize",
        bindingId: binding.id,
      });
      expect(checkpoint?.cursor).toBeNull();
      expect(checkpoint?.lastErrorCode).toBe("TRANSPORT_POLL_CONTRACT_INVALID");

      const claimed = await store.transports!.claim({
        namespace: "poll-oversize",
        limit: 100,
        now: new Date("2026-08-07T12:00:01.000Z"),
        leaseMs: 30_000,
        leaseToken: "lease_test",
      });
      expect(claimed).toEqual([]);
    } finally {
      await runner.dispose();
    }
  });

  it("stores only safe provider error codes and falls back for invalid ones", async () => {
    const orderSubmitted = signal({
      id: "order.submitted",
      schema: z.object({ orderId: z.string() }),
    });
    let mode: "valid" | "invalid" = "valid";
    const provider = signalProvider({
      id: "orders.poll.errcode",
      transport: polling({
        async poll() {
          if (mode === "valid") {
            throw Object.assign(new Error("provider unavailable"), {
              code: "PROVIDER_UNAVAILABLE",
            });
          }
          throw Object.assign(new Error("unsafe"), {
            code: "not a safe code!!",
          });
        },
      }),
      signals: { orderSubmitted },
      async onEvent() {},
    });
    const binding = managedTransportBinding(provider, {
      id: "binding.orders.poll.errcode",
      configRef: { id: "config.orders.poll.errcode", revision: "rev.1" },
      signalId: "order.submitted",
    });
    const program = createRuntimeProgram({
      targets: [],
      providers: [provider],
      transports: [binding],
    });
    const store = inMemoryRuntimeStore();
    const runner = createWorkerTransportSupervision({
      program,
      store,
      namespace: "poll-errcode",
      ownerId: "worker-a",
    })!;
    const signalAbort = new AbortController().signal;

    try {
      mode = "valid";
      await runner.runOnce(
        signalAbort,
        new Date("2026-08-07T12:00:00.000Z"),
      );
      await expect(
        store.transports!.getBindingCheckpoint!({
          namespace: "poll-errcode",
          bindingId: binding.id,
        }),
      ).resolves.toMatchObject({ lastErrorCode: "PROVIDER_UNAVAILABLE" });

      mode = "invalid";
      await runner.runOnce(
        signalAbort,
        new Date("2026-08-07T12:00:01.000Z"),
      );
      await expect(
        store.transports!.getBindingCheckpoint!({
          namespace: "poll-errcode",
          bindingId: binding.id,
        }),
      ).resolves.toMatchObject({ lastErrorCode: "TRANSPORT_POLL_FAILED" });
    } finally {
      await runner.dispose();
    }
  });

});
