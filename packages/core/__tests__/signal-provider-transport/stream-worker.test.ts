/**
 * Managed stream supervision on the single Runtime worker.
 *
 * Vertical: stream provider → worker lease/fiber → durable accept → drain
 * normalize → stop aborts → competing supervisors → restart cursor resume.
 */

import { describe, expect, it } from "vitest";

import {
  bindingLeaseResource,
  createRuntimeWorker,
  createTransportNormalizationRunner,
  createWorkerTransportSupervision,
  inMemoryRuntimeStore,
  node,
} from "../../src/runtime/public";
import {
  createStreamFixture,
  envelopeItem,
} from "./stream-supervision-helpers";

describe("Runtime worker stream supervision", () => {
  it("opens a stream, accepts, and publishes Signal through existing drain", async () => {
    const fixture = createStreamFixture();
    fixture.setItemSequence([
      envelopeItem({ eventId: "evt_1", cursor: "cursor:1" }),
      envelopeItem({ eventId: "evt_2", cursor: "cursor:2" }),
    ]);

    const store = inMemoryRuntimeStore();
    const worker = createRuntimeWorker({
      runtime: node({
        store,
        namespace: "stream-supervise",
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

      const checkpoint = await store.transports!.getBindingCheckpoint!({
        namespace: "stream-supervise",
        bindingId: fixture.binding.id,
      });
      expect(checkpoint).toMatchObject({
        cursor: "cursor:2",
        configRef: fixture.binding.configRef,
        status: "active",
      });

      const envelope = await store.transports!.get({
        namespace: "stream-supervise",
        provider: "orders.stream",
        accountId: "acct_1",
        eventId: "evt_1",
      });
      expect(envelope?.state).toBe("normalized");
      expect(fixture.openCalls.length).toBeGreaterThanOrEqual(1);
      expect(fixture.openCalls[0]?.cursor).toBeNull();
    } finally {
      await worker.stop();
    }
  });

  it("stop aborts an in-flight open and dispose releases the binding lease", async () => {
    const fixture = createStreamFixture();
    let openSignal: AbortSignal | undefined;
    let releaseOpen: (() => void) | undefined;
    const openStarted = new Promise<void>((resolve) => {
      fixture.setItems(async (context) => {
        openSignal = context.signal;
        resolve();
        await new Promise<void>((settle) => {
          releaseOpen = settle;
          if (context.signal.aborted) {
            settle();
            return;
          }
          context.signal.addEventListener("abort", () => settle(), {
            once: true,
          });
        });
        if (context.signal.aborted) {
          throw new DOMException("aborted", "AbortError");
        }
        return emptyIterable();
      });
    });

    const store = inMemoryRuntimeStore();
    const namespace = "stream-stop-abort";
    const worker = createRuntimeWorker({
      runtime: node({
        store,
        namespace,
        autoStartMaintenance: false,
      }),
      program: fixture.program,
      pollIntervalMs: 5,
    });

    try {
      await openStarted;
      expect(openSignal?.aborted).toBe(false);

      await worker.stop();

      await expect
        .poll(() => openSignal?.aborted === true, { timeout: 5_000 })
        .toBe(true);

      const lease = await store.leases.claim(
        bindingLeaseResource(namespace, fixture.binding.id),
        { ttlMs: 1_000, ownerId: "after-stop" },
      );
      expect(lease).not.toBeNull();
      await store.leases.release(lease!);
    } finally {
      releaseOpen?.();
      await worker.stop().catch(() => undefined);
    }
  });

  it("coordinates competing stream supervisors through binding leases", async () => {
    const fixture = createStreamFixture();
    let openCount = 0;
    fixture.setItems(async function* (context) {
      openCount += 1;
      // Hold the connection so the lease stays owned while the loser runs.
      yield envelopeItem({ eventId: "evt_1", cursor: "cursor:1" });
      await new Promise<void>((resolve) => {
        if (context.signal.aborted) {
          resolve();
          return;
        }
        context.signal.addEventListener("abort", () => resolve(), {
          once: true,
        });
      });
    });

    const store = inMemoryRuntimeStore();
    const namespace = "stream-lease";
    const signalAbort = new AbortController().signal;

    const first = createWorkerTransportSupervision({
      program: fixture.program,
      store,
      namespace,
      ownerId: "worker-a",
    })!;
    const second = createWorkerTransportSupervision({
      program: fixture.program,
      store,
      namespace,
      ownerId: "worker-b",
    })!;

    try {
      const [left, right] = await Promise.all([
        first.runOnce(signalAbort, new Date("2026-08-07T12:00:00.000Z")),
        second.runOnce(signalAbort, new Date("2026-08-07T12:00:00.000Z")),
      ]);

      await expect
        .poll(() => openCount, { timeout: 5_000 })
        .toBe(1);

      const winners = [left, right].filter(
        (result) => (result.streamOpened ?? 0) > 0 || result.leased > 0,
      );
      const losers = [left, right].filter((result) => result.skipped > 0);
      expect(winners.length).toBeGreaterThanOrEqual(1);
      expect(losers.length).toBeGreaterThanOrEqual(1);

      // Only one supervisor should have started a stream open.
      expect(
        [left, right].reduce(
          (sum, result) => sum + (result.streamOpened ?? 0),
          0,
        ),
      ).toBe(1);

      await expect
        .poll(async () => {
          const envelope = await store.transports!.get({
            namespace,
            provider: "orders.stream",
            accountId: "acct_1",
            eventId: "evt_1",
          });
          return envelope?.state;
        }, { timeout: 5_000 })
        .toBe("accepted");

      const drain = createTransportNormalizationRunner({
        store,
        namespace,
        providers: fixture.program.providers,
      });
      // Stream fibers accept with wall-clock timestamps; drain must use a
      // clock at least as new as those accepts (unlike polling runOnce `now`).
      await drain.runOnce({ now: new Date() });
      expect(fixture.published.map((entry) => entry.orderId)).toEqual([
        "ord_1",
      ]);

      const lease = await store.leases.claim(
        bindingLeaseResource(namespace, fixture.binding.id),
        { ttlMs: 1_000, ownerId: "intruder" },
      );
      expect(lease).toBeNull();
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });

  it("resumes the durable cursor after restart without duplicate Signal delivery", async () => {
    const fixture = createStreamFixture();
    let openCount = 0;
    fixture.setItems(async function* (context) {
      openCount += 1;
      if (context.cursor === null) {
        yield envelopeItem({ eventId: "evt_1", cursor: "cursor:1" });
        // Hang until abort so the first worker keeps the lease until stop.
        await new Promise<void>((resolve) => {
          if (context.signal.aborted) {
            resolve();
            return;
          }
          context.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        return;
      }
      if (context.cursor === "cursor:1") {
        yield envelopeItem({ eventId: "evt_2", cursor: "cursor:2" });
        await new Promise<void>((resolve) => {
          if (context.signal.aborted) {
            resolve();
            return;
          }
          context.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
      }
    });

    const store = inMemoryRuntimeStore();
    const namespace = "stream-restart";
    const first = createRuntimeWorker({
      runtime: node({
        store,
        namespace,
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
            namespace,
            bindingId: fixture.binding.id,
          });
          return checkpoint?.cursor;
        }, { timeout: 5_000 })
        .toBe("cursor:1");
    } finally {
      await first.stop();
    }

    const occurrenceId = fixture.published[0]!.occurrenceId;
    const opensBeforeRestart = openCount;

    const second = createRuntimeWorker({
      runtime: node({
        store,
        namespace,
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
        fixture.openCalls
          .slice(opensBeforeRestart)
          .some((call) => call.cursor === "cursor:1"),
      ).toBe(true);
      expect(
        fixture.openCalls
          .slice(opensBeforeRestart)
          .every((call) => call.cursor !== null),
      ).toBe(true);
    } finally {
      await second.stop();
    }
  });

  it("accepts setItems factories that resolve to an AsyncIterable", async () => {
    const fixture = createStreamFixture();
    fixture.setItems(async () => {
      return (async function* () {
        yield envelopeItem({ eventId: "evt_async", cursor: "cursor:async" });
      })();
    });

    const store = inMemoryRuntimeStore();
    const worker = createRuntimeWorker({
      runtime: node({
        store,
        namespace: "stream-async-factory",
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
        .toEqual(["ord_async"]);
    } finally {
      await worker.stop();
    }
  });

  it("records TRANSPORT_STREAM_FAILED when stream supervision throws outside the fiber", async () => {
    const fixture = createStreamFixture();
    fixture.setItemSequence([
      envelopeItem({ eventId: "evt_1", cursor: "cursor:1" }),
    ]);

    const store = inMemoryRuntimeStore();
    const namespace = "stream-shared-catch";
    const transports = store.transports!;
    const originalGet = transports.getBindingCheckpoint!.bind(transports);
    const parent = new AbortController();
    const supervision = createWorkerTransportSupervision({
      program: fixture.program,
      store,
      namespace,
      ownerId: "worker-a",
    })!;

    try {
      await supervision.runOnce(
        parent.signal,
        new Date("2026-08-07T12:00:00.000Z"),
      );
      await expect
        .poll(async () => {
          const envelope = await store.transports!.get({
            namespace,
            provider: "orders.stream",
            accountId: "acct_1",
            eventId: "evt_1",
          });
          return envelope?.state;
        }, { timeout: 5_000 })
        .toBe("accepted");

      // Settle the running fiber so the next tick re-enters checkpoint load.
      parent.abort();
      await expect
        .poll(() => fixture.openCalls[0]?.signal.aborted === true, {
          timeout: 5_000,
        })
        .toBe(true);

      transports.getBindingCheckpoint = async () => {
        throw new Error("injected stream supervision failure");
      };

      const result = await supervision.runOnce(
        new AbortController().signal,
        new Date("2026-08-07T12:00:01.000Z"),
      );
      expect(result.failed).toBeGreaterThanOrEqual(1);

      transports.getBindingCheckpoint = originalGet;
      const checkpoint = await store.transports!.getBindingCheckpoint!({
        namespace,
        bindingId: fixture.binding.id,
      });
      expect(checkpoint?.lastErrorCode).toBe("TRANSPORT_STREAM_FAILED");
    } finally {
      transports.getBindingCheckpoint = originalGet;
      await supervision.dispose();
    }
  });

  it("faults with TRANSPORT_STREAM_EXHAUSTED after consecutive rejected stream fibers", async () => {
    const fixture = createStreamFixture();
    fixture.setItems(async function* () {
      yield envelopeItem({ eventId: "evt_x", cursor: "cursor:x" });
    });

    const store = inMemoryRuntimeStore();
    const namespace = "stream-fiber-exhaust";
    const transports = store.transports!;
    const originalPut = transports.putBindingCheckpoint!.bind(transports);
    let activePutFailures = 0;
    transports.putBindingCheckpoint = async (input) => {
      if (input.checkpoint.status === "faulted") {
        return originalPut(input);
      }
      activePutFailures += 1;
      throw new Error("injected fiber crash on active checkpoint write");
    };

    const supervision = createWorkerTransportSupervision({
      program: fixture.program,
      store,
      namespace,
      ownerId: "worker-a",
    })!;
    const signal = new AbortController().signal;
    const { MAX_STREAM_TRANSIENT_FAILURES, TRANSPORT_STREAM_EXHAUSTED } =
      await import("../../src/runtime/worker/worker-transport-stream");

    try {
      // Each rejected fiber: start on tick N, wait for put failure settle, harvest on N+1.
      for (let i = 0; i < MAX_STREAM_TRANSIENT_FAILURES; i += 1) {
        const failuresBefore = activePutFailures;
        await supervision.runOnce(
          signal,
          new Date(Date.UTC(2026, 7, 7, 13, 0, i)),
        );
        await expect
          .poll(() => activePutFailures, { timeout: 5_000 })
          .toBeGreaterThan(failuresBefore);
        await flushMicrotasks();
      }

      // Harvest the final rejection and persist durable exhaustion.
      await supervision.runOnce(signal, new Date("2026-08-07T13:30:00.000Z"));
      await flushMicrotasks();

      transports.putBindingCheckpoint = originalPut;
      const checkpoint = await store.transports!.getBindingCheckpoint!({
        namespace,
        bindingId: fixture.binding.id,
      });
      expect(checkpoint).toMatchObject({
        status: "faulted",
        lastErrorCode: TRANSPORT_STREAM_EXHAUSTED,
      });
      expect(fixture.openCalls.length).toBe(MAX_STREAM_TRANSIENT_FAILURES);

      const opensBefore = fixture.openCalls.length;
      await supervision.runOnce(signal, new Date("2026-08-07T13:31:00.000Z"));
      await flushMicrotasks();
      expect(fixture.openCalls.length).toBe(opensBefore);

      const lease = await store.leases.claim(
        bindingLeaseResource(namespace, fixture.binding.id),
        { ttlMs: 1_000, ownerId: "after-exhaust" },
      );
      expect(lease).not.toBeNull();
      await store.leases.release(lease!);
    } finally {
      transports.putBindingCheckpoint = originalPut;
      await supervision.dispose();
    }
  });

  it("resets consecutive rejected-fiber count after a successful harvest", async () => {
    const fixture = createStreamFixture();
    fixture.setItems(async function* () {
      yield envelopeItem({ eventId: "evt_crash", cursor: "cursor:crash" });
    });

    const store = inMemoryRuntimeStore();
    const namespace = "stream-fiber-reset";
    const transports = store.transports!;
    const originalPut = transports.putBindingCheckpoint!.bind(transports);
    let crashPuts = true;
    let activePutFailures = 0;
    transports.putBindingCheckpoint = async (input) => {
      if (crashPuts && input.checkpoint.status !== "faulted") {
        activePutFailures += 1;
        throw new Error("injected crash");
      }
      return originalPut(input);
    };

    const supervision = createWorkerTransportSupervision({
      program: fixture.program,
      store,
      namespace,
      ownerId: "worker-a",
    })!;
    const signal = new AbortController().signal;
    const { MAX_STREAM_TRANSIENT_FAILURES } = await import(
      "../../src/runtime/worker/worker-transport-stream"
    );

    try {
      for (let i = 0; i < MAX_STREAM_TRANSIENT_FAILURES - 1; i += 1) {
        const failuresBefore = activePutFailures;
        await supervision.runOnce(
          signal,
          new Date(Date.UTC(2026, 7, 7, 14, 0, i)),
        );
        await expect
          .poll(() => activePutFailures, { timeout: 5_000 })
          .toBeGreaterThan(failuresBefore);
        await flushMicrotasks();
      }

      crashPuts = false;
      const successParent = new AbortController();
      fixture.setItems(async function* (context) {
        yield envelopeItem({ eventId: "evt_ok", cursor: "cursor:ok" });
        // Hold open until abort so reconnect does not mask the successful harvest.
        await new Promise<void>((resolve) => {
          if (context.signal.aborted) {
            resolve();
            return;
          }
          context.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
      });

      const opensBeforeSuccess = fixture.openCalls.length;
      // Harvest the last crashing fiber and start the successful one.
      await supervision.runOnce(
        successParent.signal,
        new Date("2026-08-07T14:10:00.000Z"),
      );
      await expect
        .poll(() => fixture.openCalls.length, { timeout: 5_000 })
        .toBeGreaterThan(opensBeforeSuccess);
      await expect
        .poll(async () => {
          const checkpoint = await store.transports!.getBindingCheckpoint!({
            namespace,
            bindingId: fixture.binding.id,
          });
          return checkpoint?.cursor;
        }, { timeout: 5_000 })
        .toBe("cursor:ok");

      // Settle the successful fiber with a result (not an error) so the counter resets.
      successParent.abort();
      await expect
        .poll(
          () =>
            fixture.openCalls[fixture.openCalls.length - 1]?.signal.aborted ===
            true,
          { timeout: 5_000 },
        )
        .toBe(true);
      await flushMicrotasks();

      const checkpoint = await store.transports!.getBindingCheckpoint!({
        namespace,
        bindingId: fixture.binding.id,
      });
      expect(checkpoint).toMatchObject({
        cursor: "cursor:ok",
        status: "active",
      });

      // Reopen as crashing fibers after the successful harvest resets the counter.
      crashPuts = true;
      fixture.setItems(async function* () {
        yield envelopeItem({ eventId: "evt_again", cursor: "cursor:again" });
      });

      for (let i = 0; i < 3; i += 1) {
        const failuresBefore = activePutFailures;
        await supervision.runOnce(
          signal,
          new Date(Date.UTC(2026, 7, 7, 14, 20, i)),
        );
        await expect
          .poll(() => activePutFailures, { timeout: 5_000 })
          .toBeGreaterThan(failuresBefore);
        await flushMicrotasks();
      }

      const stillActive = await store.transports!.getBindingCheckpoint!({
        namespace,
        bindingId: fixture.binding.id,
      });
      expect(stillActive?.status).not.toBe("faulted");
      expect(stillActive?.cursor).toBe("cursor:ok");
    } finally {
      transports.putBindingCheckpoint = originalPut;
      await supervision.dispose();
    }
  });

  it("isolates fault-write rejection without unhandled rejections or reopening", async () => {
    const fixture = createStreamFixture();
    fixture.setItems(async function* () {
      yield envelopeItem({ eventId: "evt_x", cursor: "cursor:x" });
    });

    const store = inMemoryRuntimeStore();
    const namespace = "stream-fault-write-isolation";
    const transports = store.transports!;
    const originalPut = transports.putBindingCheckpoint!.bind(transports);
    let putAttempts = 0;
    transports.putBindingCheckpoint = async () => {
      putAttempts += 1;
      throw new Error("all checkpoint writes fail");
    };

    const supervision = createWorkerTransportSupervision({
      program: fixture.program,
      store,
      namespace,
      ownerId: "worker-a",
    })!;
    const signal = new AbortController().signal;
    const { MAX_STREAM_TRANSIENT_FAILURES } = await import(
      "../../src/runtime/worker/worker-transport-stream"
    );

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      for (let i = 0; i < MAX_STREAM_TRANSIENT_FAILURES; i += 1) {
        const attemptsBefore = putAttempts;
        await supervision.runOnce(
          signal,
          new Date(Date.UTC(2026, 7, 7, 15, 0, i)),
        );
        await expect
          .poll(() => putAttempts, { timeout: 5_000 })
          .toBeGreaterThan(attemptsBefore);
        await flushMicrotasks();
      }

      await supervision.runOnce(signal, new Date("2026-08-07T15:30:00.000Z"));
      await flushMicrotasks();
      expect(unhandled).toEqual([]);
      expect(fixture.openCalls.length).toBe(MAX_STREAM_TRANSIENT_FAILURES);

      const opensBefore = fixture.openCalls.length;
      await supervision.runOnce(signal, new Date("2026-08-07T15:31:00.000Z"));
      await flushMicrotasks();
      expect(fixture.openCalls.length).toBe(opensBefore);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      transports.putBindingCheckpoint = originalPut;
      await supervision.dispose();
    }
  });

  it("does not construct supervision for webhook-only programs", async () => {
    const { createRuntimeProgram } = await import("../../src/runtime/public");
    const { signalProvider, managedTransportBinding } = await import(
      "../../src/signal/provider"
    );
    const { webhook } = await import("../../src/signal/transport");
    const { signal } = await import("../../src/signal");
    const { z } = await import("zod");

    const orderSubmitted = signal({
      id: "order.submitted",
      schema: z.object({ orderId: z.string() }),
    });
    const provider = signalProvider({
      id: "orders.webhook",
      transport: webhook({
        async handle() {
          return null;
        },
      }),
      signals: { orderSubmitted },
      async onEvent() {},
    });
    const binding = managedTransportBinding(provider, {
      id: "binding.orders.webhook",
      configRef: { id: "config.orders.webhook", revision: "rev.1" },
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
        namespace: "webhook-only",
      }),
    ).toBeUndefined();
  });
});

async function* emptyIterable(): AsyncGenerator<never, void, unknown> {
  // Clean EOF with no items.
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
