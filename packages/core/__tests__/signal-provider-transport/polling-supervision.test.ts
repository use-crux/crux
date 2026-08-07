/**
 * Managed polling supervision on the single Runtime worker.
 *
 * Vertical: inert binding + polling provider → worker lease → poll → durable
 * accept → checkpoint → restart resumes cursor without duplicate logical
 * occurrence → stop aborts acquisition.
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
  createRuntimeWorker,
  createTransportNormalizationRunner,
  createWorkerTransportSupervision,
  inMemoryRuntimeStore,
  node,
} from "../../src/runtime/public";
import {
  createPollingFixture,
  inlinePayload,
} from "./polling-supervision-helpers";

describe("Runtime worker polling supervision", () => {
  it("polls, durably accepts, checkpoints, and normalizes through the worker", async () => {
    const { binding, program, published, pollCalls } = createPollingFixture();
    const store = inMemoryRuntimeStore();
    const worker = createRuntimeWorker({
      runtime: node({
        store,
        namespace: "poll-supervise",
        autoStartMaintenance: false,
      }),
      program,
      pollIntervalMs: 5,
    });

    try {
      await expect
        .poll(() => published.map((entry) => entry.orderId), {
          timeout: 5_000,
        })
        .toEqual(["ord_1", "ord_2"]);

      const checkpoint = await store.transports!.getBindingCheckpoint!({
        namespace: "poll-supervise",
        bindingId: binding.id,
      });
      expect(checkpoint?.cursor).toBe("cursor:2");
      expect(pollCalls[0]?.cursor).toBeNull();
      expect(pollCalls.some((call) => call.cursor === "cursor:1")).toBe(true);

      const envelope = await store.transports!.get({
        namespace: "poll-supervise",
        provider: "orders.poll",
        accountId: "acct_1",
        eventId: "evt_1",
      });
      expect(envelope?.state).toBe("normalized");
    } finally {
      await worker.stop();
    }
  });

  it("resumes the durable cursor after restart without redelivering", async () => {
    const fixture = createPollingFixture();
    // Only the first page is available before restart.
    fixture.setPages(
      new Map([
        [null, { events: ["evt_1"], next: "cursor:1" }],
        ["cursor:1", { events: [], next: "cursor:1" }],
      ]),
    );
    const store = inMemoryRuntimeStore();
    const first = createRuntimeWorker({
      runtime: node({
        store,
        namespace: "poll-restart",
        autoStartMaintenance: false,
      }),
      program: fixture.program,
      pollIntervalMs: 5,
    });

    try {
      await expect
        .poll(() => fixture.published.map((entry) => entry.orderId), {
          timeout: 5_000,
        })
        .toEqual(["ord_1"]);
      await expect
        .poll(async () => {
          const checkpoint = await store.transports!.getBindingCheckpoint!({
            namespace: "poll-restart",
            bindingId: fixture.binding.id,
          });
          return checkpoint?.cursor;
        }, { timeout: 5_000 })
        .toBe("cursor:1");
    } finally {
      await first.stop();
    }

    const occurrenceId = fixture.published[0]!.occurrenceId;
    const beforeRestart = fixture.pollCalls.length;
    fixture.setPages(
      new Map([
        ["cursor:1", { events: ["evt_2"], next: "cursor:2" }],
        ["cursor:2", { events: [], next: "cursor:2" }],
      ]),
    );

    const second = createRuntimeWorker({
      runtime: node({
        store,
        namespace: "poll-restart",
        autoStartMaintenance: false,
      }),
      program: fixture.program,
      pollIntervalMs: 5,
    });

    try {
      await expect
        .poll(() => fixture.published.map((entry) => entry.orderId), {
          timeout: 5_000,
        })
        .toEqual(["ord_1", "ord_2"]);
      expect(fixture.published[0]!.occurrenceId).toBe(occurrenceId);
      expect(
        fixture.pollCalls
          .slice(beforeRestart)
          .some((call) => call.cursor === "cursor:1"),
      ).toBe(true);
      expect(
        fixture.pollCalls
          .slice(beforeRestart)
          .every((call) => call.cursor !== null),
      ).toBe(true);
    } finally {
      await second.stop();
    }
  });

  it("coordinates competing supervisors through binding leases", async () => {
    const { binding, program, published } = createPollingFixture();
    const store = inMemoryRuntimeStore();
    const signalAbort = new AbortController().signal;

    const first = createWorkerTransportSupervision({
      program,
      store,
      namespace: "poll-lease",
      ownerId: "worker-a",
    })!;
    const second = createWorkerTransportSupervision({
      program,
      store,
      namespace: "poll-lease",
      ownerId: "worker-b",
    })!;

    try {
      const [left, right] = await Promise.all([
        first.runOnce(signalAbort, new Date("2026-08-07T12:00:00.000Z")),
        second.runOnce(signalAbort, new Date("2026-08-07T12:00:00.000Z")),
      ]);

      const winners = [left, right].filter((result) => result.polled > 0);
      const losers = [left, right].filter((result) => result.skipped > 0);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(winners[0]!.accepted).toBe(1);

      const drain = createTransportNormalizationRunner({
        store,
        namespace: "poll-lease",
        providers: program.providers,
      });
      await drain.runOnce({ now: new Date("2026-08-07T12:00:01.000Z") });
      expect(published.map((entry) => entry.orderId)).toEqual(["ord_1"]);

      const lease = await store.leases.claim(
        bindingLeaseResource("poll-lease", binding.id),
        { ttlMs: 1_000, ownerId: "intruder" },
      );
      expect(lease).toBeNull();
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });

  it("honors PollResult.more by skipping intervalMs on the next tick", async () => {
    const orderSubmitted = signal({
      id: "order.submitted",
      schema: z.object({ orderId: z.string() }),
    });
    const pollCalls: Array<{ cursor: string | null }> = [];
    const provider = signalProvider({
      id: "orders.poll.more",
      transport: polling({
        intervalMs: 60_000,
        async poll({ cursor }) {
          pollCalls.push({ cursor });
          if (cursor === null) {
            return {
              events: [
                {
                  accountId: "acct_1",
                  eventId: "evt_more_1",
                  authenticatedRouting: { source: "polling" },
                  payload: inlinePayload(JSON.stringify({ orderId: "ord_1" })),
                },
              ],
              nextCursor: "cursor:1",
              more: true,
            };
          }
          return {
            events: [],
            nextCursor: cursor,
            more: false,
          };
        },
      }),
      signals: { orderSubmitted },
      async onEvent() {
        // Acceptance-only probe; normalization is not required for morePending.
      },
    });
    const binding = managedTransportBinding(provider, {
      id: "binding.orders.poll.more",
      configRef: { id: "config.orders.poll.more", revision: "rev.1" },
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
      namespace: "poll-more",
      ownerId: "worker-a",
    })!;
    const signalAbort = new AbortController().signal;

    try {
      const first = await runner.runOnce(
        signalAbort,
        new Date("2026-08-07T12:00:00.000Z"),
      );
      expect(first.accepted).toBe(1);
      expect(first.checkpointed).toBe(1);

      const checkpoint = await store.transports!.getBindingCheckpoint!({
        namespace: "poll-more",
        bindingId: binding.id,
      });
      expect(checkpoint?.cursor).toBe("cursor:1");
      expect(checkpoint?.morePending).toBe(true);

      const second = await runner.runOnce(
        signalAbort,
        new Date("2026-08-07T12:00:01.000Z"),
      );
      expect(second.polled).toBe(1);
      expect(pollCalls).toHaveLength(2);

      const cleared = await store.transports!.getBindingCheckpoint!({
        namespace: "poll-more",
        bindingId: binding.id,
      });
      expect(cleared?.morePending).toBeUndefined();
    } finally {
      await runner.dispose();
    }
  });

  it("does not advance the cursor when a poll fails", async () => {
    const { binding, program, pollCalls } = createPollingFixture({
      failPollOnce: true,
    });
    const store = inMemoryRuntimeStore();
    const runner = createWorkerTransportSupervision({
      program,
      store,
      namespace: "poll-fail",
      ownerId: "worker-a",
    })!;
    const signalAbort = new AbortController().signal;

    try {
      const failed = await runner.runOnce(
        signalAbort,
        new Date("2026-08-07T12:00:00.000Z"),
      );
      expect(failed.failed).toBe(1);
      expect(failed.checkpointed).toBe(0);
      expect(pollCalls).toHaveLength(1);

      const checkpoint = await store.transports!.getBindingCheckpoint!({
        namespace: "poll-fail",
        bindingId: binding.id,
      });
      expect(checkpoint?.cursor).toBeNull();
      expect(checkpoint?.lastErrorCode).toBe("PROVIDER_UNAVAILABLE");

      const recovered = await runner.runOnce(
        signalAbort,
        new Date("2026-08-07T12:00:01.000Z"),
      );
      expect(recovered.accepted).toBe(1);
      expect(recovered.checkpointed).toBe(1);

      const advanced = await store.transports!.getBindingCheckpoint!({
        namespace: "poll-fail",
        bindingId: binding.id,
      });
      expect(advanced?.cursor).toBe("cursor:1");
      expect(advanced?.lastErrorCode).toBeUndefined();
    } finally {
      await runner.dispose();
    }
  });

  it("dedupes stable provider event IDs on redelivery through the envelope kernel", async () => {
    const orderSubmitted = signal({
      id: "order.submitted",
      schema: z.object({ orderId: z.string() }),
    });
    const published: string[] = [];
    orderSubmitted.subscribe((occurrence) => {
      published.push(occurrence.id);
    });
    const provider = signalProvider({
      id: "orders.poll.dedupe",
      transport: polling({
        async poll() {
          return {
            events: [
              {
                accountId: "acct_1",
                eventId: "evt_same",
                authenticatedRouting: { source: "polling" },
                payload: inlinePayload(JSON.stringify({ orderId: "ord_same" })),
              },
            ],
            // Stay at the initial cursor so the next tick redelivers the same id.
            nextCursor: null,
          };
        },
      }),
      signals: { orderSubmitted },
      async onEvent(envelope, { signals }) {
        const raw =
          envelope.payload.kind === "inline-base64url"
            ? Buffer.from(envelope.payload.value, "base64url").toString("utf8")
            : "";
        const body = JSON.parse(raw) as { orderId: string };
        await signals.orderSubmitted.publish({ orderId: body.orderId });
      },
    });
    const binding = managedTransportBinding(provider, {
      id: "binding.orders.poll.dedupe",
      configRef: { id: "config.orders.poll.dedupe", revision: "rev.1" },
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
      namespace: "poll-dedupe",
      ownerId: "worker-a",
    })!;
    const drain = createTransportNormalizationRunner({
      store,
      namespace: "poll-dedupe",
      providers: program.providers,
    });
    const signalAbort = new AbortController().signal;

    try {
      const first = await runner.runOnce(
        signalAbort,
        new Date("2026-08-07T12:00:00.000Z"),
      );
      expect(first.accepted).toBe(1);
      expect(first.duplicated).toBe(0);
      await drain.runOnce({ now: new Date("2026-08-07T12:00:00.500Z") });
      expect(published).toHaveLength(1);

      const second = await runner.runOnce(
        signalAbort,
        new Date("2026-08-07T12:00:01.000Z"),
      );
      expect(second.accepted).toBe(0);
      expect(second.duplicated).toBe(1);
      await drain.runOnce({ now: new Date("2026-08-07T12:00:01.500Z") });
      expect(published).toHaveLength(1);
    } finally {
      await runner.dispose();
    }
  });

  it("advances past TransportEnvelopeConflictError when durable envelope evidence is already present", async () => {
    const orderSubmitted = signal({
      id: "order.submitted",
      schema: z.object({ orderId: z.string() }),
    });
    const published: string[] = [];
    orderSubmitted.subscribe((occurrence) => {
      published.push(occurrence.payload.orderId);
    });

    // First page accepts evt_conflict with payload A; later redelivery of the
    // same identity with payload B must not poison the provider cursor forever.
    let page = 0;
    const pollCalls: Array<{ cursor: string | null }> = [];
    const provider = signalProvider({
      id: "orders.poll.conflict",
      transport: polling({
        async poll({ cursor }) {
          pollCalls.push({ cursor });
          page += 1;
          if (page === 1) {
            return {
              events: [
                {
                  accountId: "acct_1",
                  eventId: "evt_conflict",
                  authenticatedRouting: { source: "polling" },
                  payload: inlinePayload(
                    JSON.stringify({ orderId: "ord_original" }),
                  ),
                },
              ],
              nextCursor: "cursor:1",
            };
          }
          if (page === 2) {
            return {
              events: [
                {
                  accountId: "acct_1",
                  eventId: "evt_conflict",
                  authenticatedRouting: { source: "polling" },
                  // Different authenticated payload → digest conflict.
                  payload: inlinePayload(
                    JSON.stringify({ orderId: "ord_conflicting" }),
                  ),
                },
                {
                  accountId: "acct_1",
                  eventId: "evt_next",
                  authenticatedRouting: { source: "polling" },
                  payload: inlinePayload(
                    JSON.stringify({ orderId: "ord_next" }),
                  ),
                },
              ],
              nextCursor: "cursor:2",
            };
          }
          return {
            events: [],
            nextCursor: cursor ?? "cursor:2",
          };
        },
      }),
      signals: { orderSubmitted },
      async onEvent(envelope, { signals }) {
        const raw =
          envelope.payload.kind === "inline-base64url"
            ? Buffer.from(envelope.payload.value, "base64url").toString("utf8")
            : "";
        const body = JSON.parse(raw) as { orderId: string };
        await signals.orderSubmitted.publish({ orderId: body.orderId });
      },
    });
    const binding = managedTransportBinding(provider, {
      id: "binding.orders.poll.conflict",
      configRef: { id: "config.orders.poll.conflict", revision: "rev.1" },
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
      namespace: "poll-conflict",
      ownerId: "worker-a",
    })!;
    const drain = createTransportNormalizationRunner({
      store,
      namespace: "poll-conflict",
      providers: program.providers,
    });
    const signalAbort = new AbortController().signal;

    try {
      const first = await runner.runOnce(
        signalAbort,
        new Date("2026-08-07T12:00:00.000Z"),
      );
      expect(first.accepted).toBe(1);
      expect(first.checkpointed).toBe(1);
      await drain.runOnce({ now: new Date("2026-08-07T12:00:00.500Z") });
      expect(published).toEqual(["ord_original"]);

      const conflicted = await runner.runOnce(
        signalAbort,
        new Date("2026-08-07T12:00:01.000Z"),
      );
      // Conflict must not fail the page or freeze the cursor: durable evidence
      // for the identity already exists, and later events still accept.
      expect(conflicted.failed).toBe(0);
      expect(conflicted.checkpointed).toBe(1);
      expect(conflicted.accepted).toBe(1);

      const checkpoint = await store.transports!.getBindingCheckpoint!({
        namespace: "poll-conflict",
        bindingId: binding.id,
      });
      expect(checkpoint?.cursor).toBe("cursor:2");
      expect(checkpoint?.lastErrorCode).toBeUndefined();

      const original = await store.transports!.get({
        namespace: "poll-conflict",
        provider: "orders.poll.conflict",
        accountId: "acct_1",
        eventId: "evt_conflict",
      });
      expect(original?.state).toBe("normalized");
      expect(original?.envelope.payload).toEqual(
        inlinePayload(JSON.stringify({ orderId: "ord_original" })),
      );

      await drain.runOnce({ now: new Date("2026-08-07T12:00:01.500Z") });
      expect(published).toEqual(["ord_original", "ord_next"]);

      // Subsequent ticks resume from the advanced cursor, not the poisoned page.
      const idle = await runner.runOnce(
        signalAbort,
        new Date("2026-08-07T12:00:02.000Z"),
      );
      expect(idle.failed).toBe(0);
      expect(pollCalls.some((call) => call.cursor === "cursor:2")).toBe(true);
    } finally {
      await runner.dispose();
    }
  });

  it("does not checkpoint when conflict evidence cannot be confirmed in the transport store", async () => {
    const orderSubmitted = signal({
      id: "order.submitted",
      schema: z.object({ orderId: z.string() }),
    });
    const provider = signalProvider({
      id: "orders.poll.conflict-missing",
      transport: polling({
        async poll() {
          return {
            events: [
              {
                accountId: "acct_1",
                eventId: "evt_ghost",
                authenticatedRouting: { source: "polling" },
                payload: inlinePayload(
                  JSON.stringify({ orderId: "ord_ghost" }),
                ),
              },
            ],
            nextCursor: "cursor:ghost",
          };
        },
      }),
      signals: { orderSubmitted },
      async onEvent() {},
    });
    const binding = managedTransportBinding(provider, {
      id: "binding.orders.poll.conflict-missing",
      configRef: {
        id: "config.orders.poll.conflict-missing",
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
    // Seed a conflicting identity, then hide get() so durable evidence cannot
    // be confirmed after TransportEnvelopeConflictError.
    await base.transports!.accept({
      namespace: "poll-conflict-missing",
      envelope: {
        _tag: "RuntimeAcceptedTransportEnvelope",
        schemaVersion: 1,
        bindingId: binding.id,
        adapterId: provider.id,
        provider: provider.id,
        accountId: "acct_1",
        eventId: "evt_ghost",
        receivedAt: "2026-08-07T12:00:00.000Z",
        authenticatedRouting: { source: "seed" },
        payload: inlinePayload(JSON.stringify({ orderId: "ord_seed" })),
        configRef: binding.configRef,
        target: { kind: "signal", signalId: "order.submitted" },
      },
      envelopeDigest: "seed-digest-not-matching-poll-payload",
      maxAttempts: 5,
      now: new Date("2026-08-07T12:00:00.000Z"),
    });
    const store = {
      ...base,
      transports: {
        ...base.transports!,
        async get() {
          return null;
        },
        async accept(
          input: Parameters<NonNullable<typeof base.transports>["accept"]>[0],
        ) {
          return base.transports!.accept(input);
        },
      },
      async transact<T>(fn: (tx: typeof base) => Promise<T>): Promise<T> {
        return base.transact(async (tx) =>
          fn({
            ...tx,
            transports: {
              ...tx.transports!,
              async get() {
                return null;
              },
            },
          } as typeof base),
        );
      },
    };
    const runner = createWorkerTransportSupervision({
      program,
      store: store as typeof base,
      namespace: "poll-conflict-missing",
      ownerId: "worker-a",
    })!;
    const signalAbort = new AbortController().signal;

    try {
      const outcome = await runner.runOnce(
        signalAbort,
        new Date("2026-08-07T12:00:01.000Z"),
      );
      expect(outcome.failed).toBe(1);
      expect(outcome.checkpointed).toBe(0);

      const checkpoint = await base.transports!.getBindingCheckpoint!({
        namespace: "poll-conflict-missing",
        bindingId: binding.id,
      });
      expect(checkpoint?.cursor).toBeNull();
      expect(checkpoint?.lastErrorCode).toBe("TRANSPORT_ENVELOPE_CONFLICT");
    } finally {
      await runner.dispose();
    }
  });

  it("retains failure semantics for non-conflict accept errors", async () => {
    const orderSubmitted = signal({
      id: "order.submitted",
      schema: z.object({ orderId: z.string() }),
    });
    const provider = signalProvider({
      id: "orders.poll.accept-fail",
      transport: polling({
        async poll() {
          return {
            events: [
              {
                accountId: "acct_1",
                eventId: "evt_1",
                authenticatedRouting: { source: "polling" },
                payload: inlinePayload(JSON.stringify({ orderId: "ord_1" })),
              },
            ],
            nextCursor: "cursor:1",
          };
        },
      }),
      signals: { orderSubmitted },
      async onEvent() {},
    });
    const binding = managedTransportBinding(provider, {
      id: "binding.orders.poll.accept-fail",
      configRef: { id: "config.orders.poll.accept-fail", revision: "rev.1" },
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
      async transact<T>(fn: (tx: typeof base) => Promise<T>): Promise<T> {
        return base.transact(async (tx) =>
          fn({
            ...tx,
            transports: {
              ...tx.transports!,
              async accept() {
                throw Object.assign(new Error("store write failed"), {
                  code: "TRANSPORT_STORE_WRITE_FAILED",
                });
              },
            },
          } as typeof base),
        );
      },
    };
    const runner = createWorkerTransportSupervision({
      program,
      store: store as typeof base,
      namespace: "poll-accept-fail",
      ownerId: "worker-a",
    })!;
    const signalAbort = new AbortController().signal;

    try {
      const outcome = await runner.runOnce(
        signalAbort,
        new Date("2026-08-07T12:00:00.000Z"),
      );
      expect(outcome.failed).toBe(1);
      expect(outcome.checkpointed).toBe(0);
      expect(outcome.accepted).toBe(0);

      const checkpoint = await base.transports!.getBindingCheckpoint!({
        namespace: "poll-accept-fail",
        bindingId: binding.id,
      });
      expect(checkpoint?.cursor).toBeNull();
      expect(checkpoint?.lastErrorCode).toBe("TRANSPORT_STORE_WRITE_FAILED");
    } finally {
      await runner.dispose();
    }
  });

});
